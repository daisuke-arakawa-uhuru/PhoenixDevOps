import { GoogleGenAI } from "@google/genai";

export class GeminiSettings {
  apiKey: string | null;
  model: string;
  dryRun: boolean;

  constructor({
    apiKey = null,
    model = "gemini-3.1-flash-lite",
    dryRun = false,
  }: {
    apiKey?: string | null;
    model?: string;
    dryRun?: boolean;
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.dryRun = dryRun;
  }
}

export interface GeminiClient {
  generate(prompt: string): Promise<string>;
}

export class GoogleGenAIClient implements GeminiClient {
  private client: GoogleGenAI;
  private model: string;
  private maxRetries: number;

  constructor(settings: GeminiSettings) {
    if (!settings.apiKey) {
      throw new Error("GEMINI_API_KEY is required when dry-run is disabled");
    }
    this.client = new GoogleGenAI({ apiKey: settings.apiKey });
    this.model = settings.model;
    this.maxRetries = 2;
  }

  async generate(prompt: string): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await this.client.models.generateContent({
          model: this.model,
          contents: prompt,
        });
        return result.text || String(result);
      } catch (error) {
        const normalized = normalizeGeminiError(error, this.model);
        if (!normalized.retryable || attempt >= this.maxRetries) {
          throw normalized;
        }
        await sleep(normalized.retryDelayMs || retryDelayMs(attempt));
      }
    }
  }
}

export class GeminiApiError extends Error {
  statusCode: number | null;
  apiStatus: string | null;
  retryable: boolean;
  retryDelayMs: number | null;

  constructor({
    message,
    statusCode = null,
    apiStatus = null,
    retryable = false,
    retryDelayMs = null,
  }: {
    message: string;
    statusCode?: number | null;
    apiStatus?: string | null;
    retryable?: boolean;
    retryDelayMs?: number | null;
  }) {
    super(message);
    this.name = "GeminiApiError";
    this.statusCode = statusCode;
    this.apiStatus = apiStatus;
    this.retryable = retryable;
    this.retryDelayMs = retryDelayMs;
  }
}

export function normalizeGeminiError(error: unknown, model: string): GeminiApiError {
  const parsed = parseGeminiError(error);
  const quotaExceeded = parsed.statusCode === 429 || parsed.apiStatus === "RESOURCE_EXHAUSTED";

  if (quotaExceeded) {
    const hasNoFreeTierQuota = /limit:\s*0/i.test(parsed.message);
    const hint = hasNoFreeTierQuota
      ? "The API key project currently has no usable free-tier quota. Set up Gemini API billing/paid tier in AI Studio, add prepaid credits if required, or switch to an API key from a project with quota."
      : "Retry later, reduce request frequency, or reduce input size.";
    const quotas = parsed.quotaIds.length > 0 ? ` Quotas: ${parsed.quotaIds.join(", ")}.` : "";
    return new GeminiApiError({
      message: `Gemini API quota exceeded for model ${model}. ${hint}${quotas}`,
      statusCode: parsed.statusCode,
      apiStatus: parsed.apiStatus,
      retryable: !hasNoFreeTierQuota,
      retryDelayMs: parsed.retryDelayMs,
    });
  }

  return new GeminiApiError({
    message: `Gemini API request failed for model ${model}: ${parsed.message}`,
    statusCode: parsed.statusCode,
    apiStatus: parsed.apiStatus,
    retryable: false,
  });
}

export class DryRunGeminiClient implements GeminiClient {
  async generate(prompt: string): Promise<string> {
    if (prompt.includes("[TASK: SOURCE_ANALYSIS]")) {
      const staticOverview = extractPromptSection(prompt, "## 事前抽出済みの構造情報", "## 入力ファイル抜粋");
      return [
        "## ソースコード解析結果（dry-run）",
        "",
        "- Gemini API は呼び出していません。",
        "- 事前抽出済みの構造情報と prompt 構造の確認用レスポンスです。",
        "",
        truncate(staticOverview, 3000),
      ].join("\n");
    }
    if (prompt.includes("[TASK: DOCUMENT_EXTRACTION]")) {
      const documentOverview = extractPromptSection(
        prompt,
        "## 事前抽出済みのドキュメント情報",
        "## ドキュメント抜粋",
      );
      return [
        "## ドキュメント抽出結果（dry-run）",
        "",
        "- Gemini API は呼び出していません。",
        "- 事前抽出済みのドキュメント情報と prompt 構造の確認用レスポンスです。",
        "",
        truncate(documentOverview, 3000),
      ].join("\n");
    }
    if (prompt.includes("[TASK: INFRASTRUCTURE_SPEC]")) {
      const iacOverview = extractPromptSection(
        prompt,
        "## 事前抽出済みのIaC構造情報",
        "## IaC入力ファイル抜粋",
      );
      return [
        "## インフラ構成抽出結果（dry-run）",
        "",
        "- Gemini API は呼び出していません。",
        "- 事前抽出済みの IaC 構造情報と prompt 構造の確認用レスポンスです。",
        "",
        truncate(iacOverview, 3000),
      ].join("\n");
    }
    if (prompt.includes("[TASK: TRUE_DESIGN]")) {
      const sourceSummary = extractPromptSection(prompt, "## ソースコード解析結果", "## ドキュメント抽出結果");
      return [
        "# 真の設計書（dry-run）",
        "",
        "この成果物はローカル動作確認用です。",
        "Gemini API を呼び出さず、生成フェーズの接続だけを確認しています。",
        "",
        "## ソースコード解析サマリー",
        "",
        truncate(sourceSummary, 5000),
      ].join("\n");
    }
    if (prompt.includes("[TASK: DRIFT_REPORT]")) {
      const sourceSummary = extractPromptSection(prompt, "## ソースコード解析結果", "## ドキュメント抽出結果");
      const documentSummary = extractPromptSection(prompt, "## ドキュメント抽出結果", "ジョブID:");
      return [
        "# ドキュメント差分レポート（dry-run）",
        "",
        "この成果物はローカル動作確認用です。",
        "Gemini API を呼び出さず、差分生成フェーズの接続だけを確認しています。",
        "",
        "| 分類 | 件数 |",
        "| --- | ---: |",
        "| 実装あり・文書なし | 0 |",
        "| 文書あり・実装なし | 0 |",
        "| 内容不一致 | 0 |",
        "| 判断不能 | 0 |",
        "",
        "## 比較入力サマリー",
        "",
        "### ソースコード解析結果",
        "",
        truncate(sourceSummary, 2500),
        "",
        "### ドキュメント抽出結果",
        "",
        truncate(documentSummary, 2500),
      ].join("\n");
    }
    return "Gemini dry-run response";
  }
}

export function buildGeminiClient(settings: GeminiSettings): GeminiClient {
  if (settings.dryRun) {
    return new DryRunGeminiClient();
  }
  return new GoogleGenAIClient(settings);
}

function extractPromptSection(prompt: string, startMarker: string, endMarker: string): string {
  let start = prompt.indexOf(startMarker);
  if (start < 0) {
    return "";
  }
  start += startMarker.length;
  let end = prompt.indexOf(endMarker, start);
  if (end < 0) {
    end = prompt.length;
  }
  return prompt.slice(start, end).trim();
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function parseGeminiError(error: unknown): {
  message: string;
  statusCode: number | null;
  apiStatus: string | null;
  quotaIds: string[];
  retryDelayMs: number | null;
} {
  const fallbackMessage = error instanceof Error ? error.message : String(error);
  const statusCode = numberFromUnknown(getObjectValue(error, "code"));
  const apiStatus = stringFromUnknown(getObjectValue(error, "status"));
  const payload = parseErrorPayload(fallbackMessage);
  const apiError = asRecord(payload?.error);
  const details = Array.isArray(apiError?.details) ? apiError.details : [];

  return {
    message: stringFromUnknown(apiError?.message) || fallbackMessage,
    statusCode: numberFromUnknown(apiError?.code) ?? statusCode,
    apiStatus: stringFromUnknown(apiError?.status) || apiStatus,
    quotaIds: extractQuotaIds(details),
    retryDelayMs: extractRetryDelayMs(details),
  };
}

function parseErrorPayload(message: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(message));
  } catch {
    return null;
  }
}

function extractQuotaIds(details: unknown[]): string[] {
  const quotaIds: string[] = [];
  for (const detail of details) {
    const record = asRecord(detail);
    if (!record) {
      continue;
    }
    if (!String(record?.["@type"] || "").endsWith("QuotaFailure")) {
      continue;
    }
    const violations = Array.isArray(record.violations) ? record.violations : [];
    for (const violation of violations) {
      const quotaId = stringFromUnknown(asRecord(violation)?.quotaId);
      if (quotaId) {
        quotaIds.push(quotaId);
      }
    }
  }
  return [...new Set(quotaIds)];
}

function extractRetryDelayMs(details: unknown[]): number | null {
  for (const detail of details) {
    const record = asRecord(detail);
    if (!record) {
      continue;
    }
    if (!String(record?.["@type"] || "").endsWith("RetryInfo")) {
      continue;
    }
    const retryDelay = stringFromUnknown(record.retryDelay);
    const match = retryDelay?.match(/^(\d+(?:\.\d+)?)s$/);
    if (match) {
      return Math.ceil(Number(match[1]) * 1000);
    }
  }
  return null;
}

function retryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getObjectValue(value: unknown, key: string): unknown {
  return asRecord(value)?.[key];
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

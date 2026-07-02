import { GoogleGenAI } from "@google/genai";

export class GeminiSettings {
  apiKey: string | null;
  model: string;
  dryRun: boolean;
  useVertexAi: boolean;
  project: string | null;
  location: string | null;

  constructor({
    apiKey = null,
    model = "gemini-3.1-flash-lite",
    dryRun = false,
    useVertexAi,
    project = null,
    location = null,
  }: {
    apiKey?: string | null;
    model?: string;
    dryRun?: boolean;
    useVertexAi?: boolean;
    project?: string | null;
    location?: string | null;
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.dryRun = dryRun;
    this.useVertexAi = useVertexAi !== undefined ? useVertexAi : true;
    this.project = project;
    this.location = location;
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
    if (settings.useVertexAi) {
      if (!settings.project || !settings.location) {
        throw new Error("GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are required when Vertex AI is enabled");
      }
      this.client = new GoogleGenAI({
        vertexai: true,
        project: settings.project,
        location: settings.location,
      });
    } else {
      if (!settings.apiKey) {
        throw new Error("GEMINI_API_KEY is required when dry-run is disabled");
      }
      this.client = new GoogleGenAI({ apiKey: settings.apiKey });
    }
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
    if (prompt.includes("[TASK: SSOT_SYNTHESIS]")) {
      const infrastructureSpec = extractPromptSection(
        prompt,
        "## 個別解析結果: インフラ/IaC",
        "## 個別解析結果: API/インターフェース",
      );
      const apiSpec = extractPromptSection(
        prompt,
        "## 個別解析結果: API/インターフェース",
        "## 個別解析結果: DB・データモデル",
      );
      const databaseSpec = extractPromptSection(
        prompt,
        "## 個別解析結果: DB・データモデル",
        "## 個別解析結果: ビジネスロジック・ユースケース",
      );
      const businessLogicSpec = extractPromptSection(
        prompt,
        "## 個別解析結果: ビジネスロジック・ユースケース",
        "## ソースコード解析結果（補助根拠）",
      );
      return [
        "# Single Source of Truth（dry-run）",
        "",
        "この成果物はローカル動作確認用です。",
        "Gemini API を呼び出さず、SSOT合成フェーズの接続だけを確認しています。",
        "",
        "## システムコンポーネント図",
        "",
        "```mermaid",
        "flowchart LR",
        "    Client[Client] --> API[API]",
        "    API --> Logic[Business Logic]",
        "    Logic --> DB[(Database)]",
        "    API --> Infra[Runtime Infrastructure]",
        "```",
        "",
        "## データフロー図",
        "",
        "```mermaid",
        "sequenceDiagram",
        "    participant User as ユーザー",
        "    participant API as API",
        "    participant Logic as ビジネスロジック",
        "    participant DB as DB",
        "    User->>API: (dry-run) リクエスト",
        "    API->>Logic: 入力検証とユースケース呼び出し",
        "    Logic->>DB: 参照/更新",
        "    DB-->>Logic: 結果",
        "    Logic-->>API: レスポンス生成",
        "    API-->>User: (dry-run) レスポンス",
        "```",
        "",
        "## 入力サマリー",
        "",
        "### インフラ/IaC",
        "",
        truncate(infrastructureSpec, 1200),
        "",
        "### API/インターフェース",
        "",
        truncate(apiSpec, 1200),
        "",
        "### DB・データモデル",
        "",
        truncate(databaseSpec, 1200),
        "",
        "### ビジネスロジック",
        "",
        truncate(businessLogicSpec, 1200),
      ].join("\n");
    }
    if (prompt.includes("[TASK: DATABASE_SCHEMA_ANALYSIS]")) {
      const codebaseMapSection = extractPromptSection(
        prompt,
        "## STEP 1 成果物: コードベースマップ（codebase-map.json 抜粋）",
        "## DB関連ソースコード",
      );
      const databaseSourceSection = extractPromptSection(
        prompt,
        "## DB関連ソースコード",
        "__END_OF_DATABASE_SCHEMA_PROMPT__",
      );
      return [
        "# DB・データモデル仕様書（dry-run）",
        "",
        "この成果物はローカル動作確認用です。",
        "Gemini API を呼び出さず、DB・データモデル解析フェーズの接続だけを確認しています。",
        "",
        "## 解析対象サマリー",
        "",
        "- dry-run のため実際の解析は行っていません。",
        "",
        "## ER図",
        "",
        "```mermaid",
        "erDiagram",
        "    DRY_RUN_ENTITY {",
        "        string id",
        "    }",
        "```",
        "",
        "## テーブル一覧",
        "",
        "| テーブル/モデル | 概要 | 主キー | 根拠ファイル |",
        "| --- | --- | --- | --- |",
        "| DRY_RUN_ENTITY | DB解析フェーズの接続確認 | id | - |",
        "",
        "## 入力サマリー",
        "",
        "### コードベースマップ",
        "",
        truncate(codebaseMapSection, 2000),
        "",
        "### DB関連ソースコード",
        "",
        truncate(databaseSourceSection, 2000),
      ].join("\n");
    }
    if (prompt.includes("[TASK: BUSINESS_LOGIC_ANALYSIS]")) {
      const codebaseMapSection = extractPromptSection(
        prompt,
        "## STEP 1 成果物: コードベースマップ（codebase-map.json）",
        "## STEP 1 成果物: エクスポートシンボル一覧",
      );
      const exportedSymbolsSection = extractPromptSection(
        prompt,
        "## STEP 1 成果物: エクスポートシンボル一覧",
        "## ビジネスロジック関連ソースコード",
      );
      return [
        "# ビジネスロジック仕様書（dry-run）",
        "",
        "この成果物はローカル動作確認用です。",
        "Gemini API を呼び出さず、ビジネスロジック解析フェーズの接続だけを確認しています。",
        "",
        "## 解析対象サマリー",
        "",
        "- dry-run のため実際の解析は行っていません。",
        "",
        "## 機能一覧",
        "",
        "| 機能名 | 概要 | 対象サービス | 根拠ファイル |",
        "| --- | --- | --- | --- |",
        "| (dry-run) | ビジネスロジック解析フェーズの接続確認 | - | - |",
        "",
        "## ユースケースシナリオ",
        "",
        "dry-run のためユースケースシナリオは生成されていません。",
        "",
        "## 状態遷移",
        "",
        "dry-run のため状態遷移は解析されていません。",
        "",
        "## シーケンス図",
        "",
        "```mermaid",
        "sequenceDiagram",
        "    participant User as ユーザー",
        "    participant System as システム",
        "    User->>System: (dry-run) ビジネスロジック解析フェーズの接続確認",
        "    System-->>User: (dry-run) 確認完了",
        "```",
        "",
        "## 入力サマリー",
        "",
        "### コードベースマップ",
        "",
        truncate(codebaseMapSection, 2000),
        "",
        "### エクスポートシンボル",
        "",
        truncate(exportedSymbolsSection, 2000),
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

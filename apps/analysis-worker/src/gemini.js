"use strict";

class GeminiSettings {
  constructor({ apiKey = null, model = "gemini-2.0-flash", dryRun = false } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.dryRun = dryRun;
  }
}

class GoogleGenAIClient {
  constructor(settings) {
    if (!settings.apiKey) {
      throw new Error("GEMINI_API_KEY is required when dry-run is disabled");
    }
    const { GoogleGenAI } = require("@google/genai");
    this.client = new GoogleGenAI({ apiKey: settings.apiKey });
    this.model = settings.model;
  }

  async generate(prompt) {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
    });
    return response.text || String(response);
  }
}

class DryRunGeminiClient {
  async generate(prompt) {
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
      const documentOverview = extractPromptSection(prompt, "## 事前抽出済みのドキュメント情報", "## ドキュメント抜粋");
      return [
        "## ドキュメント抽出結果（dry-run）",
        "",
        "- Gemini API は呼び出していません。",
        "- 事前抽出済みのドキュメント情報と prompt 構造の確認用レスポンスです。",
        "",
        truncate(documentOverview, 3000),
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

function buildGeminiClient(settings) {
  if (settings.dryRun || !settings.apiKey) {
    return new DryRunGeminiClient();
  }
  return new GoogleGenAIClient(settings);
}

function extractPromptSection(prompt, startMarker, endMarker) {
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

function truncate(text, maxChars) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

module.exports = {
  DryRunGeminiClient,
  GeminiSettings,
  GoogleGenAIClient,
  buildGeminiClient,
};

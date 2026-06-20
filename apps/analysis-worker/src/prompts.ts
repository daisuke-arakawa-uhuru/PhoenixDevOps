import { AnalysisTaskPayload } from "./payload.js";

export interface AnalysisInput {
  sourceArchiveUri: string;
  sourceFiles: Array<{ path: string; content: string }>;
  infrastructureFiles?: Array<{ path: string; content: string }>;
  documentUris: string[];
  documentFiles: Array<{ path: string; content: string }>;
}

export interface SpecificationResult {
  summary: string;
}

export function buildSourceAnalysisPrompt(
  payload: AnalysisTaskPayload,
  inputs: AnalysisInput,
  staticOverviewMarkdown: string = "",
): string {
  return [
    "[TASK: SOURCE_ANALYSIS]",
    "",
    "あなたはレガシー Web アプリケーションの実装仕様を抽出する解析エンジンです。",
    "ソースコードを正として扱い、根拠を示せない内容は断定しないでください。",
    "",
    "## 解析対象",
    "",
    `- ジョブID: ${payload.jobId}`,
    `- プロジェクト名: ${payload.projectName || "未指定"}`,
    `- ソース: ${inputs.sourceArchiveUri}`,
    "",
    "## 抽出してほしい項目",
    "",
    "- ファイル構成",
    "- 技術スタックと依存関係",
    "- ルーティング、画面、API",
    "- DB定義、データモデル",
    "- 業務ルール、バリデーション",
    "- 外部連携",
    "- 判断不能、推測事項",
    "",
    "## 出力形式",
    "",
    "Markdown で、各項目に根拠ファイルパスを添えてください。",
    "",
    "## 事前抽出済みの構造情報",
    "",
    staticOverviewMarkdown || "事前抽出済みの構造情報はありません。",
    "",
    "## 入力ファイル抜粋",
    "",
    formatTextFiles(inputs.sourceFiles),
  ].join("\n");
}

export function buildDocumentExtractionPrompt(
  payload: AnalysisTaskPayload,
  inputs: AnalysisInput,
  documentOverviewMarkdown: string = "",
): string {
  return [
    "[TASK: DOCUMENT_EXTRACTION]",
    "",
    "あなたは既存ドキュメントから仕様記述を抽出するエンジンです。",
    "古いドキュメントには実装と乖離した内容が含まれる可能性があります。",
    "文書に書かれている内容と、根拠ドキュメントを分けて整理してください。",
    "",
    "## 解析対象",
    "",
    `- ジョブID: ${payload.jobId}`,
    `- プロジェクト名: ${payload.projectName || "未指定"}`,
    "",
    "## ドキュメント一覧",
    "",
    ...inputs.documentUris.map((uri) => `- ${uri}`),
    "",
    "## 出力形式",
    "",
    "Markdown で、仕様項目、内容、根拠ドキュメント、判断不能事項を整理してください。",
    "",
    "## 事前抽出済みのドキュメント情報",
    "",
    documentOverviewMarkdown || "事前抽出済みのドキュメント情報はありません。",
    "",
    "## ドキュメント抜粋",
    "",
    formatTextFiles(inputs.documentFiles),
  ].join("\n");
}

export function buildTrueDesignPrompt(
  payload: AnalysisTaskPayload,
  sourceSpecification: SpecificationResult,
  documentSpecification: SpecificationResult,
): string {
  return [
    "[TASK: TRUE_DESIGN]",
    "",
    "あなたはソースコード由来の情報を正として、真の設計書を Markdown で生成します。",
    "既存ドキュメントは補助情報として扱い、根拠がない推測は断定しないでください。",
    "",
    "## 出力章",
    "",
    "1. 解析対象",
    "2. システム概要",
    "3. 技術スタック",
    "4. 主要機能一覧",
    "5. 画面・ルーティング一覧",
    "6. API一覧",
    "7. データモデル",
    "8. 業務ルール・バリデーション",
    "9. 外部連携",
    "10. 判断不能・推測事項",
    "",
    "## ソースコード解析結果",
    "",
    sourceSpecification.summary,
    "",
    "## ドキュメント抽出結果",
    "",
    documentSpecification.summary,
    "",
    `ジョブID: ${payload.jobId}`,
    `プロジェクト名: ${payload.projectName || "未指定"}`,
  ].join("\n");
}

export function buildDriftReportPrompt(
  payload: AnalysisTaskPayload,
  sourceSpecification: SpecificationResult,
  documentSpecification: SpecificationResult,
): string {
  return [
    "[TASK: DRIFT_REPORT]",
    "",
    "あなたはソースコード由来の実装仕様と既存ドキュメント仕様を比較し、",
    "ドキュメント差分レポートを Markdown で生成します。",
    "",
    "## 差分分類",
    "",
    "- 実装あり・文書なし",
    "- 文書あり・実装なし",
    "- 内容不一致",
    "- 判断不能",
    "",
    "## 判断ルール",
    "",
    "- ソースコードを正とする",
    "- 根拠を示せない内容は断定しない",
    "- 重要度、確度、根拠コード、根拠ドキュメント、推奨対応を出す",
    "",
    "## ソースコード解析結果",
    "",
    sourceSpecification.summary,
    "",
    "## ドキュメント抽出結果",
    "",
    documentSpecification.summary,
    "",
    `ジョブID: ${payload.jobId}`,
    `プロジェクト名: ${payload.projectName || "未指定"}`,
  ].join("\n");
}

function formatTextFiles(files: Array<{ path: string; content: string }>): string {
  const blocks = files.map((file) =>
    [`### ${file.path}`, "", "```text", file.content, "```"].join("\n"),
  );
  return blocks.length === 0 ? "入力ファイル本文はまだ取得されていません。" : blocks.join("\n\n");
}

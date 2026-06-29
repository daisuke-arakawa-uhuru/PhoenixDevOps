import { AnalysisTaskPayload } from "./payload.js";

export interface AnalysisInput {
  sourceArchiveUri: string;
  sourceFiles: Array<{ path: string; content: string }>;
  documentUris: string[];
  documentFiles: Array<{ path: string; content: string }>;
  allSourceFiles?: Array<{ path: string; content: string }>;
}

export interface SpecificationResult {
  summary: string;
}

export interface SynthesisComponentSpecifications {
  infrastructureSpecMarkdown: string | null;
  apiSpecMarkdown: string | null;
  databaseSchemaSpecMarkdown: string | null;
  businessLogicSpecMarkdown: string | null;
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

export function buildSsotSynthesisPrompt(
  payload: AnalysisTaskPayload,
  sourceSpecification: SpecificationResult,
  documentSpecification: SpecificationResult,
  componentSpecifications: SynthesisComponentSpecifications,
): string {
  return [
    "[TASK: SSOT_SYNTHESIS]",
    "",
    "あなたはレガシーシステムの個別解析結果を統合し、",
    "システム全体の真実の仕様書（Single Source of Truth）を作成する統合エージェントです。",
    "ソースコード由来の解析結果を正として扱い、既存ドキュメントは補助情報としてのみ扱ってください。",
    "根拠が不足する項目は断定せず、「判断不能」または「推測」と明示してください。",
    "",
    "## 統合対象",
    "",
    `- ジョブID: ${payload.jobId}`,
    `- プロジェクト名: ${payload.projectName || "未指定"}`,
    "",
    "## 統合方針",
    "",
    "- インフラ、API、DB、ビジネスロジックの関係を接着して、コンポーネント間の依存関係を説明してください。",
    "- エンドポイントから入力検証、ユースケース、DB更新、バックグラウンド処理、インフラ実行基盤までのデータフローを追ってください。",
    "- Mermaid によるシステムコンポーネント図とデータフロー図を必ず出力してください。",
    "- 入力された個別仕様書に矛盾がある場合は、矛盾点と優先した根拠を明示してください。",
    "- 入力が不足している専門領域は、ソースコード解析結果から判明する範囲だけを書き、不明点を残してください。",
    "",
    "## 出力形式（必ず以下のMarkdown構成で出力してください）",
    "",
    "1. **解析対象サマリー** — 対象プロジェクト、統合した入力、根拠の優先順位",
    "2. **システム全体像** — 主要コンポーネント、責務、外部接続、実行基盤",
    "3. **システムコンポーネント図** — Mermaid flowchart 形式",
    "4. **データフロー図** — Mermaid flowchart または sequenceDiagram 形式",
    "5. **コンポーネント責務一覧** — インフラ/API/DB/ビジネスロジックの責務と根拠",
    "6. **エンドポイント別データフロー** — APIエンドポイント、呼び出すユースケース、参照/更新DB、非同期処理、根拠",
    "7. **バックグラウンド処理・非同期処理** — キュー、バッチ、イベント処理、リトライ/失敗時挙動",
    "8. **インフラとアプリケーションの対応** — 実行基盤、ストレージ、DB、ネットワーク/IAM、根拠",
    "9. **横断的な仕様** — 認証認可、バリデーション、トランザクション、監視、セキュリティ",
    "10. **判断不能・推測事項** — 未確定事項、追加で必要な情報、矛盾やリスク",
    "",
    "## 個別解析結果: インフラ/IaC",
    "",
    formatOptionalMarkdown(
      componentSpecifications.infrastructureSpecMarkdown,
      "インフラ/IaC 個別仕様は生成されていません。ソースコード解析結果の IaC 候補を参照してください。",
    ),
    "",
    "## 個別解析結果: API/インターフェース",
    "",
    formatOptionalMarkdown(
      componentSpecifications.apiSpecMarkdown,
      "API 個別仕様は生成されていません。ソースコード解析結果のルーティング/API候補を参照してください。",
    ),
    "",
    "## 個別解析結果: DB・データモデル",
    "",
    formatOptionalMarkdown(
      componentSpecifications.databaseSchemaSpecMarkdown,
      "DB・データモデル個別仕様は生成されていません。",
    ),
    "",
    "## 個別解析結果: ビジネスロジック・ユースケース",
    "",
    formatOptionalMarkdown(
      componentSpecifications.businessLogicSpecMarkdown,
      "ビジネスロジック個別仕様は生成されていません。",
    ),
    "",
    "## ソースコード解析結果（補助根拠）",
    "",
    sourceSpecification.summary,
    "",
    "## 既存ドキュメント抽出結果（補助情報）",
    "",
    documentSpecification.summary,
  ].join("\n");
}

function formatTextFiles(files: Array<{ path: string; content: string }>): string {
  const blocks = files.map((file) =>
    [`### ${file.path}`, "", "```text", file.content, "```"].join("\n"),
  );
  return blocks.length === 0 ? "入力ファイル本文はまだ取得されていません。" : blocks.join("\n\n");
}

function formatOptionalMarkdown(markdown: string | null, emptyMessage: string): string {
  return markdown && markdown.trim() ? markdown.trim() : emptyMessage;
}

export function buildDatabaseSchemaAnalysisPrompt(
  payload: AnalysisTaskPayload,
  inputs: AnalysisInput,
  databaseDefinitionFiles: Array<{ path: string; content: string }>,
  codebaseMapJson: string,
): string {
  return [
    "[TASK: DATABASE_SCHEMA_ANALYSIS]",
    "",
    "あなたはレガシー Web アプリケーションの DB・データモデルを解析する専門エンジンです。",
    "DBマイグレーション、DDL、ORM定義、モデル定義を読み取り、",
    "テーブル構造、リレーション、インデックス、制約を抽出して「DB・データモデル仕様書」を生成します。",
    "",
    "## 解析対象",
    "",
    `- ジョブID: ${payload.jobId}`,
    `- プロジェクト名: ${payload.projectName || "未指定"}`,
    `- ソース: ${inputs.sourceArchiveUri}`,
    "",
    "## 解析の方針",
    "",
    "- ソースコードとDB定義ファイルを正として扱い、根拠を示せない内容は断定しないでください。",
    "- カラム、型、制約、インデックス、外部キー、リレーションは根拠ファイルパス付きで整理してください。",
    "- ORM定義から推測したDB物理名は「推測」と明示してください。",
    "- 解析できない箇所は「判断不能」として明示してください。",
    "",
    "## 出力形式（必ず以下のMarkdown構成で出力してください）",
    "",
    "1. **解析対象サマリー** — 解析したDB関連ファイル数、検出したテーブル/モデル候補数",
    "2. **ER図** — Mermaid erDiagram 形式。根拠不足の場合は判明範囲だけを出力",
    "3. **テーブル一覧** — テーブル/モデル名、概要、主キー、主要リレーション、根拠ファイルパス",
    "4. **データディクショナリ** — テーブルごとにカラム名、型、Nullable、Default、制約、説明、根拠",
    "5. **リレーション一覧** — 親、子、カーディナリティ、外部キー、根拠",
    "6. **インデックス・制約一覧** — PK、FK、Unique、Index、Check、Not Null、根拠",
    "7. **判断不能・推測事項** — 解析できなかった項目、推測した項目、追加で必要な情報",
    "",
    "## STEP 1 成果物: コードベースマップ（codebase-map.json 抜粋）",
    "",
    "```json",
    codebaseMapJson,
    "```",
    "",
    "## DB関連ソースコード",
    "",
    formatTextFiles(databaseDefinitionFiles),
  ].join("\n");
}

export function buildBusinessLogicAnalysisPrompt(
  payload: AnalysisTaskPayload,
  inputs: AnalysisInput,
  businessLogicFiles: Array<{ path: string; content: string }>,
  codebaseMapJson: string,
  exportedSymbolsSummary: string,
): string {
  return [
    "[TASK: BUSINESS_LOGIC_ANALYSIS]",
    "",
    "あなたはレガシー Web アプリケーションのビジネスロジック・ユースケースを解析する専門エンジンです。",
    "サービス層（Service）、ドメインモデル、ユースケース（UseCase）のソースコードを読み取り、",
    "主要なビジネスフロー、条件分岐、状態遷移などを抽出して「ビジネスロジック仕様書」を生成します。",
    "",
    "## 解析対象",
    "",
    `- ジョブID: ${payload.jobId}`,
    `- プロジェクト名: ${payload.projectName || "未指定"}`,
    `- ソース: ${inputs.sourceArchiveUri}`,
    "",
    "## 解析の方針",
    "",
    "- ソースコードを正として扱い、根拠を示せない内容は断定しないでください。",
    "- インフラやUI層のノイズ情報は排除し、ビジネスロジックに焦点を当ててください。",
    "- 解析できない箇所は「判断不能」として明示してください。",
    "",
    "## 出力形式（必ず以下のMarkdown構成で出力してください）",
    "",
    "### 出力章",
    "",
    "1. **解析対象サマリー** — 解析したファイル数、対象サービス・ドメインの一覧",
    "2. **機能一覧** — 機能名、概要、対象サービス/ドメイン、根拠ファイルパス。テーブル形式で出力",
    "3. **ユースケースシナリオ** — 各ユースケースについて:",
    "   - ユースケース名",
    "   - アクター（利用者/呼び出し元）",
    "   - 前提条件",
    "   - メインフロー（番号付きステップ）",
    "   - 代替フロー / 例外フロー",
    "   - 後条件",
    "   - 根拠ファイルパス",
    "4. **状態遷移** — 状態遷移がある場合:",
    "   - 状態（state）一覧テーブル",
    "   - トリガー（イベント/アクション）一覧テーブル",
    "   - 遷移テーブル（現在の状態 → トリガー → 次の状態 → 根拠コード）",
    "   - Mermaid stateDiagram-v2 形式の状態遷移図",
    "5. **シーケンス図** — 主要なビジネスフローをMermaid sequenceDiagram形式で出力",
    "   - 少なくとも主要フロー1つ以上のシーケンス図を出力",
    "6. **例外処理・ロールバック仕様** — エラーハンドリング、ロールバック処理の一覧",
    "7. **ビジネスルール・バリデーション** — ビジネス上の制約、バリデーションルール",
    "8. **判断不能・推測事項** — 解析できなかった箇所とその理由",
    "",
    "## STEP 1 成果物: コードベースマップ（codebase-map.json）",
    "",
    "```json",
    codebaseMapJson,
    "```",
    "",
    "## STEP 1 成果物: エクスポートシンボル一覧",
    "",
    exportedSymbolsSummary,
    "",
    "## ビジネスロジック関連ソースコード",
    "",
    formatTextFiles(businessLogicFiles),
  ].join("\n");
}

import path from "node:path";
import { AnalysisTaskPayload } from "./payload.js";
import { AnalysisInput } from "./prompts.js";
import { GeminiClient } from "./gemini.js";

/**
 * Issue #34: ビジネスロジック・ユースケース個別解析エージェント
 * 
 * サービス層、ドメインモデル、ユースケース定義などのソースコードを専門に解析し、
 * 主要なビジネスフローの言語化、状態遷移のトリガーと遷移先特定、機能一覧などを抽出して
 * `business_logic_spec.md` を生成する。
 */

export interface BusinessLogicFile {
  path: string;
  content: string;
}

export interface BusinessLogicSymbol {
  kind: string;
  name: string;
  source: string;
}

export interface BusinessLogicOverview {
  files: Array<{
    path: string;
    language: string;
    lines: number;
    characters: number;
  }>;
  symbols: BusinessLogicSymbol[];
  totalFiles: number;
  totalLines: number;
  totalCharacters: number;
}

export interface BusinessLogicAgent {
  analyze(payload: AnalysisTaskPayload, inputs: AnalysisInput): Promise<string>;
}

const BUSINESS_LOGIC_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".php", ".cs", ".cpp", ".c", ".hpp", ".h"
]);

const MAX_ROWS = 150;

/**
 * ソース入力からビジネスロジックとみなせるコードファイルだけを抽出する。
 */
export function filterBusinessLogicFiles(files: BusinessLogicFile[]): BusinessLogicFile[] {
  return files.filter((file) => isBusinessLogicFile(file));
}

export function isBusinessLogicFile(file: BusinessLogicFile): boolean {
  const normalizedPath = normalizePath(file.path);
  const suffix = path.extname(normalizedPath).toLowerCase();
  const fileName = path.basename(normalizedPath).toLowerCase();

  // 1. ビジネスロジックを記述する言語の拡張子かチェック
  if (!BUSINESS_LOGIC_EXTENSIONS.has(suffix)) {
    return false;
  }

  // 2. テストファイルやテスト関連ディレクトリの除外
  if (isTestFile(normalizedPath)) {
    return false;
  }

  // 3. インフラ・IaC関連ファイルの除外
  if (isIacFile(normalizedPath, file.content)) {
    return false;
  }

  // 4. 除外すべき一般的なディレクトリ（node_modules、distなど）のチェック
  const excludedDirs = [
    "/node_modules/", "/dist/", "/build/", "/coverage/", "/.git/", "/.github/",
    "/.vscode/", "/.next/", "/.storybook/", "/playwright/", "/profile/", "/debug/", "/generated/"
  ];
  if (excludedDirs.some((d) => normalizedPath.toLowerCase().includes(d))) {
    return false;
  }

  // 5. 設定ファイルなどの除外
  const excludedBasenames = [
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "go.sum",
    ".gitignore", ".prettierrc", ".eslintrc.js", "jest.config.js",
    "vitest.config.ts", "tsconfig.json", "webpack.config.js", "vite.config.ts",
    "requirements.txt", "pyproject.toml", "go.mod", "gemfile", "composer.json"
  ];
  if (excludedBasenames.includes(fileName)) {
    return false;
  }

  return true;
}

function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const parts = lower.split("/");
  const name = parts.at(-1) || "";
  
  return (
    parts.slice(0, -1).some((part) => ["test", "tests", "spec", "specs"].includes(part)) ||
    name.startsWith("test_") ||
    name.endsWith("_test.py") ||
    name.includes(".test.") ||
    name.includes(".spec.")
  );
}

function isIacFile(filePath: string, content: string): boolean {
  const suffix = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();

  // Terraform
  if ([".tf", ".tfvars", ".hcl"].includes(suffix)) {
    return true;
  }
  // docker-compose
  if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(fileName)) {
    return true;
  }
  // Dockerfile
  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) {
    return true;
  }
  // Kubernetes manifests (simple heuristic)
  if ((suffix === ".yaml" || suffix === ".yml") && /(^|\n)apiVersion\s*:/.test(content) && /(^|\n)kind\s*:/.test(content)) {
    return true;
  }
  // AWS CDK (simple heuristic)
  if (fileName === "cdk.json" || fileName === "cdk.context.json" || filePath.includes("/cdk.out/")) {
    return true;
  }
  return false;
}

export function buildBusinessLogicOverview(files: BusinessLogicFile[]): BusinessLogicOverview {
  const sortedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
  
  const fileItems = sortedFiles.map((file) => {
    const lines = file.content ? file.content.split(/\r?\n/).length : 0;
    return {
      path: normalizePath(file.path),
      language: languageFromPath(file.path),
      lines,
      characters: file.content.length,
    };
  });

  const symbols: BusinessLogicSymbol[] = [];
  for (const file of sortedFiles) {
    symbols.push(...parseSymbols(file));
  }

  const totalFiles = files.length;
  const totalLines = fileItems.reduce((sum, item) => sum + item.lines, 0);
  const totalCharacters = fileItems.reduce((sum, item) => sum + item.characters, 0);

  return {
    files: fileItems,
    symbols,
    totalFiles,
    totalLines,
    totalCharacters,
  };
}

function parseSymbols(file: BusinessLogicFile): BusinessLogicSymbol[] {
  const fileSymbols: BusinessLogicSymbol[] = [];
  const suffix = path.extname(file.path).toLowerCase();
  const lines = file.content.split(/\r?\n/);

  // JS / TS symbol extraction
  const JS_TS_PATTERNS = [
    { re: /^\s*export\s+(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/, kind: "function" },
    { re: /^\s*export\s+(?:abstract\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/, kind: "class" },
    { re: /^\s*export\s+interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/, kind: "interface" },
    { re: /^\s*export\s+type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/, kind: "type" },
    { re: /^\s*export\s+enum\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/, kind: "enum" },
    { re: /^\s*export\s+(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/, kind: "const" },
    { re: /^\s*export\s+default\s+(?:function|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/, kind: "default" },
    { re: /^\s*(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*require\(/, kind: "require" }
  ];

  // Python symbol extraction
  const PY_PATTERNS = [
    { re: /^\s{4}def\s+([a-zA-Z_][a-zA-Z0-9_]*)/, kind: "method" },
    { re: /^\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)/, kind: "class" },
    { re: /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)/, kind: "function" }
  ];

  // Go symbol extraction
  const GO_PATTERNS = [
    { re: /^\s*func\s+([a-zA-Z_][a-zA-Z0-9_]*)/, kind: "function" },
    { re: /^\s*func\s+\(\s*(?:\*?\s*[a-zA-Z0-9_]+)?\s+\)?\s*([a-zA-Z_][a-zA-Z0-9_]*)/, kind: "method" },
    { re: /^\s*type\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:struct|interface|type)/, kind: "type" }
  ];

  // Generic patterns for Java, C#, PHP, Ruby, etc.
  const GENERIC_PATTERNS = [
    { re: /^\s*(?:public|protected|private|static|\s)+\s+(?:class|interface|enum)\s+([a-zA-Z0-9_]+)/, kind: "type" },
    { re: /^\s*(?:public|protected|private|static|\s)+\s+function\s+([a-zA-Z0-9_]+)/, kind: "function" },
    { re: /^\s*def\s+([a-zA-Z0-9_]+)/, kind: "function" } // Ruby def
  ];

  lines.forEach((rawLine, index) => {
    const source = `${normalizePath(file.path)}:${index + 1}`;

    let patterns = GENERIC_PATTERNS;
    if ([".js", ".jsx", ".ts", ".tsx"].includes(suffix)) {
      patterns = JS_TS_PATTERNS;
    } else if (suffix === ".py") {
      patterns = PY_PATTERNS;
    } else if (suffix === ".go") {
      patterns = GO_PATTERNS;
    }

    for (const pattern of patterns) {
      const match = rawLine.match(pattern.re);
      if (match && match[1]) {
        fileSymbols.push({
          kind: pattern.kind,
          name: match[1],
          source,
        });
        break;
      }
    }
  });

  return fileSymbols;
}

export function renderBusinessLogicOverviewMarkdown(overview: BusinessLogicOverview): string {
  const lines = [
    "## 事前抽出済みのビジネスロジック構造情報",
    "",
    "### サマリー",
    "",
    `- 対象ファイル数: ${overview.totalFiles}`,
    `- 総行数: ${overview.totalLines}`,
    `- 総文字数: ${overview.totalCharacters}`,
    "",
    "### 解析対象ビジネスロジックファイル",
    "",
    "| ファイル | 言語 | 行数 | 文字数 |",
    "| --- | --- | ---: | ---: |",
    ...overview.files.map(
      (file) => `| ${file.path} | ${file.language} | ${file.lines} | ${file.characters} |`
    ),
    "",
    "### 検出された主要シンボル (クラス・関数等)",
    "",
  ];

  if (overview.symbols.length === 0) {
    lines.push("主要なシンボルは静的に検出されませんでした。");
  } else {
    lines.push(
      "| 種別 | シンボル名 | 定義箇所 |",
      "| --- | --- | --- |",
      ...overview.symbols
        .slice(0, MAX_ROWS)
        .map((s) => `| ${s.kind} | \`${s.name}\` | ${s.source} |`)
    );
    if (overview.symbols.length > MAX_ROWS) {
      lines.push(`| ... 他 ${overview.symbols.length - MAX_ROWS} 件のシンボルを省略 | | |`);
    }
  }

  return lines.join("\n");
}

export function buildBusinessLogicSpecPrompt(
  payload: AnalysisTaskPayload,
  overviewMarkdown: string,
  businessFiles: BusinessLogicFile[]
): string {
  return [
    "[TASK: BUSINESS_LOGIC_SPEC]",
    "",
    "あなたは提供されたWebアプリケーションのソースコードから、ビジネスロジック（サービス、ドメインモデル、ユースケース等）を専門に解析するアーキテクトです。",
    "ソースコードを正として扱い、根拠を示せない内容は断定せず「判断不能」または「推測」として明記してください。",
    "",
    "## 解析対象",
    "",
    `- ジョブID: ${payload.jobId}`,
    `- プロジェクト名: ${payload.projectName || "未指定"}`,
    "",
    "## 抽出・整理してほしい項目",
    "",
    "以下の章立てでドキュメントを生成してください：",
    "",
    "### 1. 主要機能・ユースケース一覧",
    "- システムで提供されている主要機能（ユースケース）を洗い出し、それぞれの概要と関係するソースコードを整理してください。",
    "- 各機能のインプット・アウトプットや、関連するAPI/エンドポイント情報があれば併記してください。",
    "",
    "### 2. 主要なビジネスフローの言語化",
    "- 主要な処理（データの登録・更新、状態変更、外部システム連携など）のフローを順を追って分かりやすく解説してください。",
    "- 依存関係や制御の記述があるファイル・関数を根拠として示してください。",
    "",
    "### 3. 状態遷移とトリガー",
    "- システム内のエンティティやデータがどのような「状態（ステータス）」を持ち、どのような処理（トリガー）によって遷移するかを特定・整理してください。",
    "- （例: チケットのステータスが OPEN から CLOSED に変わるトリガーとなる処理や条件）",
    "",
    "### 4. 業務ルール・バリデーション規則",
    "- 入力値の制限、必須条件、およびデータ更新時に適用される制約条件を抽出して記載してください。",
    "- 例外発生時の挙動（どのようなエラーが返るか）も併記してください。",
    "",
    "### 5. 判断不能・推測事項",
    "- コード上で実装が確認できないビジネスルールや、コメントと実装の矛盾、推測に留まった点などを整理してください。",
    "",
    "## 出力形式",
    "Markdown形式で出力してください。それぞれの記述には、根拠となったファイルパスや関数・クラス名を必ず記載してください。",
    "",
    "## 事前抽出済みのビジネスロジック構造情報",
    "",
    overviewMarkdown,
    "",
    "## ビジネスロジック入力ファイル本文",
    "",
    formatBusinessLogicFiles(businessFiles),
  ].join("\n");
}

function formatBusinessLogicFiles(files: BusinessLogicFile[]): string {
  if (files.length === 0) {
    return "ビジネスロジック入力ファイルは検出されませんでした。";
  }
  return files
    .map((file) => [
      `### ${normalizePath(file.path)}`,
      "",
      `\`\`\`${codeFenceForPath(file.path)}`,
      file.content,
      "```"
    ].join("\n"))
    .join("\n\n");
}

function codeFenceForPath(filePath: string): string {
  const suffix = path.extname(filePath).toLowerCase();
  if (suffix === ".ts" || suffix === ".tsx") return "typescript";
  if (suffix === ".js" || suffix === ".jsx") return "javascript";
  if (suffix === ".py") return "python";
  if (suffix === ".go") return "go";
  if (suffix === ".java") return "java";
  if (suffix === ".rb") return "ruby";
  if (suffix === ".php") return "php";
  if (suffix === ".cs") return "csharp";
  return "text";
}

function languageFromPath(filePath: string): string {
  const suffix = path.extname(filePath).toLowerCase();
  const languages: Record<string, string> = {
    ".js": "JavaScript",
    ".jsx": "React JSX",
    ".ts": "TypeScript",
    ".tsx": "React TSX",
    ".py": "Python",
    ".go": "Go",
    ".java": "Java",
    ".rb": "Ruby",
    ".php": "PHP",
    ".cs": "C#",
    ".cpp": "C++",
    ".c": "C",
    ".hpp": "C++ Header",
    ".h": "C/C++ Header"
  };
  return languages[suffix] || "Unknown";
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/").replaceAll("\\", "/");
}

export class PlaceholderBusinessLogicAgent implements BusinessLogicAgent {
  async analyze(payload: AnalysisTaskPayload, inputs: AnalysisInput): Promise<string> {
    const title = payload.projectName || payload.jobId;
    return [
      `# ビジネスロジック・ユースケース仕様書 (business_logic_spec.md)`,
      `- ジョブID: ${payload.jobId}`,
      `- プロジェクト名: ${title}`,
      "",
      "ビジネスロジック入力ファイルが検出されなかったか、ドライランのプレースホルダーです。",
      "",
      "## 1. 主要機能・ユースケース一覧",
      "- 該当なし / 解析対象コードが見つかりません。",
      "",
      "## 2. 主要なビジネスフローの言語化",
      "- 該当なし",
      "",
      "## 3. 状態遷移とトリガー",
      "- 該当なし",
      "",
      "## 4. 業務ルール・バリデーション規則",
      "- 該当なし",
      "",
      "## 5. 判断不能・推測事項",
      "- コードベース内にビジネスロジックに該当するファイルが検出されませんでした。"
    ].join("\n");
  }
}

export class GeminiBusinessLogicAgent implements BusinessLogicAgent {
  constructor(private geminiClient: GeminiClient) {}

  async analyze(payload: AnalysisTaskPayload, inputs: AnalysisInput): Promise<string> {
    const businessFiles = collectBusinessLogicInputs(inputs);
    if (businessFiles.length === 0) {
      return new PlaceholderBusinessLogicAgent().analyze(payload, inputs);
    }

    const overview = buildBusinessLogicOverview(businessFiles);
    const overviewMarkdown = renderBusinessLogicOverviewMarkdown(overview);
    const prompt = buildBusinessLogicSpecPrompt(payload, overviewMarkdown, businessFiles);
    const response = await this.geminiClient.generate(prompt);

    return [
      `# ビジネスロジック・ユースケース仕様書`,
      `- ジョブID: ${payload.jobId}`,
      `- プロジェクト名: ${payload.projectName || "未指定"}`,
      "",
      overviewMarkdown,
      "",
      `## Gemini抽出結果`,
      "",
      response
    ].join("\n");
  }
}

function collectBusinessLogicInputs(inputs: AnalysisInput): BusinessLogicFile[] {
  const files = [
    ...filterBusinessLogicFiles(inputs.allSourceFiles ?? []),
    ...filterBusinessLogicFiles(inputs.sourceFiles)
  ];
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.path)) {
      return false;
    }
    seen.add(file.path);
    return true;
  });
}

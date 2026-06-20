import path from "node:path";
import { AnalysisTaskPayload } from "./payload.js";
import { AnalysisInput } from "./prompts.js";
import { GeminiClient } from "./gemini.js";

/**
 * Issue #31: インフラ・IaC個別解析エージェント。
 *
 * Terraform / docker-compose / Kubernetes マニフェストなどの IaC コードを専門に解析し、
 * 物理/論理構成とセキュリティ設計（セキュリティグループ・IAM 等）を抽出して
 * `infrastructure_spec.md` を生成する。
 *
 * 方針はリポジトリ全体と揃える。
 * - IaC コードを「正」として扱い、根拠を示せない内容は断定しない。
 * - まず外部 CLI に依存しない軽量な静的抽出を行い、その結果を Gemini の prompt に渡す。
 */

export interface IacFile {
  path: string;
  content: string;
}

export interface TerraformBlock {
  /** provider / resource / data / module / variable / output / locals / backend */
  kind: string;
  /** リソースタイプ（例: google_compute_firewall）。resource/data 以外では空。 */
  type: string;
  /** ブロック名・ラベル。 */
  name: string;
  source: string;
}

export interface ComposeService {
  name: string;
  image: string;
  ports: string[];
  source: string;
}

export interface K8sManifest {
  kind: string;
  name: string;
  namespace: string;
  source: string;
}

export interface SecurityFinding {
  category: string;
  detail: string;
  source: string;
}

export interface IacOverview {
  terraformFiles: string[];
  composeFiles: string[];
  k8sFiles: string[];
  providers: TerraformBlock[];
  resources: TerraformBlock[];
  dataSources: TerraformBlock[];
  modules: TerraformBlock[];
  variables: TerraformBlock[];
  outputs: TerraformBlock[];
  backends: TerraformBlock[];
  composeServices: ComposeService[];
  k8sManifests: K8sManifest[];
  securityFindings: SecurityFinding[];
}

const TERRAFORM_EXTENSIONS = new Set([".tf", ".tfvars", ".hcl"]);
const MAX_ROWS = 200;

/** セキュリティ設計として明示したい Terraform リソースタイプのパターン。 */
const SECURITY_TYPE_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /(security_group|firewall)/i, category: "ネットワーク境界（SG/Firewall）" },
  { pattern: /iam|policy|role|binding|member|service_account/i, category: "IAM・権限設定" },
  { pattern: /kms|crypto_key|key_ring/i, category: "暗号鍵管理" },
  { pattern: /secret/i, category: "シークレット管理" },
  { pattern: /(public_access_block|acl|bucket_policy)/i, category: "ストレージ公開設定" },
];

/** ソース入力から IaC とみなせるファイルだけを抽出する。 */
export function filterIacFiles(files: IacFile[]): IacFile[] {
  return files.filter((file) => isIacFile(file));
}

export function isIacFile(file: IacFile): boolean {
  const suffix = path.extname(file.path).toLowerCase();
  if (TERRAFORM_EXTENSIONS.has(suffix)) {
    return true;
  }
  if (isComposeFile(file.path)) {
    return true;
  }
  if (suffix === ".yaml" || suffix === ".yml") {
    return looksLikeK8sManifest(file.content);
  }
  return false;
}

export function buildIacOverview(files: IacFile[]): IacOverview {
  const normalized = files
    .map((file) => ({ path: normalizePath(file.path), content: file.content }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const terraformFiles = normalized
    .filter((file) => TERRAFORM_EXTENSIONS.has(path.extname(file.path).toLowerCase()))
    .map((file) => file.path);
  const composeFiles = normalized.filter((file) => isComposeFile(file.path)).map((file) => file.path);
  const k8sFiles = normalized
    .filter(
      (file) =>
        [".yaml", ".yml"].includes(path.extname(file.path).toLowerCase()) &&
        !isComposeFile(file.path) &&
        looksLikeK8sManifest(file.content),
    )
    .map((file) => file.path);

  const blocks: TerraformBlock[] = [];
  for (const file of normalized) {
    if (TERRAFORM_EXTENSIONS.has(path.extname(file.path).toLowerCase())) {
      blocks.push(...parseTerraformBlocks(file));
    }
  }

  const composeServices: ComposeService[] = [];
  for (const file of normalized) {
    if (isComposeFile(file.path)) {
      composeServices.push(...parseComposeServices(file));
    }
  }

  const k8sManifests: K8sManifest[] = [];
  for (const file of normalized) {
    if (k8sFiles.includes(file.path)) {
      k8sManifests.push(...parseK8sManifests(file));
    }
  }

  const resources = blocks.filter((block) => block.kind === "resource");
  const securityFindings = collectSecurityFindings(resources, composeServices);

  return {
    terraformFiles,
    composeFiles,
    k8sFiles,
    providers: blocks.filter((block) => block.kind === "provider"),
    resources: limit(resources),
    dataSources: limit(blocks.filter((block) => block.kind === "data")),
    modules: limit(blocks.filter((block) => block.kind === "module")),
    variables: limit(blocks.filter((block) => block.kind === "variable")),
    outputs: limit(blocks.filter((block) => block.kind === "output")),
    backends: blocks.filter((block) => block.kind === "backend"),
    composeServices: limit(composeServices),
    k8sManifests: limit(k8sManifests),
    securityFindings: limit(securityFindings),
  };
}

/** 静的抽出結果を Markdown サマリーに整形する（prompt と成果物の双方で使う）。 */
export function renderIacOverviewMarkdown(overview: IacOverview): string {
  const hasInput =
    overview.terraformFiles.length + overview.composeFiles.length + overview.k8sFiles.length > 0;
  if (!hasInput) {
    return "## 静的IaC構造解析結果\n\nIaC として解析可能なファイル（Terraform / docker-compose / Kubernetes マニフェスト）は検出されませんでした。";
  }

  return [
    "## 静的IaC構造解析結果",
    "",
    "### 解析対象ファイル",
    "",
    `- Terraform: ${overview.terraformFiles.length} 件`,
    `- docker-compose: ${overview.composeFiles.length} 件`,
    `- Kubernetes マニフェスト: ${overview.k8sFiles.length} 件`,
    "",
    "### Terraform Provider",
    "",
    ...bullets(overview.providers.map((block) => `${block.name} (${block.source})`), "Provider 宣言は検出されませんでした。"),
    "",
    "### クラウドリソース（resource）",
    "",
    ...blockTable(overview.resources, "リソース定義は検出されませんでした。"),
    "",
    "### 参照データソース（data）",
    "",
    ...blockTable(overview.dataSources, "データソース参照は検出されませんでした。"),
    "",
    "### モジュール（module）",
    "",
    ...bullets(
      overview.modules.map((block) => `${block.name} (${block.source})`),
      "モジュール呼び出しは検出されませんでした。",
    ),
    "",
    "### 変数・出力",
    "",
    `- variable: ${overview.variables.length} 件 / output: ${overview.outputs.length} 件`,
    `- backend: ${overview.backends.map((block) => block.name).join(", ") || "未検出（ローカル state の可能性）"}`,
    "",
    "### docker-compose サービス",
    "",
    ...composeTable(overview.composeServices),
    "",
    "### Kubernetes マニフェスト",
    "",
    ...k8sTable(overview.k8sManifests),
    "",
    "### セキュリティ設計の着目点",
    "",
    ...securityTable(overview.securityFindings),
  ].join("\n");
}

export interface InfrastructureAgent {
  analyze(payload: AnalysisTaskPayload, inputs: AnalysisInput): Promise<string>;
}

/** IaC が見つからない場合に使う、Gemini を呼ばないフォールバックエージェント。 */
export class PlaceholderInfrastructureAgent implements InfrastructureAgent {
  async analyze(): Promise<string> {
    return [
      "# インフラ物理/論理構成仕様（infrastructure_spec）",
      "",
      "解析対象に IaC コードが含まれていなかったため、構成を抽出できませんでした。",
      "Terraform / docker-compose / Kubernetes マニフェスト等を含めて再実行してください。",
      "",
    ].join("\n");
  }
}

export class GeminiInfrastructureAgent implements InfrastructureAgent {
  constructor(private geminiClient: GeminiClient) {}

  async analyze(payload: AnalysisTaskPayload, inputs: AnalysisInput): Promise<string> {
    const iacFiles = filterIacFiles(inputs.sourceFiles);
    const overview = buildIacOverview(iacFiles);
    const overviewMarkdown = renderIacOverviewMarkdown(overview);
    const prompt = buildInfrastructureSpecPrompt(payload, overviewMarkdown, iacFiles);
    const response = await this.geminiClient.generate(prompt);
    return joinSections(
      `# インフラ物理/論理構成仕様（infrastructure_spec）`,
      `- ジョブID: ${payload.jobId}`,
      `- プロジェクト名: ${payload.projectName || "未指定"}`,
      overviewMarkdown,
      `## Gemini抽出結果\n\n${response}`,
    );
  }
}

export function buildInfrastructureSpecPrompt(
  payload: AnalysisTaskPayload,
  overviewMarkdown: string,
  iacFiles: IacFile[],
): string {
  return [
    "[TASK: INFRASTRUCTURE_SPEC]",
    "",
    "あなたはインフラ構成とIaC（Terraform / docker-compose / Kubernetes）を専門に解析するエンジンです。",
    "IaC コードを正として扱い、コードから読み取れない内容は断定せず「判断不能」として明示してください。",
    "",
    "## 解析対象",
    "",
    `- ジョブID: ${payload.jobId}`,
    `- プロジェクト名: ${payload.projectName || "未指定"}`,
    "",
    "## 抽出してほしい項目",
    "",
    "- 物理/論理構成: 本来構成されるべきクラウドリソース（ネットワーク/VPC、コンピュート、データストア、ロードバランサ、ストレージ等）をコードから逆算・抽出する。",
    "- リソース間の依存関係・接続関係。",
    "- セキュリティ設計: セキュリティグループ/ファイアウォール、IAM ロール・権限、暗号化、シークレット管理、公開範囲。",
    "- 環境差分・変数化されている設定。",
    "- 判断不能・推測事項。",
    "",
    "## 出力形式",
    "",
    "Markdown で、各項目に根拠ファイルパスを添えて出力してください。章立ては次を推奨します。",
    "",
    "1. システム構成概要",
    "2. 論理構成（リソース一覧と役割）",
    "3. ネットワーク構成",
    "4. セキュリティ設計（SG/Firewall・IAM・暗号化・シークレット）",
    "5. 依存関係・接続関係",
    "6. 判断不能・推測事項",
    "",
    "## 事前抽出済みのIaC構造情報",
    "",
    overviewMarkdown,
    "",
    "## IaC入力ファイル抜粋",
    "",
    formatIacFiles(iacFiles),
  ].join("\n");
}

// ---- Terraform parser ------------------------------------------------------

function parseTerraformBlocks(file: IacFile): TerraformBlock[] {
  const blocks: TerraformBlock[] = [];
  const lines = file.content.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = stripComment(rawLine).trim();
    const source = `${file.path}:${index + 1}`;

    const resource = line.match(/^(resource|data)\s+"([^"]+)"\s+"([^"]+)"/);
    if (resource) {
      blocks.push({ kind: resource[1], type: resource[2], name: resource[3], source });
      return;
    }

    const labeled = line.match(/^(provider|module|variable|output)\s+"([^"]+)"/);
    if (labeled) {
      blocks.push({ kind: labeled[1], type: "", name: labeled[2], source });
      return;
    }

    const backend = line.match(/^backend\s+"([^"]+)"/);
    if (backend) {
      blocks.push({ kind: "backend", type: "", name: backend[1], source });
    }
  });
  return blocks;
}

function stripComment(line: string): string {
  const hashIndex = line.indexOf("#");
  const slashIndex = line.indexOf("//");
  const cut = [hashIndex, slashIndex].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  return cut == null ? line : line.slice(0, cut);
}

// ---- docker-compose parser -------------------------------------------------

function parseComposeServices(file: IacFile): ComposeService[] {
  const services: ComposeService[] = [];
  const lines = file.content.split(/\r?\n/);
  let inServices = false;
  let current: ComposeService | null = null;
  let inPorts = false;

  lines.forEach((rawLine, index) => {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      inServices = /^services\s*:/.test(trimmed);
      return;
    }
    if (!inServices) {
      return;
    }

    // サービス名は services: 直下（インデント 2 想定）の "name:"。
    const serviceMatch = trimmed.match(/^([A-Za-z0-9._-]+)\s*:$/);
    if (indent <= 2 && serviceMatch) {
      current = { name: serviceMatch[1], image: "", ports: [], source: `${file.path}:${index + 1}` };
      services.push(current);
      inPorts = false;
      return;
    }
    if (!current) {
      return;
    }

    const imageMatch = trimmed.match(/^image\s*:\s*["']?([^"'#]+?)["']?\s*$/);
    if (imageMatch) {
      current.image = imageMatch[1].trim();
      inPorts = false;
      return;
    }
    if (/^ports\s*:/.test(trimmed)) {
      inPorts = true;
      return;
    }
    if (inPorts) {
      const portMatch = trimmed.match(/^-\s*["']?([0-9.:]+(?:->[0-9]+)?[0-9./:]*)["']?/);
      if (portMatch) {
        current.ports.push(portMatch[1]);
        return;
      }
      inPorts = false;
    }
  });

  return services;
}

// ---- Kubernetes parser -----------------------------------------------------

function looksLikeK8sManifest(content: string): boolean {
  return /(^|\n)apiVersion\s*:/.test(content) && /(^|\n)kind\s*:/.test(content);
}

function parseK8sManifests(file: IacFile): K8sManifest[] {
  const manifests: K8sManifest[] = [];
  // `---` 区切りの複数ドキュメントに対応する。
  const documents = file.content.split(/^---\s*$/m);
  let offset = 1;
  for (const doc of documents) {
    const lineCount = doc.split(/\r?\n/).length;
    const kind = doc.match(/(^|\n)kind\s*:\s*["']?([A-Za-z0-9.-]+)/);
    if (kind) {
      const name = doc.match(/(^|\n)\s*name\s*:\s*["']?([A-Za-z0-9._-]+)/);
      const namespace = doc.match(/(^|\n)\s*namespace\s*:\s*["']?([A-Za-z0-9._-]+)/);
      manifests.push({
        kind: kind[2],
        name: name ? name[2] : "(名前未指定)",
        namespace: namespace ? namespace[2] : "default",
        source: `${file.path}:${offset}`,
      });
    }
    offset += lineCount;
  }
  return manifests;
}

// ---- security findings -----------------------------------------------------

function collectSecurityFindings(
  resources: TerraformBlock[],
  composeServices: ComposeService[],
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const resource of resources) {
    for (const rule of SECURITY_TYPE_PATTERNS) {
      if (rule.pattern.test(resource.type)) {
        findings.push({
          category: rule.category,
          detail: `${resource.type}.${resource.name}`,
          source: resource.source,
        });
        break;
      }
    }
  }
  for (const service of composeServices) {
    const exposed = service.ports.find((port) => /^0\.0\.0\.0|^\d+(\.\d+){3}|^\d+:/.test(port));
    if (exposed) {
      findings.push({
        category: "ストレージ公開設定",
        detail: `compose サービス ${service.name} がポート ${exposed} を公開`,
        source: service.source,
      });
    }
  }
  return findings;
}

// ---- formatting helpers ----------------------------------------------------

function isComposeFile(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(name);
}

function formatIacFiles(files: IacFile[]): string {
  if (files.length === 0) {
    return "IaC 入力ファイルは検出されませんでした。";
  }
  return files
    .map((file) => [`### ${file.path}`, "", "```hcl", file.content, "```"].join("\n"))
    .join("\n\n");
}

function bullets(values: string[], empty: string): string[] {
  return values.length === 0 ? [empty] : values.map((value) => `- ${value}`);
}

function blockTable(blocks: TerraformBlock[], empty: string): string[] {
  if (blocks.length === 0) {
    return [empty];
  }
  return [
    "| タイプ | 名前 | 根拠 |",
    "| --- | --- | --- |",
    ...blocks.map((block) => `| ${block.type} | ${block.name} | ${block.source} |`),
  ];
}

function composeTable(services: ComposeService[]): string[] {
  if (services.length === 0) {
    return ["docker-compose サービスは検出されませんでした。"];
  }
  return [
    "| サービス | イメージ | 公開ポート | 根拠 |",
    "| --- | --- | --- | --- |",
    ...services.map(
      (service) =>
        `| ${service.name} | ${service.image || "(未指定)"} | ${service.ports.join(", ") || "-"} | ${service.source} |`,
    ),
  ];
}

function k8sTable(manifests: K8sManifest[]): string[] {
  if (manifests.length === 0) {
    return ["Kubernetes マニフェストは検出されませんでした。"];
  }
  return [
    "| Kind | 名前 | Namespace | 根拠 |",
    "| --- | --- | --- | --- |",
    ...manifests.map(
      (manifest) => `| ${manifest.kind} | ${manifest.name} | ${manifest.namespace} | ${manifest.source} |`,
    ),
  ];
}

function securityTable(findings: SecurityFinding[]): string[] {
  if (findings.length === 0) {
    return ["セキュリティ関連リソース（SG/Firewall・IAM 等）は静的には検出されませんでした。"];
  }
  return [
    "| 分類 | 対象 | 根拠 |",
    "| --- | --- | --- |",
    ...findings.map((finding) => `| ${finding.category} | ${finding.detail} | ${finding.source} |`),
  ];
}

function limit<T>(items: T[]): T[] {
  return items.slice(0, MAX_ROWS);
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function joinSections(...sections: string[]): string {
  return `${sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n")}\n`;
}

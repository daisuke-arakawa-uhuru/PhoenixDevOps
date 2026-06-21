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

export type InfrastructureFileKind =
  | "terraform"
  | "docker-compose"
  | "kubernetes"
  | "aws-cdk"
  | "cloudformation"
  | "dockerfile"
  | "f01-artifact";

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
  cdkFiles: string[];
  cloudFormationFiles: string[];
  dockerfiles: string[];
  f01ArtifactFiles: string[];
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
const CDK_SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".kt", ".cs"]);
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
  return classifyInfrastructureFile(file) != null;
}

export function classifyInfrastructureFile(file: IacFile): InfrastructureFileKind | null {
  const normalizedPath = normalizePath(file.path);
  const logicalFilePath = stripArchivePrefix(normalizedPath);
  const suffix = path.extname(logicalFilePath).toLowerCase();
  const fileName = path.basename(logicalFilePath).toLowerCase();

  if (TERRAFORM_EXTENSIONS.has(suffix)) {
    return "terraform";
  }
  if (isComposeFile(logicalFilePath)) {
    return "docker-compose";
  }
  if (isDockerfile(logicalFilePath)) {
    return "dockerfile";
  }
  if (isF01Artifact(fileName)) {
    return "f01-artifact";
  }
  if (fileName === "cdk.json" || fileName === "cdk.context.json" || normalizedPath.includes("/cdk.out/")) {
    return "aws-cdk";
  }
  if (CDK_SOURCE_EXTENSIONS.has(suffix) && looksLikeAwsCdk(file.content)) {
    return "aws-cdk";
  }
  if (looksLikeCloudFormation(file.content)) {
    return "cloudformation";
  }
  if ((suffix === ".yaml" || suffix === ".yml") && looksLikeK8sManifest(file.content)) {
    return "kubernetes";
  }
  return null;
}

export function buildIacOverview(files: IacFile[]): IacOverview {
  const normalized = files
    .map((file) => ({ path: normalizePath(file.path), content: file.content }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const classified = normalized
    .map((file) => ({ file, kind: classifyInfrastructureFile(file) }))
    .filter((entry): entry is { file: IacFile; kind: InfrastructureFileKind } => entry.kind != null);
  const filesByKind = (kind: InfrastructureFileKind) =>
    classified.filter((entry) => entry.kind === kind).map((entry) => entry.file.path);

  const terraformFiles = filesByKind("terraform");
  const composeFiles = filesByKind("docker-compose");
  const k8sFiles = filesByKind("kubernetes");
  const cdkFiles = filesByKind("aws-cdk");
  const cloudFormationFiles = filesByKind("cloudformation");
  const dockerfiles = filesByKind("dockerfile");
  const f01ArtifactFiles = filesByKind("f01-artifact");

  const blocks: TerraformBlock[] = [];
  for (const entry of classified) {
    if (entry.kind === "terraform") {
      blocks.push(...parseTerraformBlocks(entry.file));
    }
  }

  const composeServices: ComposeService[] = [];
  for (const entry of classified) {
    if (entry.kind === "docker-compose") {
      composeServices.push(...parseComposeServices(entry.file));
    }
  }

  const k8sManifests: K8sManifest[] = [];
  for (const entry of classified) {
    if (entry.kind === "kubernetes") {
      k8sManifests.push(...parseK8sManifests(entry.file));
    }
  }

  const resources = blocks.filter((block) => block.kind === "resource");
  const dockerfileInputs = classified
    .filter((entry) => entry.kind === "dockerfile")
    .map((entry) => entry.file);
  const securityFindings = collectSecurityFindings(resources, composeServices, dockerfileInputs);

  return {
    terraformFiles,
    composeFiles,
    k8sFiles,
    cdkFiles,
    cloudFormationFiles,
    dockerfiles,
    f01ArtifactFiles,
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
    overview.terraformFiles.length +
      overview.composeFiles.length +
      overview.k8sFiles.length +
      overview.cdkFiles.length +
      overview.cloudFormationFiles.length +
      overview.dockerfiles.length +
      overview.f01ArtifactFiles.length >
    0;
  if (!hasInput) {
    return "## 静的IaC構造解析結果\n\nIaC として解析可能なファイル（Terraform / AWS CDK / docker-compose / Dockerfile / Kubernetes マニフェスト等）は検出されませんでした。";
  }

  return [
    "## 静的IaC構造解析結果",
    "",
    "### 解析対象ファイル",
    "",
    `- Terraform: ${overview.terraformFiles.length} 件`,
    `- docker-compose: ${overview.composeFiles.length} 件`,
    `- Kubernetes マニフェスト: ${overview.k8sFiles.length} 件`,
    `- AWS CDK: ${overview.cdkFiles.length} 件`,
    `- CloudFormation: ${overview.cloudFormationFiles.length} 件`,
    `- Dockerfile: ${overview.dockerfiles.length} 件`,
    `- F-01 成果物: ${overview.f01ArtifactFiles.length} 件`,
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
    "### F-01 / 補助 IaC 入力",
    "",
    ...supportingInputTable(overview),
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
  async analyze(_payload?: AnalysisTaskPayload, _inputs?: AnalysisInput): Promise<string> {
    return [
      "# インフラ物理/論理構成仕様（infrastructure_spec）",
      "",
      "解析対象に IaC コードが含まれていなかったため、構成を抽出できませんでした。",
      "Terraform / AWS CDK / docker-compose / Dockerfile / Kubernetes マニフェスト等を含めて再実行してください。",
      "",
    ].join("\n");
  }
}

export class GeminiInfrastructureAgent implements InfrastructureAgent {
  constructor(private geminiClient: GeminiClient) {}

  async analyze(payload: AnalysisTaskPayload, inputs: AnalysisInput): Promise<string> {
    const iacFiles = collectInfrastructureInputs(inputs);
    if (iacFiles.length === 0) {
      return new PlaceholderInfrastructureAgent().analyze(payload, inputs);
    }
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

function collectInfrastructureInputs(inputs: AnalysisInput): IacFile[] {
  const files = [
    ...(inputs.infrastructureFiles ?? []),
    ...filterIacFiles(inputs.allSourceFiles ?? []),
    ...filterIacFiles(inputs.sourceFiles),
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

export function buildInfrastructureSpecPrompt(
  payload: AnalysisTaskPayload,
  overviewMarkdown: string,
  iacFiles: IacFile[],
): string {
  return [
    "[TASK: INFRASTRUCTURE_SPEC]",
    "",
    "あなたはインフラ構成とIaC（Terraform / AWS CDK / docker-compose / Dockerfile / Kubernetes / CloudFormation）を専門に解析するエンジンです。",
    "IaC コードを正として扱い、コードから読み取れない内容は断定せず「判断不能」として明示してください。",
    "F-01 の codebase-map.json や exported-symbols-*.md が含まれる場合は、IaC ファイル特定と構造把握の補助情報として利用してください。",
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
    "- Dockerfile / compose から読み取れるコンテナ実行基盤、公開ポート、実行ユーザー、環境変数。",
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

function looksLikeAwsCdk(content: string): boolean {
  return /aws-cdk-lib|@aws-cdk\/|aws_cdk|software\.amazon\.awscdk/i.test(content);
}

function looksLikeCloudFormation(content: string): boolean {
  return (
    /AWSTemplateFormatVersion/i.test(content) ||
    (/(\n|^)\s*Resources\s*:/i.test(content) && /Type\s*:\s*AWS::/i.test(content)) ||
    (/"Resources"\s*:/i.test(content) && /"Type"\s*:\s*"AWS::/i.test(content))
  );
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
  dockerfiles: IacFile[],
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
  for (const dockerfile of dockerfiles) {
    for (const exposed of collectDockerfileExposedPorts(dockerfile)) {
      findings.push({
        category: "コンテナ公開ポート",
        detail: `Dockerfile が EXPOSE ${exposed.port} を宣言`,
        source: `${dockerfile.path}:${exposed.line}`,
      });
    }
  }
  return findings;
}

function collectDockerfileExposedPorts(file: IacFile): Array<{ port: string; line: number }> {
  const ports: Array<{ port: string; line: number }> = [];
  file.content.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!/^EXPOSE\s+/i.test(line)) {
      return;
    }
    const values = line.replace(/^EXPOSE\s+/i, "").split(/\s+/).filter(Boolean);
    for (const value of values) {
      ports.push({ port: value, line: index + 1 });
    }
  });
  return ports;
}

// ---- formatting helpers ----------------------------------------------------

function isComposeFile(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(name);
}

function isDockerfile(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return name === "dockerfile" || name.endsWith(".dockerfile");
}

function isF01Artifact(fileName: string): boolean {
  return fileName === "codebase-map.json" || /^exported-symbols-.*\.md$/.test(fileName);
}

function stripArchivePrefix(filePath: string): string {
  const marker = filePath.lastIndexOf("::");
  return marker >= 0 ? filePath.slice(marker + 2) : filePath;
}

function formatIacFiles(files: IacFile[]): string {
  if (files.length === 0) {
    return "IaC 入力ファイルは検出されませんでした。";
  }
  return files
    .map((file) => [`### ${file.path}`, "", `\`\`\`${codeFenceForPath(file.path)}`, file.content, "```"].join("\n"))
    .join("\n\n");
}

function codeFenceForPath(filePath: string): string {
  const logicalFilePath = stripArchivePrefix(filePath);
  const suffix = path.extname(logicalFilePath).toLowerCase();
  if (isDockerfile(logicalFilePath)) {
    return "dockerfile";
  }
  if (suffix === ".json") {
    return "json";
  }
  if (suffix === ".yaml" || suffix === ".yml") {
    return "yaml";
  }
  if (suffix === ".ts" || suffix === ".tsx") {
    return "ts";
  }
  if (suffix === ".js" || suffix === ".jsx") {
    return "js";
  }
  if (suffix === ".py") {
    return "py";
  }
  if (suffix === ".md") {
    return "md";
  }
  return "hcl";
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

function supportingInputTable(overview: IacOverview): string[] {
  const rows = [
    ...overview.cdkFiles.map((filePath) => ["AWS CDK", filePath]),
    ...overview.cloudFormationFiles.map((filePath) => ["CloudFormation", filePath]),
    ...overview.dockerfiles.map((filePath) => ["Dockerfile", filePath]),
    ...overview.f01ArtifactFiles.map((filePath) => ["F-01 成果物", filePath]),
  ];
  if (rows.length === 0) {
    return ["F-01成果物・CDK・CloudFormation・Dockerfile の補助入力は検出されませんでした。"];
  }
  return [
    "| 種別 | パス |",
    "| --- | --- |",
    ...rows.map(([kind, filePath]) => `| ${kind} | ${filePath} |`),
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

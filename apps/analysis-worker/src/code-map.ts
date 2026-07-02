import path from "node:path";

export interface SourceFile {
  path: string;
  content: string;
}

export interface FileMetadata {
  path: string;
  extension: string;
  language: string;
  lines: number;
  characters: number;
  roles: string[];
}

export interface Dependency {
  kind: string;
  name: string;
  version: string;
  path: string;
}

export interface ModuleDependency {
  source: string;
  target: string;
  specifier: string;
  kind: string;
  resolved: boolean;
}

export interface Route {
  method: string;
  path: string;
  source: string;
}

export interface DbDefinition {
  kind: string;
  name: string;
  path: string;
  line: string;
}

export interface TerraformBlock {
  kind: string;
  type: string;
  name: string;
  source: string;
  version: string;
  path: string;
  line: number;
}

export interface IacStructure {
  terraformFiles: string[];
  providers: TerraformBlock[];
  modules: TerraformBlock[];
  resources: TerraformBlock[];
  dataSources: TerraformBlock[];
  variables: TerraformBlock[];
  outputs: TerraformBlock[];
  locals: TerraformBlock[];
}

export interface CodebaseMap {
  summary: {
    fileCount: number;
    directoryCount: number;
    dependencyCount: number;
    moduleDependencyCount: number;
    terraformFileCount: number;
  };
  fileTree: string[];
  files: FileMetadata[];
  dependencies: Dependency[];
  moduleDependencies: ModuleDependency[];
  iac: IacStructure;
  apiRoutes: Route[];
  databaseDefinitions: DbDefinition[];
  configFiles: string[];
  readmeFiles: string[];
}

const MAX_TABLE_ROWS = 200;
const MAX_GRAPH_EDGES = 200;

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".css",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".php",
  ".prisma",
  ".py",
  ".rb",
  ".rs",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
]);

export function buildCodebaseMap(files: SourceFile[]): CodebaseMap {
  const normalizedFiles = files
    .map((file) => ({ path: normalizePath(file.path), content: file.content }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const filePaths = normalizedFiles.map((file) => file.path);
  const dependencies = collectDependencies(normalizedFiles);
  const moduleDependencies = collectModuleDependencies(normalizedFiles);
  const iac = collectIacStructure(normalizedFiles);
  const apiRoutes = collectApiRoutes(normalizedFiles);
  const databaseDefinitions = collectDatabaseDefinitions(normalizedFiles);
  const configFiles = filePaths.filter((filePath) => isConfigFile(filePath));
  const readmeFiles = filePaths.filter((filePath) =>
    path.basename(filePath).toLowerCase().startsWith("readme"),
  );

  return {
    summary: {
      fileCount: normalizedFiles.length,
      directoryCount: directoryCount(filePaths),
      dependencyCount: dependencies.length,
      moduleDependencyCount: moduleDependencies.length,
      terraformFileCount: iac.terraformFiles.length,
    },
    fileTree: buildDirectoryTree(filePaths),
    files: normalizedFiles.map(fileMetadata),
    dependencies,
    moduleDependencies,
    iac,
    apiRoutes,
    databaseDefinitions,
    configFiles,
    readmeFiles,
  };
}

export function codebaseMapArtifacts(
  codebaseMap: CodebaseMap,
  rawFiles: SourceFile[],
): Record<string, string> {
  const result: Record<string, string> = {
    "codebase-map.md": renderCodebaseMapMarkdown(codebaseMap),
    "module-dependencies.mmd": renderModuleDependenciesMermaid(codebaseMap),
    "iac-structure.md": renderIacStructureMarkdown(codebaseMap),
    "codebase-map.json": `${JSON.stringify(codebaseMap, null, 2)}\n`,
  };

  const filePaths = rawFiles.map((f) => f.path);
  const serviceBoundaries = detectServiceBoundaries(filePaths);

  // サービスごとのエクスポートシンボル分割書き出し
  const symbolsByService = buildExportedSymbolsByService(rawFiles, serviceBoundaries);
  for (const [svcName, content] of Object.entries(symbolsByService)) {
    const safeSvcName = svcName.replaceAll("/", "-");
    result[`exported-symbols-${safeSvcName}.md`] = content;
  }

  // api-spec ファイルが見つかれば追加
  const apiSpecFiles = extractApiSpecFiles(rawFiles);
  for (const [name, content] of Object.entries(apiSpecFiles)) {
    result[name] = content;
  }

  return result;
}

export function renderSourceOverviewMarkdown(codebaseMap: CodebaseMap): string {
  return [
    "## 静的構造解析結果",
    "",
    "### サマリー",
    "",
    ...formatSummary(codebaseMap),
    "",
    "### ディレクトリツリー",
    "",
    "```text",
    ...limitLines(codebaseMap.fileTree, 120),
    "```",
    "",
    "### 設定ファイル",
    "",
    ...formatBullets(codebaseMap.configFiles, "設定ファイル候補は検出されませんでした。"),
    "",
    "### README",
    "",
    ...formatBullets(codebaseMap.readmeFiles, "README候補は検出されませんでした。"),
    "",
    "### 依存関係",
    "",
    ...formatDependencyTable(codebaseMap.dependencies, 80),
    "",
    "### モジュール依存候補",
    "",
    ...formatModuleDependencyTable(codebaseMap.moduleDependencies, 80),
    "",
    "### IaC/Terraform 構成候補",
    "",
    ...formatIacSummary(codebaseMap.iac),
    "",
    "### ルーティング/API候補",
    "",
    ...formatRouteTable(codebaseMap.apiRoutes, 80),
    "",
    "### DB定義/データモデル候補",
    "",
    ...formatDatabaseTable(codebaseMap.databaseDefinitions, 80),
  ].join("\n");
}

export function renderCodebaseMapMarkdown(codebaseMap: CodebaseMap): string {
  return [
    "# Codebase Map",
    "",
    "## Summary",
    "",
    ...formatSummary(codebaseMap),
    "",
    "## Directory Tree",
    "",
    "```text",
    ...codebaseMap.fileTree,
    "```",
    "",
    "## File Metadata",
    "",
    ...formatFileMetadataTable(codebaseMap.files, MAX_TABLE_ROWS),
    "",
    "## Dependency Manifests",
    "",
    ...formatDependencyTable(codebaseMap.dependencies, MAX_TABLE_ROWS),
    "",
    "## Module Dependencies",
    "",
    ...formatModuleDependencyTable(codebaseMap.moduleDependencies, MAX_TABLE_ROWS),
    "",
    "## Config Files",
    "",
    ...formatBullets(codebaseMap.configFiles, "No config files detected."),
    "",
    "## README Files",
    "",
    ...formatBullets(codebaseMap.readmeFiles, "No README files detected."),
    "",
    "## API Route Candidates",
    "",
    ...formatRouteTable(codebaseMap.apiRoutes, MAX_TABLE_ROWS),
    "",
    "## Database Definition Candidates",
    "",
    ...formatDatabaseTable(codebaseMap.databaseDefinitions, MAX_TABLE_ROWS),
  ].join("\n");
}

export function renderModuleDependenciesMermaid(codebaseMap: CodebaseMap): string {
  const edges = codebaseMap.moduleDependencies.slice(0, MAX_GRAPH_EDGES);
  if (edges.length === 0) {
    return ['flowchart LR', '  empty["No module dependencies detected"]', ""].join("\n");
  }

  const nodeIds = new Map<string, string>();
  const nodeId = (label: string): string => {
    const existing = nodeIds.get(label);
    if (existing) {
      return existing;
    }
    const id = `n${nodeIds.size + 1}`;
    nodeIds.set(label, id);
    return id;
  };

  const lines = ["flowchart LR"];
  for (const edge of edges) {
    const sourceId = nodeId(edge.source);
    const targetId = nodeId(edge.target);
    lines.push(
      `  ${sourceId}["${escapeMermaidLabel(edge.source)}"] --> ${targetId}["${escapeMermaidLabel(edge.target)}"]`,
    );
  }
  if (codebaseMap.moduleDependencies.length > edges.length) {
    lines.push(
      `  omitted["${codebaseMap.moduleDependencies.length - edges.length} dependencies omitted"]`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderIacStructureMarkdown(codebaseMap: CodebaseMap): string {
  const iac = codebaseMap.iac;
  return [
    "# IaC Structure Dump",
    "",
    "## Summary",
    "",
    `- Terraform files: ${iac.terraformFiles.length}`,
    `- Providers: ${iac.providers.length}`,
    `- Modules: ${iac.modules.length}`,
    `- Resources: ${iac.resources.length}`,
    `- Data sources: ${iac.dataSources.length}`,
    `- Variables: ${iac.variables.length}`,
    `- Outputs: ${iac.outputs.length}`,
    "",
    "## Terraform Files",
    "",
    ...formatBullets(iac.terraformFiles, "No Terraform files detected."),
    "",
    "## Providers",
    "",
    ...formatTerraformBlockTable(iac.providers),
    "",
    "## Modules",
    "",
    ...formatTerraformBlockTable(iac.modules),
    "",
    "## Resources",
    "",
    ...formatTerraformBlockTable(iac.resources),
    "",
    "## Data Sources",
    "",
    ...formatTerraformBlockTable(iac.dataSources),
    "",
    "## Variables",
    "",
    ...formatTerraformBlockTable(iac.variables),
    "",
    "## Outputs",
    "",
    ...formatTerraformBlockTable(iac.outputs),
    "",
    "## Locals",
    "",
    ...formatTerraformBlockTable(iac.locals),
  ].join("\n");
}

function fileMetadata(file: SourceFile): FileMetadata {
  const extension = path.extname(file.path).toLowerCase();
  return {
    path: file.path,
    extension: extension || "(none)",
    language: languageFromPath(file.path),
    lines: file.content ? file.content.split(/\r?\n/).length : 0,
    characters: file.content.length,
    roles: classifyFile(file.path),
  };
}

function classifyFile(filePath: string): string[] {
  const roles: string[] = [];
  if (isDependencyManifest(filePath)) {
    roles.push("dependency_manifest");
  }
  if (isConfigFile(filePath)) {
    roles.push("config");
  }
  if (path.basename(filePath).toLowerCase().startsWith("readme")) {
    roles.push("readme");
  }
  if (isTestFile(filePath)) {
    roles.push("test");
  }
  if (path.extname(filePath).toLowerCase() === ".tf") {
    roles.push("iac");
  }
  if (isDatabaseDefinitionPath(filePath)) {
    roles.push("database_definition");
  }
  if (roles.length === 0 && SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    roles.push("source");
  }
  return roles.length === 0 ? ["other"] : roles;
}

function languageFromPath(filePath: string): string {
  const name = path.basename(filePath).toLowerCase();
  const suffix = path.extname(filePath).toLowerCase();
  if (name === "dockerfile") {
    return "Dockerfile";
  }
  const languages: Record<string, string> = {
    ".c": "C",
    ".conf": "Config",
    ".css": "CSS",
    ".csv": "CSV",
    ".go": "Go",
    ".h": "C/C++ Header",
    ".html": "HTML",
    ".java": "Java",
    ".js": "JavaScript",
    ".json": "JSON",
    ".jsx": "React JSX",
    ".kt": "Kotlin",
    ".lock": "Lockfile",
    ".md": "Markdown",
    ".php": "PHP",
    ".prisma": "Prisma",
    ".properties": "Properties",
    ".py": "Python",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".sh": "Shell",
    ".sql": "SQL",
    ".swift": "Swift",
    ".tf": "Terraform",
    ".toml": "TOML",
    ".ts": "TypeScript",
    ".tsx": "React TSX",
    ".txt": "Text",
    ".xml": "XML",
    ".yaml": "YAML",
    ".yml": "YAML",
  };
  return languages[suffix] || "Unknown";
}

function buildDirectoryTree(filePaths: string[]): string[] {
  if (filePaths.length === 0) {
    return ["."];
  }

  const root: TreeNode = { name: ".", children: new Map(), file: false };
  for (const filePath of filePaths) {
    let node = root;
    const parts = filePath.split("/").filter(Boolean);
    parts.forEach((part, index) => {
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, children: new Map(), file: index === parts.length - 1 };
        node.children.set(part, child);
      }
      if (index === parts.length - 1) {
        child.file = true;
      }
      node = child;
    });
  }

  const lines = ["."];
  appendTreeLines(lines, [...root.children.values()].sort(compareTreeNode), "");
  return lines;
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  file: boolean;
}

function appendTreeLines(lines: string[], nodes: TreeNode[], prefix: string): void {
  nodes.forEach((node, index) => {
    const last = index === nodes.length - 1;
    lines.push(`${prefix}${last ? "`-- " : "|-- "}${node.name}`);
    appendTreeLines(
      lines,
      [...node.children.values()].sort(compareTreeNode),
      `${prefix}${last ? "    " : "|   "}`,
    );
  });
}

function compareTreeNode(left: TreeNode, right: TreeNode): number {
  if (left.file !== right.file) {
    return left.file ? 1 : -1;
  }
  return left.name.localeCompare(right.name);
}

function directoryCount(filePaths: string[]): number {
  const directories = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  return directories.size;
}

function collectDependencies(files: SourceFile[]): Dependency[] {
  const dependencies: Dependency[] = [];
  for (const file of files) {
    const name = path.basename(file.path).toLowerCase();
    if (name === "package.json") {
      dependencies.push(...dependenciesFromPackageJson(file));
    } else if (name === "requirements.txt") {
      dependencies.push(...dependenciesFromRequirements(file));
    } else if (name === "pyproject.toml") {
      dependencies.push(...dependenciesFromPyproject(file));
    } else if (name === "go.mod") {
      dependencies.push(...dependenciesFromGoMod(file));
    } else if (name === "gemfile") {
      dependencies.push(...dependenciesFromGemfile(file));
    } else if (name === "composer.json") {
      dependencies.push(...dependenciesFromComposerJson(file));
    }
  }
  return uniqueBy(dependencies, (item) => `${item.kind}\0${item.name}\0${item.version}\0${item.path}`).slice(
    0,
    MAX_TABLE_ROWS,
  );
}

function dependenciesFromPackageJson(file: SourceFile): Dependency[] {
  let payload: any;
  try {
    payload = JSON.parse(file.content);
  } catch {
    return [];
  }

  const dependencies: Dependency[] = [];
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const values = payload[section];
    if (values == null || typeof values !== "object" || Array.isArray(values)) {
      continue;
    }
    for (const [name, version] of Object.entries(values).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      dependencies.push({
        kind: section,
        name: String(name),
        version: String(version),
        path: file.path,
      });
    }
  }
  return dependencies;
}

function dependenciesFromComposerJson(file: SourceFile): Dependency[] {
  let payload: any;
  try {
    payload = JSON.parse(file.content);
  } catch {
    return [];
  }

  const dependencies: Dependency[] = [];
  for (const section of ["require", "require-dev"]) {
    const values = payload[section];
    if (values == null || typeof values !== "object" || Array.isArray(values)) {
      continue;
    }
    for (const [name, version] of Object.entries(values).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (String(name).toLowerCase() === "php") {
        continue;
      }
      dependencies.push({
        kind: `php:${section}`,
        name: String(name),
        version: String(version),
        path: file.path,
      });
    }
  }
  return dependencies;
}

function dependenciesFromRequirements(file: SourceFile): Dependency[] {
  const dependencies: Dependency[] = [];
  for (const line of file.content.split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#") || stripped.startsWith("-")) {
      continue;
    }
    dependencies.push({
      kind: "python",
      name: dependencyName(stripped),
      version: stripped,
      path: file.path,
    });
  }
  return dependencies;
}

function dependenciesFromPyproject(file: SourceFile): Dependency[] {
  const dependencies: Dependency[] = [];
  let inDependencies = false;
  let inPoetryDependencies = false;
  for (const line of file.content.split(/\r?\n/)) {
    const stripped = line.trim();
    if (stripped === "[tool.poetry.dependencies]" || stripped === "[project.optional-dependencies]") {
      inPoetryDependencies = true;
      inDependencies = false;
      continue;
    }
    if (stripped.startsWith("[") && stripped.endsWith("]")) {
      inPoetryDependencies = false;
      inDependencies = false;
      continue;
    }
    if (stripped.startsWith("dependencies")) {
      inDependencies = stripped.includes("[") && !stripped.includes("]");
      dependencies.push(
        ...pyprojectDependencyEntries(
          [...stripped.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
          file.path,
        ),
      );
      continue;
    }
    if (inDependencies) {
      if (stripped.startsWith("]")) {
        inDependencies = false;
        continue;
      }
      dependencies.push(
        ...pyprojectDependencyEntries(
          [...stripped.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
          file.path,
        ),
      );
    } else if (inPoetryDependencies && stripped.includes("=")) {
      const [name, version] = stripped.split("=", 2).map((part) => part.trim());
      if (name && name.toLowerCase() !== "python") {
        dependencies.push({
          kind: "python",
          name,
          version: version.replace(/^["']|["']$/g, ""),
          path: file.path,
        });
      }
    }
  }
  return dependencies;
}

function pyprojectDependencyEntries(values: string[], filePath: string): Dependency[] {
  return values.map((value) => ({
    kind: "python",
    name: dependencyName(value),
    version: value,
    path: filePath,
  }));
}

function dependenciesFromGoMod(file: SourceFile): Dependency[] {
  const dependencies: Dependency[] = [];
  for (let line of file.content.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("//") || line.startsWith("module ")) {
      continue;
    }
    if (line.startsWith("require ")) {
      line = line.slice("require ".length).trim();
    }
    if (line === "(" || line === ")") {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length >= 2 && parts[0].includes(".")) {
      dependencies.push({
        kind: "go",
        name: parts[0],
        version: parts[1],
        path: file.path,
      });
    }
  }
  return dependencies;
}

function dependenciesFromGemfile(file: SourceFile): Dependency[] {
  return [...file.content.matchAll(/^\s*gem\s+['"]([^'"]+)['"](?:,\s*['"]([^'"]+)['"])?/gm)].map(
    (match) => ({
      kind: "ruby",
      name: match[1],
      version: match[2] || "",
      path: file.path,
    }),
  );
}

function collectModuleDependencies(files: SourceFile[]): ModuleDependency[] {
  const knownFiles = new Set(files.map((file) => file.path));
  const goModuleName = readGoModuleName(files);
  const dependencies: ModuleDependency[] = [];
  for (const file of files) {
    if (isTestFile(file.path)) {
      continue;
    }
    const suffix = path.extname(file.path).toLowerCase();
    if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(suffix)) {
      dependencies.push(...moduleDependenciesFromJavaScript(file, knownFiles));
    } else if (suffix === ".py") {
      dependencies.push(...moduleDependenciesFromPython(file, knownFiles));
    } else if (suffix === ".go") {
      dependencies.push(...moduleDependenciesFromGo(file, goModuleName));
    }
  }
  return uniqueBy(
    dependencies,
    (item) => `${item.source}\0${item.target}\0${item.specifier}\0${item.kind}`,
  ).slice(0, MAX_GRAPH_EDGES);
}

function moduleDependenciesFromJavaScript(
  file: SourceFile,
  knownFiles: Set<string>,
): ModuleDependency[] {
  const dependencies: ModuleDependency[] = [];
  for (const line of file.content.split(/\r?\n/)) {
    const stripped = line.trim();
    const importMatch = stripped.match(
      /^import(?:\s+type)?(?:\s+[^'"]+\s+from)?\s*["']([^"']+)["']/,
    );
    if (importMatch) {
      dependencies.push(moduleDependency(file.path, importMatch[1], "import", knownFiles));
    }
    const exportMatch = stripped.match(/^export\s+[^'"]+\s+from\s*["']([^"']+)["']/);
    if (exportMatch) {
      dependencies.push(moduleDependency(file.path, exportMatch[1], "export", knownFiles));
    }
    for (const requireMatch of stripped.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
      dependencies.push(moduleDependency(file.path, requireMatch[1], "require", knownFiles));
    }
    for (const dynamicImportMatch of stripped.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      dependencies.push(
        moduleDependency(file.path, dynamicImportMatch[1], "dynamic_import", knownFiles),
      );
    }
  }
  return dependencies;
}

function moduleDependency(
  source: string,
  specifier: string,
  kind: string,
  knownFiles: Set<string>,
): ModuleDependency {
  const resolved = resolveJavaScriptSpecifier(source, specifier, knownFiles);
  return {
    source,
    target: resolved ? resolved.target : packageTarget(specifier),
    specifier,
    kind,
    resolved: resolved ? resolved.resolved : false,
  };
}

function resolveJavaScriptSpecifier(
  source: string,
  specifier: string,
  knownFiles: Set<string>,
): { target: string; resolved: boolean } | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const basePath = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier)));
  const candidates = [
    basePath,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"].map((suffix) => `${basePath}${suffix}`),
    ...["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"].map((name) =>
      path.posix.join(basePath, name),
    ),
  ].map(normalizePath);
  const target = candidates.find((candidate) => knownFiles.has(candidate));
  return target ? { target, resolved: true } : { target: basePath, resolved: false };
}

function moduleDependenciesFromPython(file: SourceFile, knownFiles: Set<string>): ModuleDependency[] {
  const dependencies: ModuleDependency[] = [];
  for (const line of file.content.split(/\r?\n/)) {
    const stripped = line.trim();
    const importMatch = stripped.match(/^import\s+(.+)$/);
    if (importMatch) {
      for (const rawName of importMatch[1].split(",")) {
        const specifier = rawName.trim().split(/\s+as\s+/i, 1)[0];
        if (specifier) {
          dependencies.push(pythonDependency(file.path, specifier, "import", knownFiles));
        }
      }
      continue;
    }
    const fromMatch = stripped.match(/^from\s+([.\w]+)\s+import\s+/);
    if (fromMatch) {
      dependencies.push(pythonDependency(file.path, fromMatch[1], "from_import", knownFiles));
    }
  }
  return dependencies;
}

function pythonDependency(
  source: string,
  specifier: string,
  kind: string,
  knownFiles: Set<string>,
): ModuleDependency {
  const resolved = resolvePythonSpecifier(source, specifier, knownFiles);
  return {
    source,
    target: resolved || `py:${specifier.replace(/^\.+/, "") || "."}`,
    specifier,
    kind,
    resolved: resolved != null,
  };
}

function resolvePythonSpecifier(
  source: string,
  specifier: string,
  knownFiles: Set<string>,
): string | null {
  let modulePath: string;
  if (specifier.startsWith(".")) {
    const dots = specifier.match(/^\.+/)?.[0].length || 0;
    const remainder = specifier.slice(dots).replaceAll(".", "/");
    const sourceDirParts = path.posix.dirname(source).split("/").filter(Boolean);
    const baseParts = sourceDirParts.slice(0, Math.max(0, sourceDirParts.length - dots + 1));
    modulePath = [...baseParts, remainder].filter(Boolean).join("/");
  } else {
    modulePath = specifier.replaceAll(".", "/");
  }

  const candidates = [`${modulePath}.py`, path.posix.join(modulePath, "__init__.py")].map(normalizePath);
  return candidates.find((candidate) => knownFiles.has(candidate)) || null;
}

function moduleDependenciesFromGo(file: SourceFile, goModuleName: string | null): ModuleDependency[] {
  const dependencies: ModuleDependency[] = [];
  let inImportBlock = false;
  for (const line of file.content.split(/\r?\n/)) {
    const stripped = line.trim();
    if (stripped.startsWith("import (")) {
      inImportBlock = true;
      continue;
    }
    if (inImportBlock && stripped === ")") {
      inImportBlock = false;
      continue;
    }
    const singleMatch = stripped.match(/^import\s+"([^"]+)"/);
    if (singleMatch) {
      dependencies.push(goDependency(file.path, singleMatch[1], goModuleName));
      continue;
    }
    if (inImportBlock) {
      const blockMatch = stripped.match(/^(?:[\w.]+\s+|_\s+)?["']([^"']+)["']/);
      if (blockMatch) {
        dependencies.push(goDependency(file.path, blockMatch[1], goModuleName));
      }
    }
  }
  return dependencies;
}

function goDependency(source: string, specifier: string, goModuleName: string | null): ModuleDependency {
  return {
    source,
    target: goModuleName && specifier.startsWith(goModuleName) ? `go-local:${specifier}` : `go:${specifier}`,
    specifier,
    kind: "go_import",
    resolved: Boolean(goModuleName && specifier.startsWith(goModuleName)),
  };
}

function readGoModuleName(files: SourceFile[]): string | null {
  const goMod = files.find((file) => path.basename(file.path).toLowerCase() === "go.mod");
  if (!goMod) {
    return null;
  }
  const match = goMod.content.match(/^module\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function packageTarget(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return `pkg:${parts.slice(0, 2).join("/")}`;
  }
  return `pkg:${specifier.split("/", 1)[0]}`;
}

function collectIacStructure(files: SourceFile[]): IacStructure {
  const terraformFiles = files.filter((file) => path.extname(file.path).toLowerCase() === ".tf");
  const blocks = terraformFiles.flatMap(terraformBlocksFromFile);
  return {
    terraformFiles: terraformFiles.map((file) => file.path),
    providers: blocks.filter((block) => block.kind === "provider" || block.kind === "required_provider"),
    modules: blocks.filter((block) => block.kind === "module"),
    resources: blocks.filter((block) => block.kind === "resource"),
    dataSources: blocks.filter((block) => block.kind === "data"),
    variables: blocks.filter((block) => block.kind === "variable"),
    outputs: blocks.filter((block) => block.kind === "output"),
    locals: blocks.filter((block) => block.kind === "locals"),
  };
}

function terraformBlocksFromFile(file: SourceFile): TerraformBlock[] {
  const blocks: TerraformBlock[] = [];
  const lines = file.content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const stripped = line.trim();
    const match = stripped.match(
      /^(terraform|provider|module|resource|data|variable|output|locals)\s*(?:"([^"]+)")?\s*(?:"([^"]+)")?\s*\{/,
    );
    if (!match) {
      return;
    }

    const kind = match[1];
    const firstLabel = match[2] || "";
    const secondLabel = match[3] || "";
    const body = collectBlockBody(lines, index);
    if (kind === "terraform") {
      blocks.push(...requiredProvidersFromTerraformBody(file.path, index + 1, body));
      return;
    }

    blocks.push({
      kind,
      type: kind === "resource" || kind === "data" ? firstLabel : kind === "provider" ? firstLabel : "",
      name: kind === "resource" || kind === "data" ? secondLabel : firstLabel,
      source: attributeValue(body, "source"),
      version: attributeValue(body, "version"),
      path: file.path,
      line: index + 1,
    });
  });
  return uniqueBy(blocks, (block) => `${block.kind}\0${block.type}\0${block.name}\0${block.path}\0${block.line}`);
}

function requiredProvidersFromTerraformBody(
  filePath: string,
  terraformStartLine: number,
  body: string[],
): TerraformBlock[] {
  const requiredProvidersIndex = body.findIndex((line) => line.trim().startsWith("required_providers"));
  if (requiredProvidersIndex < 0) {
    return [];
  }
  const requiredBody = collectBlockBody(body, requiredProvidersIndex);
  const blocks: TerraformBlock[] = [];
  requiredBody.forEach((line, index) => {
    const match = line.trim().match(/^([A-Za-z0-9_-]+)\s*=\s*\{/);
    if (!match) {
      return;
    }
    const providerBody = collectBlockBody(requiredBody, index);
    blocks.push({
      kind: "required_provider",
      type: match[1],
      name: match[1],
      source: attributeValue(providerBody, "source"),
      version: attributeValue(providerBody, "version"),
      path: filePath,
      line: terraformStartLine + requiredProvidersIndex + index,
    });
  });
  return blocks;
}

function collectBlockBody(lines: string[], startIndex: number): string[] {
  const body: string[] = [];
  let depth = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    body.push(line);
    depth += countMatches(line, "{") - countMatches(line, "}");
    if (index > startIndex && depth <= 0) {
      break;
    }
  }
  return body;
}

function attributeValue(lines: string[], attribute: string): string {
  const pattern = new RegExp(`^\\s*${attribute}\\s*=\\s*["']([^"']+)["']`);
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function collectApiRoutes(files: SourceFile[]): Route[] {
  const routes: Route[] = [];
  for (const file of files) {
    if (isTestFile(file.path)) {
      continue;
    }
    routes.push(...routesFromContent(file));
    routes.push(...routesFromPath(file.path));
  }
  return uniqueBy(routes, (route) => `${route.method}\0${route.path}\0${route.source}`).slice(0, 80);
}

function routesFromContent(file: SourceFile): Route[] {
  const routes: Route[] = [];
  file.content.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const stripped = line.trim();
    routes.push(...matchPythonRoute(file.path, lineNumber, stripped));
    routes.push(...matchFlaskRoute(file.path, lineNumber, stripped));
    routes.push(...matchExpressRoute(file.path, lineNumber, stripped));
    routes.push(...matchDjangoRoute(file.path, lineNumber, stripped));
    routes.push(...matchSpringRoute(file.path, lineNumber, stripped));
  });
  return routes;
}

function matchPythonRoute(filePath: string, lineNumber: number, line: string): Route[] {
  const match = line.match(
    /^@(?:\w+\.)?(?:app|router|api)\.(get|post|put|delete|patch|options|head)\(\s*['"]([^'"]+)['"]/,
  );
  return match ? [routeDict(match[1].toUpperCase(), match[2], filePath, lineNumber)] : [];
}

function matchFlaskRoute(filePath: string, lineNumber: number, line: string): Route[] {
  const match = line.match(/^@(?:\w+\.)?(?:app|bp|blueprint)\.route\(\s*['"]([^'"]+)['"]/);
  if (!match) {
    return [];
  }
  const methods = line.match(/methods\s*=\s*\[([^\]]+)\]/);
  if (!methods) {
    return [routeDict("GET", match[1], filePath, lineNumber)];
  }
  return [...methods[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((methodMatch) =>
    routeDict(methodMatch[1].toUpperCase(), match[1], filePath, lineNumber),
  );
}

function matchExpressRoute(filePath: string, lineNumber: number, line: string): Route[] {
  const match = line.match(
    /\b(?:app|router)\.(get|post|put|delete|patch|options|head|all|use)\(\s*[`'"]([^`'"]+)[`'"]/,
  );
  return match ? [routeDict(match[1].toUpperCase(), match[2], filePath, lineNumber)] : [];
}

function matchDjangoRoute(filePath: string, lineNumber: number, line: string): Route[] {
  const match = line.match(/\b(?:path|re_path)\(\s*['"]([^'"]+)['"]/);
  return match ? [routeDict("DJANGO", match[1], filePath, lineNumber)] : [];
}

function matchSpringRoute(filePath: string, lineNumber: number, line: string): Route[] {
  const match = line.match(
    /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)(?:\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"])?/,
  );
  if (!match) {
    return [];
  }
  return [
    routeDict(
      match[1].replace("Mapping", "").toUpperCase() || "REQUEST",
      match[2] || "",
      filePath,
      lineNumber,
    ),
  ];
}

function routesFromPath(filePath: string): Route[] {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith("pages/api/")) {
    return [
      routeDict(
        "NEXT_API",
        `/${removeExtension(normalized.slice("pages/api/".length))}`,
        filePath,
        0,
      ),
    ];
  }
  if (normalized.includes("/app/api/") && normalized.endsWith("/route.ts")) {
    const route = normalized.split("/app/api/", 2)[1].slice(0, -"/route.ts".length);
    return [routeDict("NEXT_API", `/${route}`, filePath, 0)];
  }
  return [];
}

function collectDatabaseDefinitions(files: SourceFile[]): DbDefinition[] {
  const definitions: DbDefinition[] = [];
  for (const file of files) {
    if (!isTestFile(file.path)) {
      definitions.push(...databaseDefinitionsFromContent(file));
    }
  }
  return uniqueBy(
    definitions,
    (definition) => `${definition.kind}\0${definition.name}\0${definition.path}\0${definition.line}`,
  ).slice(0, 80);
}

function databaseDefinitionsFromContent(file: SourceFile): DbDefinition[] {
  const definitions: DbDefinition[] = [];
  const lines = file.content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const stripped = line.trim();

    const createTableMatch = stripped.match(
      /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.]+)/i,
    );
    if (createTableMatch) {
      definitions.push({
        kind: "CREATE TABLE",
        name: cleanDbIdentifier(createTableMatch[1]),
        path: file.path,
        line: String(lineNumber),
      });
    }

    const alterTableMatch = stripped.match(
      /\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?([`"[\]\w.]+)/i,
    );
    if (alterTableMatch) {
      definitions.push({
        kind: "ALTER TABLE",
        name: cleanDbIdentifier(alterTableMatch[1]),
        path: file.path,
        line: String(lineNumber),
      });
    }

    const createIndexMatch = stripped.match(
      /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.]+)/i,
    );
    if (createIndexMatch) {
      definitions.push({
        kind: stripped.toUpperCase().includes("CREATE UNIQUE INDEX")
          ? "CREATE UNIQUE INDEX"
          : "CREATE INDEX",
        name: cleanDbIdentifier(createIndexMatch[1]),
        path: file.path,
        line: String(lineNumber),
      });
    }

    const djangoMatch = stripped.match(/^class\s+(\w+)\((?:models\.)?Model\):/);
    if (djangoMatch) {
      definitions.push({
        kind: "Django model",
        name: djangoMatch[1],
        path: file.path,
        line: String(lineNumber),
      });
    }

    const prismaMatch = stripped.match(/^model\s+(\w+)\s+\{/);
    if (prismaMatch) {
      definitions.push({
        kind: "Prisma model",
        name: prismaMatch[1],
        path: file.path,
        line: String(lineNumber),
      });
    }

    const typeOrmMatch = stripped.match(/^@(?:\w+\.)?Entity(?:\((.*)\))?/);
    if (typeOrmMatch) {
      const className = findNextClassName(lines, index);
      const explicitName = typeOrmMatch[1]
        ? typeOrmMatch[1].match(/["'`]([^"'`]+)["'`]/)?.[1]
        : null;
      definitions.push({
        kind: "TypeORM entity",
        name: explicitName || className || "(decorated entity)",
        path: file.path,
        line: String(lineNumber),
      });
    }

    const sqlalchemyTablenameMatch = stripped.match(
      /^__tablename__\s*=\s*["'`]([^"'`]+)["'`]/,
    );
    if (sqlalchemyTablenameMatch) {
      definitions.push({
        kind: "SQLAlchemy table",
        name: sqlalchemyTablenameMatch[1],
        path: file.path,
        line: String(lineNumber),
      });
    }

    const sequelizeDefineMatch = stripped.match(
      /\b(?:sequelize|connection)\.define\(\s*["'`]([^"'`]+)["'`]/,
    );
    if (sequelizeDefineMatch) {
      definitions.push({
        kind: "Sequelize model",
        name: sequelizeDefineMatch[1],
        path: file.path,
        line: String(lineNumber),
      });
    }

    const railsCreateTableMatch = stripped.match(/\bcreate_table\s+["']?:([\w.]+)/);
    if (railsCreateTableMatch) {
      definitions.push({
        kind: "Rails create_table",
        name: railsCreateTableMatch[1],
        path: file.path,
        line: String(lineNumber),
      });
    }

    const railsAddIndexMatch = stripped.match(/\badd_index\s+["']?:([\w.]+)/);
    if (railsAddIndexMatch) {
      definitions.push({
        kind: "Rails add_index",
        name: railsAddIndexMatch[1],
        path: file.path,
        line: String(lineNumber),
      });
    }
  });
  return definitions;
}

function cleanDbIdentifier(value: string): string {
  return value.replace(/^[`"[]+/, "").replace(/[`"\]]+$/, "").replace(/[,(;]+$/, "");
}

function findNextClassName(lines: string[], decoratorIndex: number): string | null {
  for (let index = decoratorIndex + 1; index < Math.min(lines.length, decoratorIndex + 6); index += 1) {
    const match = lines[index].trim().match(/^(?:export\s+)?class\s+(\w+)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function routeDict(method: string, routePath: string, filePath: string, lineNumber: number): Route {
  return {
    method,
    path: routePath,
    source: sourceReference(filePath, lineNumber),
  };
}

function sourceReference(filePath: string, lineNumber: number): string {
  return lineNumber <= 0 ? filePath : `${filePath}:${lineNumber}`;
}

function isConfigFile(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  const suffix = path.extname(filePath).toLowerCase();
  return (
    [
      ".env",
      ".env.example",
      "dockerfile",
      "package.json",
      "requirements.txt",
      "pyproject.toml",
      "go.mod",
      "gemfile",
      "composer.json",
      "pom.xml",
      "build.gradle",
    ].includes(name) || [".yaml", ".yml", ".toml", ".properties", ".conf", ".tf"].includes(suffix)
  );
}

function isDependencyManifest(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return [
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "go.mod",
    "gemfile",
    "composer.json",
    "pom.xml",
    "build.gradle",
  ].includes(name);
}

function isTestFile(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const parts = normalized.split("/");
  const name = parts.at(-1) || "";
  return (
    parts.slice(0, -1).some((part) => ["test", "tests", "spec", "specs"].includes(part)) ||
    name.startsWith("test_") ||
    name.endsWith("_test.py") ||
    name.includes(".test.") ||
    name.includes(".spec.")
  );
}

function formatSummary(codebaseMap: CodebaseMap): string[] {
  return [
    `- Files: ${codebaseMap.summary.fileCount}`,
    `- Directories: ${codebaseMap.summary.directoryCount}`,
    `- Dependencies: ${codebaseMap.summary.dependencyCount}`,
    `- Module dependency edges: ${codebaseMap.summary.moduleDependencyCount}`,
    `- Terraform files: ${codebaseMap.summary.terraformFileCount}`,
  ];
}

function formatFileMetadataTable(files: FileMetadata[], maxRows: number): string[] {
  if (files.length === 0) {
    return ["No files loaded."];
  }
  return [
    "| Path | Language | Lines | Characters | Roles |",
    "| --- | --- | ---: | ---: | --- |",
    ...files
      .slice(0, maxRows)
      .map(
        (file) =>
          `| ${md(file.path)} | ${md(file.language)} | ${file.lines} | ${file.characters} | ${md(file.roles.join(", "))} |`,
      ),
    ...omittedRow(files.length, maxRows, 5),
  ];
}

function formatDependencyTable(dependencies: Dependency[], maxRows: number): string[] {
  if (dependencies.length === 0) {
    return ["依存関係候補は検出されませんでした。"];
  }
  return [
    "| 種別 | 名前 | バージョン/記述 | 根拠 |",
    "| --- | --- | --- | --- |",
    ...dependencies
      .slice(0, maxRows)
      .map(
        (item) => `| ${md(item.kind)} | ${md(item.name)} | ${md(item.version)} | ${md(item.path)} |`,
      ),
    ...omittedRow(dependencies.length, maxRows, 4),
  ];
}

function formatModuleDependencyTable(dependencies: ModuleDependency[], maxRows: number): string[] {
  if (dependencies.length === 0) {
    return ["モジュール依存候補は検出されませんでした。"];
  }
  return [
    "| From | To | Specifier | Kind | Resolved |",
    "| --- | --- | --- | --- | --- |",
    ...dependencies
      .slice(0, maxRows)
      .map(
        (item) =>
          `| ${md(item.source)} | ${md(item.target)} | ${md(item.specifier)} | ${md(item.kind)} | ${item.resolved ? "yes" : "no"} |`,
      ),
    ...omittedRow(dependencies.length, maxRows, 5),
  ];
}

function formatIacSummary(iac: IacStructure): string[] {
  if (iac.terraformFiles.length === 0) {
    return ["Terraform/IaC候補は検出されませんでした。"];
  }
  return [
    `- Terraform files: ${iac.terraformFiles.length}`,
    `- Providers: ${iac.providers.length}`,
    `- Modules: ${iac.modules.length}`,
    `- Resources: ${iac.resources.length}`,
    `- Data sources: ${iac.dataSources.length}`,
    `- Variables: ${iac.variables.length}`,
    `- Outputs: ${iac.outputs.length}`,
  ];
}

function formatTerraformBlockTable(blocks: TerraformBlock[]): string[] {
  if (blocks.length === 0) {
    return ["None detected."];
  }
  return [
    "| Kind | Type | Name | Source | Version | Location |",
    "| --- | --- | --- | --- | --- | --- |",
    ...blocks.map(
      (block) =>
        `| ${md(block.kind)} | ${md(block.type)} | ${md(block.name)} | ${md(block.source)} | ${md(block.version)} | ${md(`${block.path}:${block.line}`)} |`,
    ),
  ];
}

function formatRouteTable(routes: Route[], maxRows: number): string[] {
  if (routes.length === 0) {
    return ["ルーティング/API候補は検出されませんでした。"];
  }
  return [
    "| メソッド | パス | 根拠 |",
    "| --- | --- | --- |",
    ...routes
      .slice(0, maxRows)
      .map((item) => `| ${md(item.method)} | ${md(item.path)} | ${md(item.source)} |`),
    ...omittedRow(routes.length, maxRows, 3),
  ];
}

function formatDatabaseTable(definitions: DbDefinition[], maxRows: number): string[] {
  if (definitions.length === 0) {
    return ["DB定義/データモデル候補は検出されませんでした。"];
  }
  return [
    "| 種別 | 名前 | 根拠 |",
    "| --- | --- | --- |",
    ...definitions
      .slice(0, maxRows)
      .map((item) => `| ${md(item.kind)} | ${md(item.name)} | ${md(`${item.path}:${item.line}`)} |`),
    ...omittedRow(definitions.length, maxRows, 3),
  ];
}

function formatBullets(values: string[], empty: string): string[] {
  return values.length === 0 ? [empty] : values.map((value) => `- ${value}`);
}

function omittedRow(length: number, maxRows: number, columns: number): string[] {
  if (length <= maxRows) {
    return [];
  }
  return [`| ${md(`${length - maxRows} rows omitted`)} ${"| ".repeat(columns - 1)}|`];
}

function limitLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) {
    return lines;
  }
  return [...lines.slice(0, maxLines), `... ${lines.length - maxLines} lines omitted`];
}

function dependencyName(requirement: string): string {
  return requirement.split(/\s*(?:==|>=|<=|~=|!=|>|<|\[)/, 1)[0].trim();
}

function countMatches(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const results: T[] = [];
  for (const item of items) {
    const itemKey = key(item);
    if (!seen.has(itemKey)) {
      seen.add(itemKey);
      results.push(item);
    }
  }
  return results;
}

function md(value: string): string {
  return String(value || "").replaceAll("\n", " ").replaceAll("|", "\\|");
}

function escapeMermaidLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function removeExtension(value: string): string {
  const index = value.lastIndexOf(".");
  return index < 0 ? value : value.slice(0, index);
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/").replaceAll("\\", "/");
}

/**
 * サービス境界を検出する。
 */
export function detectServiceBoundaries(
  filePaths: string[],
): Record<string, { type: string; entrypoint: string | null; files: string[] }> {
  const services: Record<string, { type: string; entrypoint: string | null; files: string[] }> = {};

  const FRONTEND_SIGNALS = ["src/routes/", "src/pages/", "src/App.", "public/index.html"];
  const BACKEND_SIGNALS = ["/lambda.", "/server.", "/handler."];

  function entrypointScore(filePath: string): number {
    if (!isAnalysisTarget(filePath)) return -1;

    const normalized = filePath.replaceAll("\\", "/").toLowerCase();
    const parts = normalized.split("/");
    const basename = parts.at(-1) ?? "";

    const NAME_SCORES: Record<string, number> = {
      "lambda.ts":  100, "lambda.js":  100,
      "server.ts":   90, "server.js":   90,
      "main.ts":     80, "main.tsx":    80, "main.js":  80, "main.jsx":  80,
      "index.ts":    65, "index.tsx":   65, "index.js": 65, "index.jsx": 65,
      "app.ts":      55, "app.tsx":     55, "app.js":   55, "app.jsx":   55,
    };

    const baseScore = NAME_SCORES[basename] ?? 0;
    if (baseScore === 0) return 0;

    const srcIdx = parts.indexOf("src");
    const isDirectlyUnderSrc = srcIdx >= 0 && parts.length - srcIdx === 2;
    const srcBonus = isDirectlyUnderSrc ? 20 : 0;
    const depthBonus = Math.max(0, 10 - parts.length);

    return baseScore + srcBonus + depthBonus;
  }

  for (const filePath of filePaths) {
    const normalized = filePath.replaceAll("\\", "/");

    const svcMatch = normalized.match(/(?:^|\/)services\/([^/]+)\//);
    if (svcMatch) {
      const svcName = svcMatch[1];
      if (!services[svcName]) {
        services[svcName] = { type: "unknown", entrypoint: null, files: [] };
      }
      services[svcName].files.push(filePath);

      if (FRONTEND_SIGNALS.some((s) => normalized.includes(s))) {
        services[svcName].type = "frontend_spa";
      } else if (BACKEND_SIGNALS.some((s) => normalized.includes(s))) {
        services[svcName].type = "backend_api";
      } else if (normalized.includes("/infra/") || normalized.includes("/cdk/")) {
        services[svcName].type = "infrastructure";
      }
      continue;
    }

    const infraMatch = normalized.match(/(?:^|\/)(?:infrastructures|infra)\/([^/]+)\//);
    if (infraMatch) {
      const infraName = `infra/${infraMatch[1]}`;
      if (!services[infraName]) {
        services[infraName] = { type: "infrastructure", entrypoint: null, files: [] };
      }
      services[infraName].files.push(filePath);
    }
  }

  for (const info of Object.values(services)) {
    let bestScore = -1;
    let bestPath: string | null = null;
    for (const filePath of info.files) {
      const score = entrypointScore(filePath);
      if (score > bestScore) {
        bestScore = score;
        bestPath = filePath;
      }
    }
    info.entrypoint = bestScore > 0 ? bestPath : null;
  }

  return services;
}

/**
 * OpenAPI / api-spec ファイルを検索してファイル名→内容のマップで返す。
 */
export function extractApiSpecFiles(
  files: SourceFile[],
): Record<string, string> {
  const result: Record<string, string> = {};

  const API_SPEC_NAMES = [
    "api-spec.yaml", "api-spec.yml", "api-spec.json",
    "openapi.yaml", "openapi.yml", "openapi.json",
    "swagger.yaml", "swagger.yml", "swagger.json",
  ];

  for (const file of files) {
    const basename = file.path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
    if (API_SPEC_NAMES.includes(basename)) {
      const key = result[basename] !== undefined
        ? `api-spec-${file.path.replaceAll("/", "-").replaceAll("\\", "-")}`
        : basename;
      result[key] = file.content;
    }
  }

  return result;
}

/**
 * サービス別にエクスポートシンボルを分割してマップで返却する
 */
export function buildExportedSymbolsByService(
  files: SourceFile[],
  services: Record<string, { type: string; entrypoint: string | null; files: string[] }>,
): Record<string, string> {
  interface Symbol {
    kind: string;
    name: string;
    file: string;
  }

  const result: Record<string, string> = {};
  const fileToService = new Map<string, string>();
  for (const [svcName, info] of Object.entries(services)) {
    for (const f of info.files) fileToService.set(f, svcName);
  }

  const EXPORT_PATTERNS: Array<{ re: RegExp; kind: string }> = [
    { re: /^export\s+(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/m, kind: "function" },
    { re: /^export\s+class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/m, kind: "class" },
    { re: /^export\s+(?:abstract\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/m, kind: "class" },
    { re: /^export\s+interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/m, kind: "interface" },
    { re: /^export\s+type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/m, kind: "type" },
    { re: /^export\s+(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/m, kind: "const" },
    { re: /^export\s+enum\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/m, kind: "enum" },
    { re: /^export\s+default\s+(?:function|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/m, kind: "default" },
  ];

  const symbolsByService: Record<string, Symbol[]> = {};
  const ungrouped: Symbol[] = [];

  for (const file of files) {
    if (!isAnalysisTarget(file.path)) continue;
    const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
    if (!["ts", "tsx", "js", "jsx", "mjs"].includes(ext)) continue;

    const foundSymbols: Symbol[] = [];
    const lines = file.content.split(/\r?\n/);

    for (const line of lines) {
      const stripped = line.trim();
      for (const { re, kind } of EXPORT_PATTERNS) {
        const m = stripped.match(re);
        if (m && m[1]) {
          if (!foundSymbols.some((s) => s.name === m[1] && s.kind === kind)) {
            foundSymbols.push({ kind, name: m[1], file: file.path });
          }
          break;
        }
      }
    }

    if (foundSymbols.length === 0) continue;

    const svcName = fileToService.get(file.path);
    if (svcName) {
      if (!symbolsByService[svcName]) symbolsByService[svcName] = [];
      symbolsByService[svcName].push(...foundSymbols);
    } else {
      ungrouped.push(...foundSymbols);
    }
  }

  for (const [svcName, symbols] of Object.entries(symbolsByService)) {
    const info = services[svcName];
    const md = [
      `# エクスポートシンボル一覧（${svcName}）`,
      "",
      `> このファイルは analysis-worker の静的解析フェーズで自動生成されたデバッグ用中間成果物です。`,
      `> サービス: \`${svcName}\` (タイプ: \`${info?.type ?? "unknown"}\`) のシンボルを示します。`,
      "",
      "---",
      "",
      "| 種別 | シンボル名 | ファイル |",
      "| --- | --- | --- |",
      ...symbols.map((s) => `| ${s.kind} | \`${s.name}\` | ${s.file} |`),
      "",
    ].join("\n");

    result[svcName] = md;
  }

  if (ungrouped.length > 0) {
    const md = [
      `# エクスポートシンボル一覧（未分類）`,
      "",
      `> このファイルは analysis-worker の静的解析フェーズで自動生成されたデバッグ用中間成果物です。`,
      `> どのサービス境界にも属さなかった共通ファイル等のシンボルを示します。`,
      "",
      "---",
      "",
      "| 種別 | シンボル名 | ファイル |",
      "| --- | --- | --- |",
      ...ungrouped.map((s) => `| ${s.kind} | \`${s.name}\` | ${s.file} |`),
      "",
    ].join("\n");

    result["ungrouped"] = md;
  }

  return result;
}

/**
 * 解析対象外ファイルかどうかを判定する。
 */
function isAnalysisTarget(filePath: string): boolean {
  if (isTestFile(filePath)) return false;
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const excludedDirs = [
    "/.storybook/",
    "/playwright/",
    "/profile/",
    "/debug/",
    "/generated/",
    "/node_modules/",
    "/dist/",
    "/.github/",
    "/.vscode/",
  ];
  if (excludedDirs.some((d) => normalized.includes(d))) return false;
  const basename = normalized.split("/").at(-1) ?? "";
  if ([
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "go.sum",
    ".gitignore",
    ".prettierrc",
    ".eslintrc.js",
    "jest.config.js",
    "vitest.config.ts",
    "tsconfig.json",
  ].includes(basename)) return false;
  return true;
}

const DATABASE_FILE_NAMES = new Set([
  "schema.prisma",
  "database.sql",
  "schema.sql",
  "structure.sql",
  "ddl.sql",
  "models.py",
  "entities.ts",
  "entity.ts",
  "models.ts",
  "database.ts",
  "datasource.ts",
  "data-source.ts",
  "alembic.ini",
]);

const DATABASE_FILE_EXTENSIONS = new Set([".sql", ".prisma"]);

const DATABASE_PATH_KEYWORDS = [
  "migration",
  "migrations",
  "migrate",
  "schema",
  "ddl",
  "database",
  "db",
  "model",
  "models",
  "entity",
  "entities",
  "prisma",
  "typeorm",
  "sqlalchemy",
  "sequelize",
  "alembic",
];

function isDatabaseDefinitionPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";
  const extension = path.extname(normalized);
  return (
    DATABASE_FILE_NAMES.has(basename) ||
    DATABASE_FILE_EXTENSIONS.has(extension) ||
    segments.some((segment) => DATABASE_PATH_KEYWORDS.includes(segment))
  );
}

function databasePathScore(filePath: string): number {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";
  const extension = path.extname(normalized);
  let score = 0;
  if (DATABASE_FILE_NAMES.has(basename)) score += 35;
  if (DATABASE_FILE_EXTENSIONS.has(extension)) score += 30;
  for (const keyword of DATABASE_PATH_KEYWORDS) {
    if (segments.some((segment) => segment === keyword || segment.includes(keyword))) {
      score += 8;
    }
  }
  return score;
}

function hasDatabaseDefinitionSignal(file: SourceFile): boolean {
  return databaseDefinitionsFromContent(file).length > 0;
}

/**
 * CodebaseMap と生ファイルから DB・データモデル解析向けのファイルを特定する。
 *
 * 返却されるファイルは:
 * 1. codebase-map.json の databaseDefinitions に出ているファイル
 * 2. SQL/Prisma/ORM/migration らしいパスまたは内容を持つファイル
 * 3. テストや生成物など解析対象外のファイルを除外したもの
 */
export function identifyDatabaseDefinitionFiles(
  codebaseMap: CodebaseMap,
  rawFiles: SourceFile[],
  maxFiles: number = 40,
): SourceFile[] {
  const definitionPaths = new Set(
    codebaseMap.databaseDefinitions.map((definition) => definition.path),
  );
  const candidates = rawFiles.filter((file) => {
    if (!isAnalysisTarget(file.path)) return false;
    return (
      definitionPaths.has(file.path) ||
      isDatabaseDefinitionPath(file.path) ||
      hasDatabaseDefinitionSignal(file)
    );
  });

  const scored = candidates.map((file) => {
    let score = 0;
    if (definitionPaths.has(file.path)) score += 100;
    if (hasDatabaseDefinitionSignal(file)) score += 60;
    score += databasePathScore(file.path);
    score += Math.min(file.content.split(/\r?\n/).length, 400) / 100;
    return { file, score };
  });

  scored.sort((left, right) => {
    const scoreDiff = right.score - left.score;
    return scoreDiff !== 0 ? scoreDiff : left.file.path.localeCompare(right.file.path);
  });

  return scored.slice(0, maxFiles).map((item) => item.file);
}

/**
 * ビジネスロジック関連キーワード。パス内にこれらが含まれるファイルを優先する。
 */
const BUSINESS_LOGIC_PATH_KEYWORDS = [
  "service",
  "domain",
  "model",
  "usecase",
  "use-case",
  "use_case",
  "entity",
  "handler",
  "controller",
  "resolver",
  "command",
  "query",
  "saga",
  "workflow",
  "state",
  "rule",
  "policy",
  "validator",
  "interactor",
  "aggregate",
  "repository",
  "logic",
  "action",
  "middleware",
  "guard",
  "pipe",
  "strategy",
];

/**
 * ビジネスロジック解析で除外するパスパターン。
 */
const BUSINESS_LOGIC_EXCLUDE_PATTERNS = [
  "/node_modules/",
  "/dist/",
  "/build/",
  "/.next/",
  "/coverage/",
  "/test/",
  "/tests/",
  "/__tests__/",
  "/spec/",
  "/e2e/",
  "/fixtures/",
  "/mocks/",
  "/.storybook/",
  "/storybook/",
  "/stories/",
  "/playwright/",
  "/cypress/",
  "/styles/",
  "/assets/",
  "/images/",
  "/fonts/",
  "/public/",
  "/static/",
  "/infra/",
  "/terraform/",
  "/cdk/",
  "/cloudformation/",
  "/.github/",
  "/.vscode/",
  "/generated/",
  "/__generated__/",
];

/**
 * UI層として除外するパスパターン。ビジネスロジック解析では優先度を下げる。
 */
const UI_LAYER_PATTERNS = [
  "/components/",
  "/pages/",
  "/views/",
  "/layouts/",
  "/screens/",
  "/templates/",
  "/partials/",
  "/widgets/",
];

/**
 * CodebaseMap と生ファイルからビジネスロジック関連のファイルを特定し、
 * 優先順位付けして返す。
 *
 * 返却されるファイルは:
 * 1. ビジネスロジックキーワードを含むパスのファイル（高優先）
 * 2. ソースコード拡張子を持ち、除外パターンに該当しないファイル（低優先）
 *
 * UI層ファイルは優先度を下げるが完全に除外はしない。
 */
export function identifyBusinessLogicFiles(
  codebaseMap: CodebaseMap,
  rawFiles: SourceFile[],
  maxFiles: number = 60,
): SourceFile[] {
  // 除外対象フィルタ
  const isExcluded = (filePath: string): boolean => {
    const normalized = filePath.replaceAll("\\", "/").toLowerCase();
    return BUSINESS_LOGIC_EXCLUDE_PATTERNS.some((p) => normalized.includes(p));
  };

  // UI層判定
  const isUiLayer = (filePath: string): boolean => {
    const normalized = filePath.replaceAll("\\", "/").toLowerCase();
    return UI_LAYER_PATTERNS.some((p) => normalized.includes(p));
  };

  // ビジネスロジックキーワードマッチ
  const businessLogicScore = (filePath: string): number => {
    const normalized = filePath.replaceAll("\\", "/").toLowerCase();
    const segments = normalized.split("/");
    let score = 0;
    for (const keyword of BUSINESS_LOGIC_PATH_KEYWORDS) {
      if (segments.some((seg) => seg.includes(keyword))) {
        score += 10;
      }
    }
    // ファイル名自体にキーワードが含まれる場合はボーナス
    const basename = segments.at(-1) ?? "";
    for (const keyword of BUSINESS_LOGIC_PATH_KEYWORDS) {
      if (basename.includes(keyword)) {
        score += 5;
      }
    }
    return score;
  };

  // ソースコードファイルかどうか
  const isSourceCode = (filePath: string): boolean => {
    const ext = path.extname(filePath).toLowerCase();
    return SOURCE_EXTENSIONS.has(ext);
  };

  // フィルタリング
  const candidates = rawFiles.filter((file) => {
    if (!isSourceCode(file.path)) return false;
    if (isExcluded(file.path)) return false;
    if (isTestFile(file.path)) return false;
    return true;
  });

  // スコアリングとソート
  const scored = candidates.map((file) => {
    let score = businessLogicScore(file.path);
    if (isUiLayer(file.path)) {
      score -= 20; // UI層は優先度を下げる
    }
    // ファイルサイズ（行数）が多いほうが重要なロジックが含まれる可能性
    const lines = file.content.split("\n").length;
    if (lines > 50) score += 2;
    if (lines > 200) score += 3;
    return { file, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxFiles).map((s) => s.file);
}

/**
 * exported-symbols-*.md の内容を集約して1つのサマリー文字列を生成する。
 */
export function collectExportedSymbolsSummary(
  artifacts: Record<string, string>,
): string {
  const symbolFiles = Object.entries(artifacts)
    .filter(([name]) => name.startsWith("exported-symbols-"))
    .sort(([a], [b]) => a.localeCompare(b));

  if (symbolFiles.length === 0) {
    return "エクスポートシンボル情報は利用できません。";
  }

  return symbolFiles
    .map(([name, content]) => `### ${name}\n\n${content}`)
    .join("\n\n---\n\n");
}

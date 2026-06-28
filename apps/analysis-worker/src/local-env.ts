import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadLocalEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const packageRoot = findNearestPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = uniquePaths([
    packageRoot ? path.join(packageRoot, ".env") : null,
    path.join(process.cwd(), ".env"),
  ]);

  const loaded: string[] = [];
  for (const candidate of candidates) {
    if (loadEnvFile(candidate, env)) {
      loaded.push(candidate);
    }
  }
  return loaded;
}

export function loadEnvFile(filePath: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) {
      continue;
    }
    const [key, value] = entry;
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
  return true;
}

function parseEnvLine(line: string): [string, string] | null {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  if (trimmed.startsWith("export ")) {
    trimmed = trimmed.slice("export ".length).trimStart();
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex < 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  const rawValue = trimmed.slice(separatorIndex + 1).trim();
  return [key, normalizeEnvValue(rawValue)];
}

function normalizeEnvValue(rawValue: string): string {
  if (rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"')) {
    const inner = rawValue.slice(1, -1);
    return inner.replace(/\\([nrt"\\])/g, (_match, escaped: string) => {
      if (escaped === "n") {
        return "\n";
      }
      if (escaped === "r") {
        return "\r";
      }
      if (escaped === "t") {
        return "\t";
      }
      return escaped;
    });
  }
  if (rawValue.length >= 2 && rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1);
  }
  return rawValue.replace(/\s+#.*$/, "").trim();
}

function findNearestPackageRoot(startDir: string): string | null {
  let current = startDir;
  for (;;) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function uniquePaths(paths: Array<string | null>): string[] {
  return [...new Set(paths.filter((item): item is string => item != null))];
}

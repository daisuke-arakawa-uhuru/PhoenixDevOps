import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const distRoot = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function serveUi(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).set("Allow", "GET, HEAD").send("Method Not Allowed");
    return;
  }

  const requestUrl = new URL(req.url || "/", "http://localhost");
  if (requestUrl.pathname === "/config.js") {
    sendRuntimeConfig(res, req.method === "HEAD");
    return;
  }

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  } catch {
    res.status(400).send("Bad Request");
    return;
  }

  const filePath = safeResolve(requestedPath);
  if (!filePath) {
    res.status(403).send("Forbidden");
    return;
  }

  try {
    await sendFile(res, filePath, req.method === "HEAD");
  } catch (error) {
    if (isNotFound(error)) {
      await sendFile(res, resolve(distRoot, "index.html"), req.method === "HEAD");
      return;
    }
    throw error;
  }
}

function sendRuntimeConfig(res, headOnly) {
  const config = {
    API_URL: process.env.API_URL || "http://localhost:8080",
    USE_MOCK: readBoolean(process.env.USE_MOCK),
  };
  const body = `window.__PHOENIX_CONFIG__ = ${JSON.stringify(config)};\n`;
  res.set("Content-Type", "text/javascript; charset=utf-8");
  res.set("Cache-Control", "no-store");
  if (headOnly) {
    res.status(200).end();
    return;
  }
  res.status(200).send(body);
}

async function sendFile(res, filePath, headOnly) {
  const content = await readFile(filePath);
  const extension = extname(filePath).toLowerCase();
  const relativePath = filePath.slice(distRoot.length).replaceAll("\\", "/");

  res.set("Content-Type", contentTypes[extension] || "application/octet-stream");
  res.set(
    "Cache-Control",
    relativePath.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  );
  if (headOnly) {
    res.status(200).end();
    return;
  }
  res.status(200).send(content);
}

function safeResolve(requestedPath) {
  const filePath = resolve(distRoot, `.${requestedPath}`);
  return filePath === distRoot || filePath.startsWith(`${distRoot}${sep}`) ? filePath : null;
}

function readBoolean(value) {
  return ["1", "true", "yes"].includes(String(value || "").toLowerCase());
}

function isNotFound(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

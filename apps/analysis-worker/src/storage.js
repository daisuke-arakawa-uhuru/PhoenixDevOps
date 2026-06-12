"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readZipEntries } = require("./zip");

const SKIPPED_DIRS = new Set([
  ".git",
  ".venv",
  "__pycache__",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
]);

const TEXT_EXTENSIONS = new Set([
  "",
  ".c",
  ".conf",
  ".css",
  ".csv",
  ".env",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".lock",
  ".md",
  ".php",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

class ReferenceOnlyInputLoader {
  async load(payload) {
    return {
      sourceArchiveUri: payload.sourceArchive.uri,
      documentUris: payload.documents.map((document) => document.uri),
      sourceFiles: [],
      documentFiles: [],
    };
  }
}

class GcsInputLoader {
  constructor({ storageClient = null, maxFiles = 80, maxCharsPerFile = 12000 } = {}) {
    if (storageClient == null) {
      const { Storage } = require("@google-cloud/storage");
      storageClient = new Storage();
    }
    this.storageClient = storageClient;
    this.maxFiles = maxFiles;
    this.maxCharsPerFile = maxCharsPerFile;
  }

  async load(payload) {
    const sourceData = await downloadStorageObject(this.storageClient, payload.sourceArchive);
    const sourceFiles = limitFiles(
      readSourceObject(payload.sourceArchive.objectName, sourceData, this.maxCharsPerFile),
      this.maxFiles,
    );

    const documentFiles = [];
    for (const document of payload.documents) {
      const documentData = await downloadStorageObject(this.storageClient, document);
      documentFiles.push(
        ...limitFiles(
          await readDocumentObject(document.objectName, documentData, this.maxCharsPerFile),
          this.maxFiles - documentFiles.length,
        ),
      );
      if (documentFiles.length >= this.maxFiles) {
        break;
      }
    }

    return {
      sourceArchiveUri: payload.sourceArchive.uri,
      documentUris: payload.documents.map((document) => document.uri),
      sourceFiles,
      documentFiles,
    };
  }
}

class LocalFileInputLoader {
  constructor(sourcePath, documentPaths, { maxFiles = 80, maxCharsPerFile = 12000 } = {}) {
    this.sourcePath = sourcePath;
    this.documentPaths = [...documentPaths];
    this.maxFiles = maxFiles;
    this.maxCharsPerFile = maxCharsPerFile;
  }

  async load() {
    return {
      sourceArchiveUri: this.sourcePath,
      documentUris: this.documentPaths,
      sourceFiles: limitFiles(readSourceFiles(this.sourcePath, this.maxCharsPerFile), this.maxFiles),
      documentFiles: limitFiles(await readDocumentFiles(this.documentPaths, this.maxCharsPerFile), this.maxFiles),
    };
  }
}

class GcsArtifactWriter {
  constructor({ storageClient = null, resultsBucket = null, resultsPrefixTemplate = "results/{job_id}" } = {}) {
    if (storageClient == null) {
      const { Storage } = require("@google-cloud/storage");
      storageClient = new Storage();
    }
    this.storageClient = storageClient;
    this.resultsBucket = resultsBucket;
    this.resultsPrefixTemplate = resultsPrefixTemplate;
  }

  async write(payload, markdownFiles) {
    const bucketName = this.resultsBucket || payload.sourceArchive.bucket;
    const bucket = this.storageClient.bucket(bucketName);
    const prefix = this.resultPrefix(payload);
    const artifactPaths = {};

    for (const [fileName, content] of Object.entries(markdownFiles)) {
      const objectName = `${prefix}/${fileName}`;
      await bucket.file(objectName).save(content, {
        contentType: "text/markdown; charset=utf-8",
      });
      artifactPaths[fileName] = `gs://${bucketName}/${objectName}`;
    }

    return artifactPaths;
  }

  resultPrefix(payload) {
    return (payload.resultsPrefix || this.resultsPrefixTemplate.replaceAll("{job_id}", payload.jobId)).replace(
      /^\/+|\/+$/g,
      "",
    );
  }
}

class InMemoryArtifactWriter {
  constructor() {
    this.filesByJobId = {};
  }

  async write(payload, markdownFiles) {
    this.filesByJobId[payload.jobId] = { ...markdownFiles };
    const prefix = (payload.resultsPrefix || `results/${payload.jobId}`).replace(/^\/+|\/+$/g, "");
    return Object.fromEntries(
      Object.keys(markdownFiles).map((fileName) => [fileName, `memory://${prefix}/${fileName}`]),
    );
  }
}

class LocalArtifactWriter {
  constructor(outputDir) {
    this.outputDir = outputDir;
  }

  async write(payload, markdownFiles) {
    const jobOutputDir = path.join(this.outputDir, payload.jobId);
    fs.mkdirSync(jobOutputDir, { recursive: true });
    const artifactPaths = {};

    for (const [fileName, content] of Object.entries(markdownFiles)) {
      const filePath = path.join(jobOutputDir, fileName);
      fs.writeFileSync(filePath, content, "utf8");
      artifactPaths[fileName] = filePath;
    }

    return artifactPaths;
  }
}

function readSourceFiles(sourcePath, maxCharsPerFile) {
  if (fs.statSync(sourcePath).isDirectory()) {
    return walkFiles(sourcePath)
      .filter((filePath) => !shouldSkip(relativeParts(sourcePath, filePath)))
      .map((filePath) => {
        const text = readText(filePath, maxCharsPerFile);
        if (text == null) {
          return null;
        }
        return { path: normalizePath(path.relative(sourcePath, filePath)), content: text };
      })
      .filter(Boolean);
  }

  if (path.extname(sourcePath).toLowerCase() === ".zip") {
    return readZipTextFiles(fs.readFileSync(sourcePath), maxCharsPerFile);
  }

  const text = readText(sourcePath, maxCharsPerFile);
  return text == null ? [] : [{ path: path.basename(sourcePath), content: text }];
}

async function readDocumentFiles(documentPaths, maxCharsPerFile) {
  const files = [];
  for (const documentPath of documentPaths) {
    if (fs.statSync(documentPath).isDirectory()) {
      for (const childPath of walkFiles(documentPath)) {
        if (!shouldSkip(relativeParts(documentPath, childPath))) {
          files.push(...(await readDocumentPath(childPath, maxCharsPerFile)));
        }
      }
    } else {
      files.push(...(await readDocumentPath(documentPath, maxCharsPerFile)));
    }
  }
  return files;
}

async function readDocumentPath(documentPath, maxCharsPerFile) {
  const suffix = path.extname(documentPath).toLowerCase();
  if (suffix === ".zip") {
    return readZipTextFiles(fs.readFileSync(documentPath), maxCharsPerFile);
  }
  if (suffix === ".xlsx") {
    return [
      {
        path: documentPath,
        content: extractXlsxTextFromBytes(fs.readFileSync(documentPath), maxCharsPerFile),
      },
    ];
  }
  if (suffix === ".pdf") {
    return [
      {
        path: documentPath,
        content: await extractPdfTextFromBytes(fs.readFileSync(documentPath), maxCharsPerFile),
      },
    ];
  }

  const text = readText(documentPath, maxCharsPerFile);
  if (text != null) {
    return [{ path: documentPath, content: text }];
  }
  return [
    {
      path: documentPath,
      content: `[未対応のローカル文書形式です: ${suffix || "拡張子なし"}]`,
    },
  ];
}

function readSourceObject(objectName, data, maxCharsPerFile) {
  const suffix = path.extname(objectName).toLowerCase();
  if (suffix === ".zip") {
    return readZipTextFiles(data, maxCharsPerFile);
  }
  if (TEXT_EXTENSIONS.has(suffix)) {
    const text = decodeUtf8(data, maxCharsPerFile);
    return text == null ? [] : [{ path: objectName, content: text }];
  }
  return [];
}

async function readDocumentObject(objectName, data, maxCharsPerFile) {
  const suffix = path.extname(objectName).toLowerCase();
  if (suffix === ".zip") {
    return readZipTextFiles(data, maxCharsPerFile, objectName);
  }
  if (suffix === ".xlsx") {
    return [{ path: objectName, content: extractXlsxTextFromBytes(data, maxCharsPerFile) }];
  }
  if (suffix === ".pdf") {
    return [{ path: objectName, content: await extractPdfTextFromBytes(data, maxCharsPerFile) }];
  }
  if (TEXT_EXTENSIONS.has(suffix)) {
    const text = decodeUtf8(data, maxCharsPerFile);
    if (text != null) {
      return [{ path: objectName, content: text }];
    }
  }
  return [
    {
      path: objectName,
      content: `[未対応の文書形式です: ${suffix || "拡張子なし"}]`,
    },
  ];
}

function readZipTextFiles(data, maxCharsPerFile, pathPrefix = null) {
  const files = [];
  for (const entry of readZipEntries(data)) {
    const entryParts = entry.name.split("/");
    if (shouldSkip(entryParts)) {
      continue;
    }
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    const text = decodeUtf8(entry.data, maxCharsPerFile);
    if (text == null) {
      continue;
    }
    files.push({
      path: pathPrefix ? `${pathPrefix}::${entry.name}` : entry.name,
      content: text,
    });
  }
  return files;
}

function limitFiles(files, maxFiles) {
  if (maxFiles <= 0) {
    return [];
  }
  return files.slice(0, maxFiles);
}

function walkFiles(rootPath) {
  const results = [];
  for (const name of fs.readdirSync(rootPath).sort()) {
    const childPath = path.join(rootPath, name);
    const stats = fs.statSync(childPath);
    if (stats.isDirectory()) {
      results.push(...walkFiles(childPath));
    } else if (stats.isFile()) {
      results.push(childPath);
    }
  }
  return results;
}

function readText(filePath, maxCharsPerFile) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return null;
  }
  const data = fs.readFileSync(filePath);
  return decodeUtf8(data, maxCharsPerFile);
}

function decodeUtf8(data, maxCharsPerFile) {
  try {
    return truncate(Buffer.from(data).toString("utf8"), maxCharsPerFile);
  } catch {
    return null;
  }
}

async function downloadStorageObject(storageClient, ref) {
  const file = storageClient.bucket(ref.bucket).file(ref.objectName);
  const result = await file.download();
  return Array.isArray(result) ? result[0] : result;
}

async function extractPdfTextFromBytes(data, maxChars) {
  let pdfParse;
  try {
    pdfParse = require("pdf-parse");
  } catch {
    return "[PDF本文抽出には pdf-parse が必要です]";
  }

  try {
    const parsed = await pdfParse(data);
    const text = String(parsed.text || "").trim();
    return text ? truncate(text, maxChars) : "[PDFからテキストを抽出できませんでした]";
  } catch {
    return "[PDFからテキストを抽出できませんでした]";
  }
}

function extractXlsxTextFromBytes(data, maxChars) {
  try {
    const entries = new Map(readZipEntries(data).map((entry) => [entry.name, entry.data.toString("utf8")]));
    const sharedStrings = readXlsxSharedStrings(entries.get("xl/sharedStrings.xml") || "");
    const worksheetNames = [...entries.keys()]
      .filter((name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml"))
      .sort();
    const blocks = [];

    for (const worksheetName of worksheetNames) {
      const rows = readXlsxWorksheetRows(entries.get(worksheetName), sharedStrings);
      if (rows.length > 0) {
        blocks.push([`## ${worksheetName}`, ...rows.map((row) => row.join("\t"))].join("\n"));
      }
      if (blocks.reduce((sum, block) => sum + block.length, 0) >= maxChars) {
        break;
      }
    }

    if (blocks.length === 0) {
      return "[Excelからテキストを抽出できませんでした]";
    }
    return truncate(blocks.join("\n\n"), maxChars);
  } catch {
    return "[Excelからテキストを抽出できませんでした]";
  }
}

function readXlsxSharedStrings(xml) {
  if (!xml) {
    return [];
  }
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map((match) =>
    [...match[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXmlEntities(textMatch[1]))
      .join(""),
  );
}

function readXlsxWorksheetRows(xml, sharedStrings) {
  if (!xml) {
    return [];
  }
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const values = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      values.push(readXlsxCellValue(cellMatch[1], cellMatch[2], sharedStrings));
    }
    if (values.some((value) => value.trim())) {
      rows.push(values);
    }
  }
  return rows;
}

function readXlsxCellValue(attributes, body, sharedStrings) {
  const inlineText = body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
  if (attributes.includes('t="inlineStr"') && inlineText) {
    return decodeXmlEntities(inlineText[1]);
  }

  const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
  if (!valueMatch) {
    return "";
  }
  const rawValue = decodeXmlEntities(valueMatch[1]);
  if (attributes.includes('t="s"')) {
    const index = Number.parseInt(rawValue, 10);
    return Number.isInteger(index) && sharedStrings[index] != null ? sharedStrings[index] : rawValue;
  }
  return rawValue;
}

function decodeXmlEntities(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function truncate(text, maxChars) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function shouldSkip(parts) {
  return parts.some((part) => SKIPPED_DIRS.has(part));
}

function relativeParts(rootPath, filePath) {
  return normalizePath(path.relative(rootPath, filePath)).split("/");
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

module.exports = {
  GcsArtifactWriter,
  GcsInputLoader,
  InMemoryArtifactWriter,
  LocalArtifactWriter,
  LocalFileInputLoader,
  ReferenceOnlyInputLoader,
  extractXlsxTextFromBytes,
  readDocumentObject,
  readSourceObject,
};

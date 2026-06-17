import fs from "node:fs";
import path from "node:path";
import { readZipEntries } from "./zip.js";
import { Storage } from "@google-cloud/storage";
import { AnalysisTaskPayload, StorageObjectRef } from "./payload.js";
import pdfParse from "pdf-parse";

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

export interface LoadedInputs {
  sourceArchiveUri: string;
  documentUris: string[];
  sourceFiles: Array<{ path: string; content: string }>;
  documentFiles: Array<{ path: string; content: string }>;
}

export interface InputLoader {
  load(payload: AnalysisTaskPayload): Promise<LoadedInputs>;
}

export class ReferenceOnlyInputLoader implements InputLoader {
  async load(payload: AnalysisTaskPayload): Promise<LoadedInputs> {
    return {
      sourceArchiveUri: payload.sourceArchive.uri,
      documentUris: payload.documents.map((document) => document.uri),
      sourceFiles: [],
      documentFiles: [],
    };
  }
}

export class GcsInputLoader implements InputLoader {
  private storageClient: Storage;
  private maxFiles: number;
  private maxCharsPerFile: number;

  constructor({
    storageClient = null,
    maxFiles = 80,
    maxCharsPerFile = 12000,
  }: {
    storageClient?: Storage | null;
    maxFiles?: number;
    maxCharsPerFile?: number;
  } = {}) {
    this.storageClient = storageClient || new Storage();
    this.maxFiles = maxFiles;
    this.maxCharsPerFile = maxCharsPerFile;
  }

  async load(payload: AnalysisTaskPayload): Promise<LoadedInputs> {
    const sourceData = await downloadStorageObject(this.storageClient, payload.sourceArchive);
    const sourceFiles = limitFiles(
      readSourceObject(payload.sourceArchive.objectName, sourceData, this.maxCharsPerFile),
      this.maxFiles,
    );

    const documentFiles: Array<{ path: string; content: string }> = [];
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

export class LocalFileInputLoader implements InputLoader {
  private sourcePath: string;
  private documentPaths: string[];
  private maxFiles: number;
  private maxCharsPerFile: number;

  constructor(
    sourcePath: string,
    documentPaths: string[],
    { maxFiles = 80, maxCharsPerFile = 12000 } = {},
  ) {
    this.sourcePath = sourcePath;
    this.documentPaths = [...documentPaths];
    this.maxFiles = maxFiles;
    this.maxCharsPerFile = maxCharsPerFile;
  }

  async load(): Promise<LoadedInputs> {
    return {
      sourceArchiveUri: this.sourcePath,
      documentUris: this.documentPaths,
      sourceFiles: limitFiles(readSourceFiles(this.sourcePath, this.maxCharsPerFile), this.maxFiles),
      documentFiles: limitFiles(
        await readDocumentFiles(this.documentPaths, this.maxCharsPerFile),
        this.maxFiles,
      ),
    };
  }
}

export interface ArtifactWriter {
  write(payload: AnalysisTaskPayload, artifactFiles: Record<string, string>): Promise<Record<string, string>>;
}

export class GcsArtifactWriter implements ArtifactWriter {
  private storageClient: Storage;
  private resultsBucket: string | null;
  private resultsPrefixTemplate: string;

  constructor({
    storageClient = null,
    resultsBucket = null,
    resultsPrefixTemplate = "results/{job_id}",
  }: {
    storageClient?: Storage | null;
    resultsBucket?: string | null;
    resultsPrefixTemplate?: string;
  } = {}) {
    this.storageClient = storageClient || new Storage();
    this.resultsBucket = resultsBucket;
    this.resultsPrefixTemplate = resultsPrefixTemplate;
  }

  async write(
    payload: AnalysisTaskPayload,
    artifactFiles: Record<string, string>,
  ): Promise<Record<string, string>> {
    const bucketName = this.resultsBucket || payload.sourceArchive.bucket;
    const bucket = this.storageClient.bucket(bucketName);
    const prefix = this.resultPrefix(payload);
    const artifactPaths: Record<string, string> = {};

    for (const [fileName, content] of Object.entries(artifactFiles)) {
      const objectName = `${prefix}/${fileName}`;
      await bucket.file(objectName).save(content, {
        contentType: contentTypeForArtifact(fileName),
      });
      artifactPaths[fileName] = `gs://${bucketName}/${objectName}`;
    }

    return artifactPaths;
  }

  private resultPrefix(payload: AnalysisTaskPayload): string {
    return (
      payload.resultsPrefix || this.resultsPrefixTemplate.replaceAll("{job_id}", payload.jobId)
    ).replace(/^\/+|\/+$/g, "");
  }
}

export class InMemoryArtifactWriter implements ArtifactWriter {
  public filesByJobId: Record<string, Record<string, string>> = {};

  async write(
    payload: AnalysisTaskPayload,
    artifactFiles: Record<string, string>,
  ): Promise<Record<string, string>> {
    this.filesByJobId[payload.jobId] = { ...artifactFiles };
    const prefix = (payload.resultsPrefix || `results/${payload.jobId}`).replace(/^\/+|\/+$/g, "");
    return Object.fromEntries(
      Object.keys(artifactFiles).map((fileName) => [fileName, `memory://${prefix}/${fileName}`]),
    );
  }
}

export class LocalArtifactWriter implements ArtifactWriter {
  constructor(private outputDir: string) {}

  async write(
    payload: AnalysisTaskPayload,
    artifactFiles: Record<string, string>,
  ): Promise<Record<string, string>> {
    const jobOutputDir = path.join(this.outputDir, payload.jobId);
    fs.mkdirSync(jobOutputDir, { recursive: true });
    const artifactPaths: Record<string, string> = {};

    for (const [fileName, content] of Object.entries(artifactFiles)) {
      const filePath = path.join(jobOutputDir, fileName);
      fs.writeFileSync(filePath, content, "utf8");
      artifactPaths[fileName] = filePath;
    }

    return artifactPaths;
  }
}

function contentTypeForArtifact(fileName: string): string {
  const suffix = path.extname(fileName).toLowerCase();
  if (suffix === ".json") {
    return "application/json; charset=utf-8";
  }
  if (suffix === ".md") {
    return "text/markdown; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function readSourceFiles(sourcePath: string, maxCharsPerFile: number): Array<{ path: string; content: string }> {
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
      .filter((f): f is { path: string; content: string } => f !== null);
  }

  if (path.extname(sourcePath).toLowerCase() === ".zip") {
    return readZipTextFiles(fs.readFileSync(sourcePath), maxCharsPerFile);
  }

  const text = readText(sourcePath, maxCharsPerFile);
  return text == null ? [] : [{ path: path.basename(sourcePath), content: text }];
}

async function readDocumentFiles(
  documentPaths: string[],
  maxCharsPerFile: number,
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
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

async function readDocumentPath(
  documentPath: string,
  maxCharsPerFile: number,
): Promise<Array<{ path: string; content: string }>> {
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

export function readSourceObject(
  objectName: string,
  data: Buffer | Uint8Array,
  maxCharsPerFile: number,
): Array<{ path: string; content: string }> {
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

export async function readDocumentObject(
  objectName: string,
  data: Buffer | Uint8Array,
  maxCharsPerFile: number,
): Promise<Array<{ path: string; content: string }>> {
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

function readZipTextFiles(
  data: Buffer | Uint8Array,
  maxCharsPerFile: number,
  pathPrefix: string | null = null,
): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
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

function limitFiles<T>(files: T[], maxFiles: number): T[] {
  if (maxFiles <= 0) {
    return [];
  }
  return files.slice(0, maxFiles);
}

function walkFiles(rootPath: string): string[] {
  const results: string[] = [];
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

function readText(filePath: string, maxCharsPerFile: number): string | null {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return null;
  }
  const data = fs.readFileSync(filePath);
  return decodeUtf8(data, maxCharsPerFile);
}

function decodeUtf8(data: Buffer | Uint8Array, maxCharsPerFile: number): string | null {
  try {
    return truncate(Buffer.from(data).toString("utf8"), maxCharsPerFile);
  } catch {
    return null;
  }
}

async function downloadStorageObject(storageClient: Storage, ref: StorageObjectRef): Promise<Buffer> {
  const file = storageClient.bucket(ref.bucket).file(ref.objectName);
  const result = await file.download();
  return Array.isArray(result) ? result[0] : result;
}

async function extractPdfTextFromBytes(data: Buffer | Uint8Array, maxChars: number): Promise<string> {
  try {
    const parsed = await pdfParse(Buffer.from(data));
    const text = String(parsed.text || "").trim();
    return text ? truncate(text, maxChars) : "[PDFからテキストを抽出できませんでした]";
  } catch (err) {
    return "[PDFからテキストを抽出できませんでした]";
  }
}

export function extractXlsxTextFromBytes(data: Buffer | Uint8Array, maxChars: number): string {
  try {
    const entries = new Map(
      readZipEntries(data).map((entry) => [entry.name, entry.data.toString("utf8")]),
    );
    const sharedStrings = readXlsxSharedStrings(entries.get("xl/sharedStrings.xml") || "");
    const worksheetNames = [...entries.keys()]
      .filter((name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml"))
      .sort();
    const blocks: string[] = [];

    for (const worksheetName of worksheetNames) {
      const rows = readXlsxWorksheetRows(entries.get(worksheetName) || "", sharedStrings);
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

function readXlsxSharedStrings(xml: string): string[] {
  if (!xml) {
    return [];
  }
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map((match) =>
    [...match[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXmlEntities(textMatch[1]))
      .join(""),
  );
}

function readXlsxWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  if (!xml) {
    return [];
  }
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const values: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      values.push(readXlsxCellValue(cellMatch[1], cellMatch[2], sharedStrings));
    }
    if (values.some((value) => value.trim())) {
      rows.push(values);
    }
  }
  return rows;
}

function readXlsxCellValue(attributes: string, body: string, sharedStrings: string[]): string {
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

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function shouldSkip(parts: string[]): boolean {
  return parts.some((part) => SKIPPED_DIRS.has(part));
}

function relativeParts(rootPath: string, filePath: string): string[] {
  return normalizePath(path.relative(rootPath, filePath)).split("/");
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

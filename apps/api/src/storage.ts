import { Storage } from "@google-cloud/storage";
import { Readable } from "node:stream";
import { ApiError } from "./errors";
import { parseGcsUri } from "./gcs";

type StorageFile = {
  save(data: Buffer, options?: { contentType?: string }): Promise<void>;
  getSignedUrl(options: {
    version: "v4";
    action: "read";
    expires: number;
  }): Promise<[string]>;
};

type StorageClient = {
  bucket(bucketName: string): {
    file(objectName: string): StorageFile;
  };
};

export type UploadedFile = {
  filename?: string;
  name?: string;
  data?: Buffer;
  stream?: NodeJS.ReadableStream | (() => ReadableStream<Uint8Array<ArrayBuffer>>);
  content_type?: string;
  contentType?: string;
  type?: string;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
};

export type StoredObject = Readonly<{
  originalFilename: string;
  objectName: string;
  uri: string;
  contentType: string;
}>;

export type StoredUploadBundle = Readonly<{
  uploadId: string;
  source: StoredObject;
  documents: readonly StoredObject[];
}>;

export class StorageService {
  private readonly client: StorageClient;
  private readonly bucketName: string;
  private readonly uploadsPrefixTemplate: string;

  constructor(
    bucketName: string,
    { uploadsPrefixTemplate = "uploads/{upload_id}", storageClient = null }: {
      uploadsPrefixTemplate?: string;
      storageClient?: StorageClient | null;
    } = {},
  ) {
    this.client = storageClient ?? (new Storage() as unknown as StorageClient);
    this.bucketName = bucketName;
    this.uploadsPrefixTemplate = uploadsPrefixTemplate;
  }

  async uploadBundle(
    uploadId: string,
    sourceFile: UploadedFile | null,
    documentFiles: readonly UploadedFile[],
    maxDocumentFiles = 600,
  ): Promise<StoredUploadBundle> {
    if (!sourceFile || !filename(sourceFile)) {
      throw new ApiError(400, "missing_source_archive", "sourceArchive file is required");
    }
    if (!documentFiles || documentFiles.length === 0) {
      throw new ApiError(400, "missing_documents", "At least one documents file is required");
    }
    if (documentFiles.length > maxDocumentFiles) {
      throw new ApiError(400, "too_many_documents", `documents must contain at most ${maxDocumentFiles} files`);
    }

    const sourceName = sanitizeFilename(filename(sourceFile));
    if (!sourceName.toLowerCase().endsWith(".zip")) {
      throw new ApiError(400, "invalid_source_archive", "sourceArchive must be a ZIP file");
    }

    const sourceBytes = await fileToBuffer(sourceFile);
    if (!isZipBytes(sourceBytes)) {
      throw new ApiError(400, "invalid_source_archive", "sourceArchive is not a readable ZIP file");
    }

    const prefix = this.uploadPrefix(uploadId);
    const source = await this.uploadOne(sourceFile, sourceBytes, `${prefix}/source/${sourceName}`);

    const documents: StoredObject[] = [];
    for (let index = 0; index < documentFiles.length; index += 1) {
      const documentFile = documentFiles[index];
      if (!documentFile || !filename(documentFile)) {
        throw new ApiError(400, "invalid_document", "documents files must have filenames");
      }
      const documentName = sanitizeFilename(filename(documentFile));
      documents.push(
        await this.uploadOne(
          documentFile,
          await fileToBuffer(documentFile),
          `${prefix}/documents/${String(index + 1).padStart(4, "0")}-${documentName}`,
        ),
      );
    }

    return {
      uploadId,
      source,
      documents,
    };
  }

  async signedUrl(uri: string, expirationSeconds: number): Promise<string> {
    const ref = parseGcsUri(uri);
    const [url] = await this.client
      .bucket(ref.bucket)
      .file(ref.objectName)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + expirationSeconds * 1000,
      });
    return url;
  }

  private async uploadOne(file: UploadedFile, bytes: Buffer, objectName: string): Promise<StoredObject> {
    const contentType = file.content_type || file.contentType || file.type || "application/octet-stream";
    await this.client.bucket(this.bucketName).file(objectName).save(bytes, { contentType });
    return {
      originalFilename: filename(file),
      objectName,
      uri: `gs://${this.bucketName}/${objectName}`,
      contentType,
    };
  }

  private uploadPrefix(uploadId: string): string {
    return this.uploadsPrefixTemplate.replaceAll("{upload_id}", uploadId).replace(/^\/+|\/+$/g, "");
  }
}

export function sanitizeFilename(value: string): string {
  const name = String(value).split(/[\\/]/).at(-1)?.trim() ?? "";
  const separatorIndex = name.lastIndexOf(".");

  if (separatorIndex > 0 && name.slice(0, separatorIndex).replace(/[._-]/g, "").trim()) {
    const safeStem = safeFilenamePart(name.slice(0, separatorIndex)) || "file";
    const safeSuffix = name.slice(separatorIndex + 1).replace(/[^A-Za-z0-9]+/g, "");
    return safeSuffix ? `${safeStem}.${safeSuffix}` : safeStem;
  }

  return safeFilenamePart(name) || "file";
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "");
}

function filename(file: UploadedFile): string {
  return String(file.filename || file.name || "");
}

export async function fileToBuffer(file: UploadedFile | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(file)) {
    return file;
  }
  if (Buffer.isBuffer(file.data)) {
    return file.data;
  }
  if (typeof file.arrayBuffer === "function") {
    return Buffer.from(await file.arrayBuffer());
  }
  if (file.stream && typeof file.stream !== "function" && typeof file.stream.read === "function") {
    return readNodeStream(file.stream);
  }
  if (typeof file.text === "function") {
    return Buffer.from(await file.text(), "utf8");
  }
  throw new ApiError(400, "invalid_file", "Uploaded file cannot be read");
}

function readNodeStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    if (stream instanceof Readable && stream.readableEnded) {
      resolve(Buffer.concat(chunks));
    }
  });
}

function isZipBytes(buffer: Buffer): boolean {
  if (buffer.length < 22) {
    return false;
  }
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return true;
    }
  }
  return false;
}

import { FieldValue, Firestore } from "@google-cloud/firestore";

type FirestoreCollection = {
  doc(id: string): {
    set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
    get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  };
};

type FirestoreClient = {
  SERVER_TIMESTAMP?: unknown | (() => unknown);
  collection(name: string): FirestoreCollection;
};

export type UploadRecord = Readonly<{
  uploadId: string;
  sourceArchiveUri: string;
  documentUris: readonly string[];
  projectName: string | null;
  sourceFileName: string | null;
  documentFileNames: readonly string[];
}>;

export type JobRecord = Readonly<{
  jobId: string;
  status: string;
  sourceArchiveUri: string;
  documentUris: readonly string[];
  resultsPrefix: string;
  uploadId: string | null;
  projectName: string | null;
  artifactPaths: Record<string, string>;
  errorMessage: string | null;
}>;

export interface UploadRepository {
  create(record: UploadRecord): Promise<void>;
  get(uploadId: string): Promise<UploadRecord | null>;
}

export interface JobRepository {
  createQueued(record: JobRecord): Promise<void>;
  markFailed(jobId: string, errorMessage: string): Promise<void>;
  get(jobId: string): Promise<JobRecord | null>;
}

export class FirestoreUploadRepository implements UploadRepository {
  private readonly serverTimestamp: unknown;
  private readonly collection: FirestoreCollection;

  constructor(collectionName: string, firestoreClient: FirestoreClient | null = null) {
    const client = firestoreClient ?? (new Firestore() as unknown as FirestoreClient);
    this.serverTimestamp = firestoreClient ? serverTimestampFromClient(firestoreClient) : FieldValue.serverTimestamp();
    this.collection = client.collection(collectionName);
  }

  async create(record: UploadRecord): Promise<void> {
    await this.collection.doc(record.uploadId).set({
      upload_id: record.uploadId,
      source_archive_uri: record.sourceArchiveUri,
      document_uris: [...record.documentUris],
      project_name: record.projectName,
      source_file_name: record.sourceFileName,
      document_file_names: [...record.documentFileNames],
      created_at: this.serverTimestamp,
    });
  }

  async get(uploadId: string): Promise<UploadRecord | null> {
    const snapshot = await this.collection.doc(uploadId).get();
    if (!snapshot.exists) {
      return null;
    }
    const data = snapshot.data() || {};
    return uploadRecord({
      uploadId,
      sourceArchiveUri: String(data.source_archive_uri || data.sourceArchiveUri || ""),
      documentUris: stringArray(data.document_uris || data.documentUris),
      projectName: optionalString(data.project_name || data.projectName),
      sourceFileName: optionalString(data.source_file_name || data.sourceFileName),
      documentFileNames: stringArray(data.document_file_names || data.documentFileNames),
    });
  }
}

export class FirestoreJobRepository implements JobRepository {
  private readonly serverTimestamp: unknown;
  private readonly collection: FirestoreCollection;

  constructor(collectionName: string, firestoreClient: FirestoreClient | null = null) {
    const client = firestoreClient ?? (new Firestore() as unknown as FirestoreClient);
    this.serverTimestamp = firestoreClient ? serverTimestampFromClient(firestoreClient) : FieldValue.serverTimestamp();
    this.collection = client.collection(collectionName);
  }

  async createQueued(record: JobRecord): Promise<void> {
    await this.collection.doc(record.jobId).set({
      job_id: record.jobId,
      upload_id: record.uploadId,
      project_name: record.projectName,
      source_archive_uri: record.sourceArchiveUri,
      document_uris: [...record.documentUris],
      results_prefix: record.resultsPrefix,
      status: "queued",
      artifact_paths: {},
      error_message: null,
      created_at: this.serverTimestamp,
      updated_at: this.serverTimestamp,
    });
  }

  async markFailed(jobId: string, errorMessage: string): Promise<void> {
    await this.collection.doc(jobId).set(
      {
        status: "failed",
        error_message: errorMessage,
        updated_at: this.serverTimestamp,
      },
      { merge: true },
    );
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const snapshot = await this.collection.doc(jobId).get();
    if (!snapshot.exists) {
      return null;
    }
    const data = snapshot.data() || {};
    return jobRecord({
      jobId,
      status: String(data.status || ""),
      uploadId: optionalString(data.upload_id || data.uploadId),
      projectName: optionalString(data.project_name || data.projectName),
      sourceArchiveUri: String(data.source_archive_uri || data.sourceArchiveUri || ""),
      documentUris: stringArray(data.document_uris || data.documentUris),
      resultsPrefix: String(data.results_prefix || data.resultsPrefix || ""),
      artifactPaths: stringRecord(data.artifact_paths || data.artifactPaths),
      errorMessage: optionalString(data.error_message || data.errorMessage),
    });
  }
}

export function uploadRecord({
  uploadId,
  sourceArchiveUri,
  documentUris,
  projectName = null,
  sourceFileName = null,
  documentFileNames = [],
}: {
  uploadId: string;
  sourceArchiveUri: string;
  documentUris: readonly string[];
  projectName?: string | null;
  sourceFileName?: string | null;
  documentFileNames?: readonly string[];
}): UploadRecord {
  return {
    uploadId,
    sourceArchiveUri,
    documentUris: Object.freeze([...documentUris]),
    projectName,
    sourceFileName,
    documentFileNames: Object.freeze([...documentFileNames]),
  };
}

export function jobRecord({
  jobId,
  status,
  sourceArchiveUri,
  documentUris,
  resultsPrefix,
  uploadId = null,
  projectName = null,
  artifactPaths = {},
  errorMessage = null,
}: {
  jobId: string;
  status: string;
  sourceArchiveUri: string;
  documentUris: readonly string[];
  resultsPrefix: string;
  uploadId?: string | null;
  projectName?: string | null;
  artifactPaths?: Record<string, string>;
  errorMessage?: string | null;
}): JobRecord {
  return {
    jobId,
    status,
    sourceArchiveUri,
    documentUris: Object.freeze([...documentUris]),
    resultsPrefix,
    uploadId,
    projectName,
    artifactPaths: { ...artifactPaths },
    errorMessage,
  };
}

function serverTimestampFromClient(client: FirestoreClient): unknown {
  if (typeof client.SERVER_TIMESTAMP === "function") {
    return client.SERVER_TIMESTAMP();
  }
  return client.SERVER_TIMESTAMP ?? null;
}

function optionalString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

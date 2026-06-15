import { ApiConfig } from "./config";
import { ApiError } from "./errors";
import { parseGcsUri } from "./gcs";
import { newJobId, newUploadId } from "./ids";
import {
  FirestoreJobRepository,
  FirestoreUploadRepository,
  JobRecord,
  JobRepository,
  UploadRecord,
  UploadRepository,
  jobRecord,
  uploadRecord,
} from "./repositories";
import { StorageService, UploadedFile } from "./storage";
import { AnalysisTaskPayload, CloudTasksEnqueuer, TaskEnqueuer } from "./tasks";

export type UploadResponse = {
  uploadId: string;
  sourceArchiveUri: string;
  documentUris: string[];
  projectName?: string;
};

export type JobResponse = {
  jobId: string;
  status: string;
  sourceArchiveUri: string;
  documentUris: string[];
  resultsPrefix: string;
  uploadId?: string;
  projectName?: string;
  artifactPaths?: Record<string, string>;
  errorMessage?: string;
  taskName?: string;
};

export type ResultsResponse = {
  jobId: string;
  status: string;
  expiresIn: number;
  artifacts: Array<{
    name: string;
    uri: string;
    url: string;
  }>;
};

export type StorageBoundary = Pick<StorageService, "uploadBundle" | "signedUrl">;

export class DriftApiService {
  private readonly config: ApiConfig;
  private readonly storage: StorageBoundary;
  private readonly uploads: UploadRepository;
  private readonly jobs: JobRepository;
  private readonly tasks: TaskEnqueuer;

  constructor({
    config,
    storageService,
    uploadRepository,
    jobRepository,
    taskEnqueuer,
  }: {
    config: ApiConfig;
    storageService: StorageBoundary;
    uploadRepository: UploadRepository;
    jobRepository: JobRepository;
    taskEnqueuer: TaskEnqueuer;
  }) {
    this.config = config;
    this.storage = storageService;
    this.uploads = uploadRepository;
    this.jobs = jobRepository;
    this.tasks = taskEnqueuer;
  }

  async createUpload(
    sourceFile: UploadedFile | null,
    documentFiles: readonly UploadedFile[],
    projectName: string | null = null,
  ): Promise<UploadResponse> {
    const uploadId = newUploadId();
    const storedBundle = await this.storage.uploadBundle(
      uploadId,
      sourceFile,
      documentFiles,
      this.config.maxDocumentFiles,
    );
    const record = uploadRecord({
      uploadId,
      sourceArchiveUri: storedBundle.source.uri,
      documentUris: storedBundle.documents.map((document) => document.uri),
      projectName: optionalText(projectName),
      sourceFileName: storedBundle.source.originalFilename,
      documentFileNames: storedBundle.documents.map((document) => document.originalFilename),
    });
    await this.uploads.create(record);
    return uploadResponse(record);
  }

  async createJob(rawBody: Record<string, unknown>): Promise<JobResponse> {
    const uploadId = optionalText(readFirst(rawBody, "uploadId", "upload_id"));
    let uploadRecordValue: UploadRecord | null = null;
    if (uploadId) {
      uploadRecordValue = await this.uploads.get(uploadId);
      if (uploadRecordValue == null) {
        throw new ApiError(404, "upload_not_found", `Upload not found: ${uploadId}`);
      }
    }

    let sourceArchiveUri = optionalText(readFirst(rawBody, "sourceArchiveUri", "source_archive_uri"));
    let documentUris: unknown = readFirst(rawBody, "documentUris", "document_uris", "documents");
    let projectName = optionalText(readFirst(rawBody, "projectName", "project_name"));
    const requestedBy = optionalText(readFirst(rawBody, "requestedBy", "requested_by"));

    if (uploadRecordValue != null) {
      sourceArchiveUri = sourceArchiveUri || uploadRecordValue.sourceArchiveUri;
      documentUris = documentUris == null ? uploadRecordValue.documentUris : documentUris;
      projectName = projectName || uploadRecordValue.projectName;
    }

    if (!sourceArchiveUri) {
      throw new ApiError(400, "missing_source_archive", "sourceArchiveUri or uploadId is required");
    }
    parseGcsUri(sourceArchiveUri, "sourceArchiveUri");

    const normalizedDocumentUris = normalizeDocumentUris(documentUris);
    normalizedDocumentUris.forEach((documentUri, index) => parseGcsUri(documentUri, `documentUris[${index}]`));

    const jobId = newJobId();
    const resultsPrefix = this.config.resultsPrefixTemplate.replaceAll("{job_id}", jobId).replace(/^\/+|\/+$/g, "");
    const record = jobRecord({
      jobId,
      uploadId,
      projectName,
      sourceArchiveUri,
      documentUris: normalizedDocumentUris,
      resultsPrefix,
      status: "queued",
    });
    await this.jobs.createQueued(record);

    const taskPayload: AnalysisTaskPayload = {
      jobId,
      sourceArchiveUri,
      documentUris: [...normalizedDocumentUris],
      resultsPrefix,
    };
    if (projectName) {
      taskPayload.projectName = projectName;
    }
    if (requestedBy) {
      taskPayload.requestedBy = requestedBy;
    }

    let taskName: string | null = null;
    try {
      taskName = await this.tasks.enqueueAnalysisTask(taskPayload);
    } catch (error) {
      await this.jobs.markFailed(jobId, error instanceof Error ? error.message : String(error));
      throw error;
    }

    const response = jobResponse(record);
    if (taskName) {
      response.taskName = taskName;
    }
    return response;
  }

  async getJob(jobId: string): Promise<JobResponse> {
    const record = await this.jobs.get(jobId);
    if (record == null) {
      throw new ApiError(404, "job_not_found", `Job not found: ${jobId}`);
    }
    return jobResponse(record);
  }

  async getResults(jobId: string): Promise<ResultsResponse> {
    const record = await this.jobs.get(jobId);
    if (record == null) {
      throw new ApiError(404, "job_not_found", `Job not found: ${jobId}`);
    }
    if (record.status !== "succeeded") {
      throw new ApiError(
        409,
        "job_not_succeeded",
        "Job results are available only after the job succeeds",
        { status: record.status },
      );
    }
    if (!record.artifactPaths || Object.keys(record.artifactPaths).length === 0) {
      throw new ApiError(404, "results_not_found", `No artifacts found for job: ${jobId}`);
    }

    const artifacts = [];
    for (const [name, uri] of Object.entries(record.artifactPaths).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      parseGcsUri(uri, `artifactPaths.${name}`);
      artifacts.push({
        name,
        uri,
        url: await this.storage.signedUrl(uri, this.config.signedUrlExpirationSeconds),
      });
    }

    return {
      jobId: record.jobId,
      status: record.status,
      expiresIn: this.config.signedUrlExpirationSeconds,
      artifacts,
    };
  }
}

export function buildService(config: ApiConfig): DriftApiService {
  const storageService = new StorageService(config.uploadsBucket, {
    uploadsPrefixTemplate: config.uploadsPrefixTemplate,
  });
  return new DriftApiService({
    config,
    storageService,
    uploadRepository: new FirestoreUploadRepository(config.firestoreUploadsCollection),
    jobRepository: new FirestoreJobRepository(config.firestoreJobsCollection),
    taskEnqueuer: new CloudTasksEnqueuer(config),
  });
}

export function uploadResponse(record: UploadRecord): UploadResponse {
  const response: UploadResponse = {
    uploadId: record.uploadId,
    sourceArchiveUri: record.sourceArchiveUri,
    documentUris: [...record.documentUris],
  };
  if (record.projectName) {
    response.projectName = record.projectName;
  }
  return response;
}

export function jobResponse(record: JobRecord): JobResponse {
  const response: JobResponse = {
    jobId: record.jobId,
    status: record.status,
    sourceArchiveUri: record.sourceArchiveUri,
    documentUris: [...record.documentUris],
    resultsPrefix: record.resultsPrefix,
  };
  if (record.uploadId) {
    response.uploadId = record.uploadId;
  }
  if (record.projectName) {
    response.projectName = record.projectName;
  }
  if (record.artifactPaths && Object.keys(record.artifactPaths).length > 0) {
    response.artifactPaths = record.artifactPaths;
  }
  if (record.errorMessage) {
    response.errorMessage = record.errorMessage;
  }
  return response;
}

export function normalizeDocumentUris(value: unknown): string[] {
  if (value == null) {
    throw new ApiError(400, "missing_documents", "documentUris or uploadId is required");
  }
  if (!Array.isArray(value)) {
    throw new ApiError(400, "invalid_documents", "documentUris must be an array");
  }
  if (value.length === 0) {
    throw new ApiError(400, "missing_documents", "documentUris must not be empty");
  }
  return value.map((item) => String(item));
}

function readFirst(mapping: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(mapping, key)) {
      return mapping[key];
    }
  }
  return undefined;
}

export function optionalText(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

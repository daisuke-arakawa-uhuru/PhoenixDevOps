import { ConfigError } from "./errors";

type Env = Record<string, string | undefined>;

export class ApiConfig {
  readonly uploadsBucket: string;
  readonly firestoreUploadsCollection: string;
  readonly firestoreJobsCollection: string;
  readonly tasksProjectId: string | null;
  readonly tasksLocation: string | null;
  readonly tasksQueue: string | null;
  readonly workerUrl: string | null;
  readonly tasksServiceAccountEmail: string | null;
  readonly signedUrlExpirationSeconds: number;
  readonly uploadsPrefixTemplate: string;
  readonly resultsPrefixTemplate: string;
  readonly maxDocumentFiles: number;

  constructor({
    uploadsBucket,
    firestoreUploadsCollection = "uploads",
    firestoreJobsCollection = "jobs",
    tasksProjectId = null,
    tasksLocation = null,
    tasksQueue = null,
    workerUrl = null,
    tasksServiceAccountEmail = null,
    signedUrlExpirationSeconds = 3600,
    uploadsPrefixTemplate = "uploads/{upload_id}",
    resultsPrefixTemplate = "results/{job_id}",
    maxDocumentFiles = 600,
  }: {
    uploadsBucket: string;
    firestoreUploadsCollection?: string;
    firestoreJobsCollection?: string;
    tasksProjectId?: string | null;
    tasksLocation?: string | null;
    tasksQueue?: string | null;
    workerUrl?: string | null;
    tasksServiceAccountEmail?: string | null;
    signedUrlExpirationSeconds?: number;
    uploadsPrefixTemplate?: string;
    resultsPrefixTemplate?: string;
    maxDocumentFiles?: number;
  }) {
    this.uploadsBucket = uploadsBucket;
    this.firestoreUploadsCollection = firestoreUploadsCollection;
    this.firestoreJobsCollection = firestoreJobsCollection;
    this.tasksProjectId = tasksProjectId;
    this.tasksLocation = tasksLocation;
    this.tasksQueue = tasksQueue;
    this.workerUrl = workerUrl;
    this.tasksServiceAccountEmail = tasksServiceAccountEmail;
    this.signedUrlExpirationSeconds = signedUrlExpirationSeconds;
    this.uploadsPrefixTemplate = uploadsPrefixTemplate;
    this.resultsPrefixTemplate = resultsPrefixTemplate;
    this.maxDocumentFiles = maxDocumentFiles;
  }

  static fromEnv(env: Env = process.env): ApiConfig {
    const uploadsBucket = env.UPLOADS_BUCKET || env.STORAGE_BUCKET;
    if (!uploadsBucket) {
      throw new ConfigError("UPLOADS_BUCKET is required");
    }

    return new ApiConfig({
      uploadsBucket,
      firestoreUploadsCollection: env.FIRESTORE_UPLOADS_COLLECTION || "uploads",
      firestoreJobsCollection: env.FIRESTORE_JOBS_COLLECTION || "jobs",
      tasksProjectId: env.TASKS_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCP_PROJECT || null,
      tasksLocation: env.TASKS_LOCATION || null,
      tasksQueue: env.TASKS_QUEUE || null,
      workerUrl: env.WORKER_URL || null,
      tasksServiceAccountEmail: env.TASKS_SERVICE_ACCOUNT_EMAIL || null,
      signedUrlExpirationSeconds: readIntEnv(env, "SIGNED_URL_EXPIRATION_SECONDS", 3600),
      uploadsPrefixTemplate: env.UPLOADS_PREFIX_TEMPLATE || "uploads/{upload_id}",
      resultsPrefixTemplate: env.RESULTS_PREFIX_TEMPLATE || "results/{job_id}",
      maxDocumentFiles: readIntEnv(env, "MAX_DOCUMENT_FILES", 600),
    });
  }

  requireTasksConfig(): void {
    const missing = [
      ["TASKS_PROJECT_ID or GOOGLE_CLOUD_PROJECT", this.tasksProjectId],
      ["TASKS_LOCATION", this.tasksLocation],
      ["TASKS_QUEUE", this.tasksQueue],
      ["WORKER_URL", this.workerUrl],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new ConfigError(`Missing Cloud Tasks configuration: ${missing.join(", ")}`);
    }
  }
}

function readIntEnv(env: Env, name: string, defaultValue: number): number {
  const rawValue = env[name];
  if (rawValue == null || rawValue === "") {
    return defaultValue;
  }
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value)) {
    throw new ConfigError(`${name} must be an integer`);
  }
  if (value <= 0) {
    throw new ConfigError(`${name} must be greater than zero`);
  }
  return value;
}

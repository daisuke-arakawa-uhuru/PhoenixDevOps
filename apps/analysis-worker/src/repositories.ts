import { Firestore, FieldValue, CollectionReference } from "@google-cloud/firestore";

export const JobStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

export type JobStatusType = (typeof JobStatus)[keyof typeof JobStatus];

export interface JobRecord {
  jobId: string;
  status: string;
  artifactPaths: Record<string, string>;
  errorMessage: string | null;
}

export interface JobRepository {
  get(jobId: string): Promise<JobRecord | null>;
  markRunning(jobId: string): Promise<void>;
  markSucceeded(jobId: string, artifactPaths: Record<string, string>): Promise<void>;
  markFailed(jobId: string, errorMessage: string): Promise<void>;
}

export class FirestoreJobRepository implements JobRepository {
  private collection: CollectionReference;
  private firestoreFieldValue = FieldValue;

  constructor(collectionName: string) {
    this.collection = new Firestore().collection(collectionName);
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const snapshot = await this.collection.doc(jobId).get();
    if (!snapshot.exists) {
      return null;
    }
    const data = snapshot.data() || {};
    return {
      jobId,
      status: String(data.status || ""),
      artifactPaths: { ...(data.artifact_paths || data.artifactPaths || {}) },
      errorMessage: data.error_message || data.errorMessage || null,
    };
  }

  async markRunning(jobId: string): Promise<void> {
    await this.collection.doc(jobId).set(
      {
        status: JobStatus.RUNNING,
        updated_at: this.firestoreFieldValue.serverTimestamp(),
        error_message: null,
      },
      { merge: true },
    );
  }

  async markSucceeded(jobId: string, artifactPaths: Record<string, string>): Promise<void> {
    await this.collection.doc(jobId).set(
      {
        status: JobStatus.SUCCEEDED,
        artifact_paths: artifactPaths,
        updated_at: this.firestoreFieldValue.serverTimestamp(),
        error_message: null,
      },
      { merge: true },
    );
  }

  async markFailed(jobId: string, errorMessage: string): Promise<void> {
    await this.collection.doc(jobId).set(
      {
        status: JobStatus.FAILED,
        updated_at: this.firestoreFieldValue.serverTimestamp(),
        error_message: errorMessage,
      },
      { merge: true },
    );
  }
}

export class InMemoryJobRepository implements JobRepository {
  public records: Record<string, JobRecord> = {};
  public transitions: Record<string, string> = {};

  async get(jobId: string): Promise<JobRecord | null> {
    return this.records[jobId] || null;
  }

  async markRunning(jobId: string): Promise<void> {
    this.transitions[jobId] = JobStatus.RUNNING;
    this.records[jobId] = { jobId, status: JobStatus.RUNNING, artifactPaths: {}, errorMessage: null };
  }

  async markSucceeded(jobId: string, artifactPaths: Record<string, string>): Promise<void> {
    this.transitions[jobId] = JobStatus.SUCCEEDED;
    this.records[jobId] = {
      jobId,
      status: JobStatus.SUCCEEDED,
      artifactPaths: { ...artifactPaths },
      errorMessage: null,
    };
  }

  async markFailed(jobId: string, errorMessage: string): Promise<void> {
    this.transitions[jobId] = JobStatus.FAILED;
    this.records[jobId] = {
      jobId,
      status: JobStatus.FAILED,
      artifactPaths: {},
      errorMessage,
    };
  }
}

export function utcNowIso(): string {
  return new Date().toISOString();
}

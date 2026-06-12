import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiConfig } from "../src/config";
import { ApiError } from "../src/errors";
import {
  JobRecord,
  JobRepository,
  UploadRecord,
  UploadRepository,
  jobRecord,
  uploadRecord,
} from "../src/repositories";
import { DriftApiService, StorageBoundary } from "../src/service";
import { UploadedFile } from "../src/storage";
import { AnalysisTaskPayload, TaskEnqueuer } from "../src/tasks";

class FakeUploadRepository implements UploadRepository {
  readonly records: Record<string, UploadRecord> = {};

  async create(record: UploadRecord): Promise<void> {
    this.records[record.uploadId] = record;
  }

  async get(uploadId: string): Promise<UploadRecord | null> {
    return this.records[uploadId] || null;
  }
}

class FakeJobRepository implements JobRepository {
  readonly records: Record<string, JobRecord> = {};
  readonly failed: Record<string, string> = {};

  async createQueued(record: JobRecord): Promise<void> {
    this.records[record.jobId] = record;
  }

  async markFailed(jobId: string, errorMessage: string): Promise<void> {
    this.failed[jobId] = errorMessage;
    const current = this.records[jobId];
    this.records[jobId] = jobRecord({
      jobId: current.jobId,
      uploadId: current.uploadId,
      projectName: current.projectName,
      sourceArchiveUri: current.sourceArchiveUri,
      documentUris: current.documentUris,
      resultsPrefix: current.resultsPrefix,
      status: "failed",
      errorMessage,
    });
  }

  async get(jobId: string): Promise<JobRecord | null> {
    return this.records[jobId] || null;
  }
}

class FakeStorageService implements StorageBoundary {
  readonly signedUrlCalls: Array<[string, number]> = [];

  async uploadBundle(): ReturnType<StorageBoundary["uploadBundle"]> {
    throw new Error("uploadBundle is not used in this test");
  }

  async signedUrl(uri: string, expirationSeconds: number): Promise<string> {
    this.signedUrlCalls.push([uri, expirationSeconds]);
    return `https://signed.example/${uri.replace("gs://", "")}`;
  }
}

class FakeTasks implements TaskEnqueuer {
  readonly payloads: AnalysisTaskPayload[] = [];

  async enqueueAnalysisTask(payload: AnalysisTaskPayload): Promise<string> {
    this.payloads.push(payload);
    return "task-name-1";
  }
}

class FailingTasks implements TaskEnqueuer {
  async enqueueAnalysisTask(): Promise<string> {
    throw new Error("queue unavailable");
  }
}

test("createJob from upload enqueues worker payload", async () => {
  const uploads = new FakeUploadRepository();
  await uploads.create(
    uploadRecord({
      uploadId: "upload-123",
      projectName: "Legacy SaaS",
      sourceArchiveUri: "gs://uploads/uploads/upload-123/source/source.zip",
      documentUris: ["gs://uploads/uploads/upload-123/documents/spec.md"],
    }),
  );
  const jobs = new FakeJobRepository();
  const tasks = new FakeTasks();
  const service = buildTestService({ uploads, jobs, tasks });

  const response = await service.createJob({ uploadId: "upload-123" });

  const jobId = response.jobId;
  assert.equal(response.status, "queued");
  assert.equal(response.uploadId, "upload-123");
  assert.equal(jobs.records[jobId].projectName, "Legacy SaaS");
  assert.deepEqual(tasks.payloads[0], {
    jobId,
    sourceArchiveUri: "gs://uploads/uploads/upload-123/source/source.zip",
    documentUris: ["gs://uploads/uploads/upload-123/documents/spec.md"],
    resultsPrefix: `results/${jobId}`,
    projectName: "Legacy SaaS",
  });
});

test("createJob accepts direct GCS references", async () => {
  const jobs = new FakeJobRepository();
  const tasks = new FakeTasks();
  const service = buildTestService({ jobs, tasks });

  const response = await service.createJob({
    projectName: "Direct",
    sourceArchiveUri: "gs://uploads/source.zip",
    documentUris: ["gs://uploads/spec.md"],
  });

  assert.equal(response.status, "queued");
  assert.equal(response.projectName, "Direct");
  assert.equal(tasks.payloads[0].sourceArchiveUri, "gs://uploads/source.zip");
});

test("createJob marks failed when task enqueue fails", async () => {
  const uploads = new FakeUploadRepository();
  await uploads.create(
    uploadRecord({
      uploadId: "upload-123",
      sourceArchiveUri: "gs://uploads/source.zip",
      documentUris: ["gs://uploads/spec.md"],
    }),
  );
  const jobs = new FakeJobRepository();
  const service = buildTestService({ uploads, jobs, tasks: new FailingTasks() });

  await assert.rejects(() => service.createJob({ uploadId: "upload-123" }), /queue unavailable/);

  const jobId = Object.keys(jobs.records)[0];
  assert.equal(jobs.records[jobId].status, "failed");
});

test("getResults requires succeeded job", async () => {
  const jobs = new FakeJobRepository();
  jobs.records["job-123"] = jobRecord({
    jobId: "job-123",
    status: "running",
    sourceArchiveUri: "gs://uploads/source.zip",
    documentUris: ["gs://uploads/spec.md"],
    resultsPrefix: "results/job-123",
  });
  const service = buildTestService({ jobs });

  await assert.rejects(() => service.getResults("job-123"), ApiError);
});

test("getResults returns signed artifact URLs", async () => {
  const jobs = new FakeJobRepository();
  jobs.records["job-123"] = jobRecord({
    jobId: "job-123",
    status: "succeeded",
    sourceArchiveUri: "gs://uploads/source.zip",
    documentUris: ["gs://uploads/spec.md"],
    resultsPrefix: "results/job-123",
    artifactPaths: {
      "true-design.md": "gs://uploads/results/job-123/true-design.md",
      "document-drift-report.md": "gs://uploads/results/job-123/document-drift-report.md",
    },
  });
  const storage = new FakeStorageService();
  const service = buildTestService({ jobs, storage });

  const response = await service.getResults("job-123");

  assert.equal(response.status, "succeeded");
  assert.equal(response.artifacts.length, 2);
  assert.equal(response.expiresIn, 600);
  assert.deepEqual(storage.signedUrlCalls[0], [
    "gs://uploads/results/job-123/document-drift-report.md",
    600,
  ]);
});

function buildTestService({
  uploads = new FakeUploadRepository(),
  jobs = new FakeJobRepository(),
  storage = new FakeStorageService(),
  tasks = new FakeTasks(),
}: {
  uploads?: UploadRepository;
  jobs?: JobRepository;
  storage?: StorageBoundary;
  tasks?: TaskEnqueuer;
} = {}): DriftApiService {
  return new DriftApiService({
    config: new ApiConfig({
      uploadsBucket: "uploads",
      tasksProjectId: "project",
      tasksLocation: "asia-northeast1",
      tasksQueue: "analysis",
      workerUrl: "https://worker.example",
      signedUrlExpirationSeconds: 600,
    }),
    storageService: storage,
    uploadRepository: uploads,
    jobRepository: jobs,
    taskEnqueuer: tasks,
  });
}

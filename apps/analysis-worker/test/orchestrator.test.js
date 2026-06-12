"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PlaceholderDocumentExtractionEngine,
  PlaceholderDriftReportGenerator,
  PlaceholderSourceCodeAnalysisEngine,
  PlaceholderTrueDesignGenerator,
} = require("../src/engines");
const { AnalysisOrchestrator } = require("../src/orchestrator");
const { AnalysisTaskPayload } = require("../src/payload");
const { InMemoryJobRepository, JobStatus } = require("../src/repositories");
const { InMemoryArtifactWriter, ReferenceOnlyInputLoader } = require("../src/storage");

class FailingInputLoader {
  async load() {
    throw new Error("storage unavailable");
  }
}

function buildPayload() {
  return AnalysisTaskPayload.fromMapping({
    jobId: "job-123",
    projectName: "Legacy SaaS",
    sourceArchiveUri: "gs://uploads/uploads/job-123/source.zip",
    documentUris: ["gs://uploads/uploads/job-123/docs/spec.pdf"],
    resultsPrefix: "results/job-123",
  });
}

function buildOrchestrator(repository, inputLoader, artifactWriter) {
  return new AnalysisOrchestrator({
    jobRepository: repository,
    inputLoader,
    artifactWriter,
    sourceCodeEngine: new PlaceholderSourceCodeAnalysisEngine(),
    documentEngine: new PlaceholderDocumentExtractionEngine(),
    trueDesignGenerator: new PlaceholderTrueDesignGenerator(),
    driftReportGenerator: new PlaceholderDriftReportGenerator(),
  });
}

test("run marks job succeeded and writes placeholder artifacts", async () => {
  const repository = new InMemoryJobRepository();
  const artifactWriter = new InMemoryArtifactWriter();
  const orchestrator = buildOrchestrator(repository, new ReferenceOnlyInputLoader(), artifactWriter);

  const result = await orchestrator.run(buildPayload());

  assert.equal(result.status, JobStatus.SUCCEEDED);
  assert.ok(result.artifactPaths["true-design.md"]);
  assert.ok(result.artifactPaths["document-drift-report.md"]);
  assert.equal((await repository.get("job-123")).status, JobStatus.SUCCEEDED);
  assert.match(artifactWriter.filesByJobId["job-123"]["true-design.md"], /placeholder artifact/);
});

test("run marks job failed when phase raises", async () => {
  const repository = new InMemoryJobRepository();
  const orchestrator = buildOrchestrator(repository, new FailingInputLoader(), new InMemoryArtifactWriter());

  await assert.rejects(() => orchestrator.run(buildPayload()), /storage unavailable/);

  const record = await repository.get("job-123");
  assert.equal(record.status, JobStatus.FAILED);
  assert.equal(record.errorMessage, "storage unavailable");
});

test("succeeded job is idempotent", async () => {
  const repository = new InMemoryJobRepository();
  const artifactWriter = new InMemoryArtifactWriter();
  const orchestrator = buildOrchestrator(repository, new ReferenceOnlyInputLoader(), artifactWriter);

  const first = await orchestrator.run(buildPayload());
  const second = await orchestrator.run(buildPayload());

  assert.equal(second.status, JobStatus.SUCCEEDED);
  assert.deepEqual(second.artifactPaths, first.artifactPaths);
  assert.equal(second.message, "job_already_succeeded");
});

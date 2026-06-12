"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { AnalysisTaskPayload, PayloadValidationError, StorageObjectRef } = require("../src/payload");

test("StorageObjectRef parses gs URI", () => {
  const ref = StorageObjectRef.fromValue("gs://bucket/path/to/file.zip", "source");

  assert.equal(ref.bucket, "bucket");
  assert.equal(ref.objectName, "path/to/file.zip");
  assert.equal(ref.uri, "gs://bucket/path/to/file.zip");
});

test("StorageObjectRef parses object reference", () => {
  const ref = StorageObjectRef.fromValue({ bucket: "bucket", objectName: "path/to/file.zip" }, "source");

  assert.equal(ref.uri, "gs://bucket/path/to/file.zip");
});

test("StorageObjectRef rejects non-GCS URI", () => {
  assert.throws(
    () => StorageObjectRef.fromValue("https://example.com/source.zip", "source"),
    PayloadValidationError,
  );
});

test("AnalysisTaskPayload accepts camelCase payload", () => {
  const payload = AnalysisTaskPayload.fromMapping({
    jobId: "job-123",
    projectName: "Legacy SaaS",
    sourceArchiveUri: "gs://uploads/uploads/job-123/source.zip",
    documentUris: ["gs://uploads/uploads/job-123/docs/spec.pdf"],
    resultsPrefix: "results/job-123",
  });

  assert.equal(payload.jobId, "job-123");
  assert.equal(payload.projectName, "Legacy SaaS");
  assert.equal(payload.sourceArchive.uri, "gs://uploads/uploads/job-123/source.zip");
  assert.equal(payload.documents[0].uri, "gs://uploads/uploads/job-123/docs/spec.pdf");
  assert.equal(payload.resultsPrefix, "results/job-123");
});

test("AnalysisTaskPayload accepts snake_case payload", () => {
  const payload = AnalysisTaskPayload.fromMapping({
    job_id: "job-123",
    project_name: "Legacy SaaS",
    source_archive: { bucket: "uploads", object: "source.zip" },
    documents: [{ bucket: "uploads", object: "docs/spec.xlsx" }],
    results_prefix: "results/job-123",
  });

  assert.equal(payload.jobId, "job-123");
  assert.equal(payload.documents[0].uri, "gs://uploads/docs/spec.xlsx");
});

test("AnalysisTaskPayload rejects missing documents", () => {
  assert.throws(
    () =>
      AnalysisTaskPayload.fromMapping({
        jobId: "job-123",
        sourceArchiveUri: "gs://uploads/source.zip",
      }),
    /documents/,
  );
});

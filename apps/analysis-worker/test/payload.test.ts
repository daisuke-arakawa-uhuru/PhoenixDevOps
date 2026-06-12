import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisTaskPayload, PayloadValidationError, StorageObjectRef } from "../src/payload.js";

test("StorageObjectRef.fromUri parses valid gs:// URI", () => {
  const ref = StorageObjectRef.fromUri("gs://my-bucket/path/to/object", "test");
  assert.strictEqual(ref.bucket, "my-bucket");
  assert.strictEqual(ref.objectName, "path/to/object");
  assert.strictEqual(ref.uri, "gs://my-bucket/path/to/object");
});

test("StorageObjectRef.fromValue handles object reference", () => {
  const ref = StorageObjectRef.fromValue({ bucket: "b", object: "o" }, "test");
  assert.strictEqual(ref.bucket, "b");
  assert.strictEqual(ref.objectName, "o");
});

test("AnalysisTaskPayload.fromMapping accepts snake_case and camelCase", () => {
  const raw = {
    job_id: "job-1",
    sourceArchiveUri: "gs://b/s.zip",
    document_uris: ["gs://b/d.pdf"],
    projectName: "Proj",
  };
  const payload = AnalysisTaskPayload.fromMapping(raw);
  assert.strictEqual(payload.jobId, "job-1");
  assert.strictEqual(payload.sourceArchive.uri, "gs://b/s.zip");
  assert.strictEqual(payload.documents.length, 1);
  assert.strictEqual(payload.projectName, "Proj");
});

test("AnalysisTaskPayload.fromMapping throws on missing fields", () => {
  assert.throws(() => AnalysisTaskPayload.fromMapping({}), {
    name: "PayloadValidationError",
    message: /job_id.*required/,
  });
});

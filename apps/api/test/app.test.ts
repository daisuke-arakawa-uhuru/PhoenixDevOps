import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app";
import { DriftApiService } from "../src/service";
import { UploadedFile } from "../src/storage";

test("POST /jobs returns created job response", async () => {
  const service = {
    async createJob(body: Record<string, unknown>) {
      assert.deepEqual(body, { uploadId: "upload-123" });
      return { jobId: "job-123", status: "queued" };
    },
  } as unknown as DriftApiService;
  const app = createApp({ serviceFactory: () => service });

  const response = await app.request("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId: "upload-123" }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { jobId: "job-123", status: "queued" });
});

test("POST /upload accepts multipart form data", async () => {
  const service = {
    async createUpload(sourceFile: UploadedFile | null, documentFiles: readonly UploadedFile[], projectName: string | null) {
      assert.equal(sourceFile?.name, "source.zip");
      assert.equal(documentFiles.length, 1);
      assert.equal(documentFiles[0].name, "spec.md");
      assert.equal(projectName, "Legacy SaaS");
      return {
        uploadId: "upload-123",
        sourceArchiveUri: "gs://uploads/source.zip",
        documentUris: ["gs://uploads/spec.md"],
        projectName,
      };
    },
  } as unknown as DriftApiService;
  const formData = new FormData();
  formData.set("sourceArchive", new Blob(["zip"], { type: "application/zip" }), "source.zip");
  formData.append("documents", new Blob(["# Spec\n"], { type: "text/markdown" }), "spec.md");
  formData.set("projectName", "Legacy SaaS");
  const app = createApp({ serviceFactory: () => service });

  const response = await app.request("/upload", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json() as { uploadId: string }).uploadId, "upload-123");
});

test("wrong method returns method_not_allowed", async () => {
  const app = createApp({ serviceFactory: () => ({}) as DriftApiService });

  const response = await app.request("/jobs", { method: "GET" });

  assert.equal(response.status, 405);
  assert.equal((await response.json() as { error: string }).error, "method_not_allowed");
});

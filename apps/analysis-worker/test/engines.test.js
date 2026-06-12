"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { GeminiDocumentExtractionEngine, GeminiSourceCodeAnalysisEngine } = require("../src/engines");
const { AnalysisTaskPayload } = require("../src/payload");

class RecordingGeminiClient {
  constructor(response = "gemini response") {
    this.response = response;
    this.prompts = [];
  }

  async generate(prompt) {
    this.prompts.push(prompt);
    return this.response;
  }
}

function buildPayload() {
  return AnalysisTaskPayload.fromMapping({
    jobId: "job-123",
    projectName: "Legacy SaaS",
    sourceArchiveUri: "gs://uploads/source.zip",
    documentUris: ["gs://uploads/spec.md"],
  });
}

test("GeminiSourceCodeAnalysisEngine adds static source overview to prompt and summary", async () => {
  const client = new RecordingGeminiClient();
  const inputs = {
    sourceArchiveUri: "gs://uploads/source.zip",
    documentUris: ["gs://uploads/spec.md"],
    sourceFiles: [
      { path: "package.json", content: '{"dependencies":{"fastapi":"^0.1.0"}}' },
      {
        path: "app.py",
        content: '@app.get("/health")\ndef health():\n    return {"ok": True}\n',
      },
      { path: "schema.sql", content: "CREATE TABLE users (id integer primary key);" },
      {
        path: "tests/test_routes.py",
        content: '@app.get("/test-only")\nCREATE TABLE fake (id integer);',
      },
      { path: "README.md", content: "# Service\n" },
    ],
    documentFiles: [],
  };

  const specification = await new GeminiSourceCodeAnalysisEngine(client).extract(buildPayload(), inputs);

  assert.match(client.prompts[0], /## 事前抽出済みの構造情報/);
  assert.match(specification.summary, /fastapi/);
  assert.match(specification.summary, /\/health/);
  assert.doesNotMatch(specification.summary, /\/test-only/);
  assert.match(specification.summary, /users/);
  assert.equal(specification.extractedItems.static_overview.api_routes[0].path, "/health");
});

test("GeminiDocumentExtractionEngine adds document overview to prompt and summary", async () => {
  const client = new RecordingGeminiClient();
  const inputs = {
    sourceArchiveUri: "gs://uploads/source.zip",
    documentUris: ["gs://uploads/spec.md"],
    sourceFiles: [],
    documentFiles: [{ path: "spec.md", content: "# Spec\n" }],
  };

  const specification = await new GeminiDocumentExtractionEngine(client).extract(buildPayload(), inputs);

  assert.match(client.prompts[0], /## 事前抽出済みのドキュメント情報/);
  assert.match(specification.summary, /読み込み済み本文ファイル数: 1/);
  assert.deepEqual(specification.extractedItems.document_overview.document_file_paths, ["spec.md"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkerConfig } from "../src/config.js";

test("WorkerConfig defaults Vertex AI location to global", () => {
  const config = WorkerConfig.fromEnv({
    GOOGLE_CLOUD_PROJECT: "test-project",
  });

  assert.equal(config.geminiUseVertexAi, true);
  assert.equal(config.geminiProject, "test-project");
  assert.equal(config.geminiLocation, "global");
});

test("WorkerConfig leaves Gemini location unset when Vertex AI is disabled", () => {
  const config = WorkerConfig.fromEnv({
    GEMINI_USE_VERTEX_AI: "false",
  });

  assert.equal(config.geminiUseVertexAi, false);
  assert.equal(config.geminiLocation, null);
});

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DryRunGeminiClient, GeminiSettings, buildGeminiClient } = require("../src/gemini");

test("buildGeminiClient builds dry-run client without API key", () => {
  const client = buildGeminiClient(new GeminiSettings({ apiKey: null, model: "gemini-test", dryRun: false }));

  assert.ok(client instanceof DryRunGeminiClient);
});

test("DryRunGeminiClient returns task specific response", async () => {
  const client = new DryRunGeminiClient();

  const response = await client.generate("[TASK: TRUE_DESIGN]\nbody");

  assert.match(response, /真の設計書/);
  assert.match(response, /dry-run/);
});

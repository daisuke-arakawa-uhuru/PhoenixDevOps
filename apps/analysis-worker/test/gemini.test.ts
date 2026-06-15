import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGeminiClient,
  DryRunGeminiClient,
  GeminiSettings,
  GoogleGenAIClient,
} from "../src/gemini.js";

test("buildGeminiClient uses dry-run client only when explicitly enabled", () => {
  const client = buildGeminiClient(new GeminiSettings({ dryRun: true }));

  assert.ok(client instanceof DryRunGeminiClient);
});

test("buildGeminiClient requires GEMINI_API_KEY when dry-run is disabled", () => {
  assert.throws(() => buildGeminiClient(new GeminiSettings({ dryRun: false })), {
    message: "GEMINI_API_KEY is required when dry-run is disabled",
  });
});

test("buildGeminiClient uses Google GenAI client when API key is configured", () => {
  const client = buildGeminiClient(new GeminiSettings({ apiKey: "test-key", dryRun: false }));

  assert.ok(client instanceof GoogleGenAIClient);
});

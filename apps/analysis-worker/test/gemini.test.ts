import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGeminiClient,
  DryRunGeminiClient,
  GeminiApiError,
  GeminiSettings,
  GoogleGenAIClient,
  normalizeGeminiError,
} from "../src/gemini.js";

test("buildGeminiClient uses dry-run client only when explicitly enabled", () => {
  const client = buildGeminiClient(new GeminiSettings({ dryRun: true }));

  assert.ok(client instanceof DryRunGeminiClient);
});

test("buildGeminiClient uses Vertex AI client when apiKey is absent and dryRun is false (ADC fallback)", () => {
  const client = buildGeminiClient(new GeminiSettings({ apiKey: null, dryRun: false }));

  assert.ok(client instanceof GoogleGenAIClient);
});

test("GeminiSettings defaults useVertexAi to true", () => {
  const settings = new GeminiSettings();
  assert.strictEqual(settings.useVertexAi, true);
});

test("buildGeminiClient requires GEMINI_API_KEY when dry-run is disabled and Vertex AI is disabled", () => {
  assert.throws(() => buildGeminiClient(new GeminiSettings({ dryRun: false, useVertexAi: false })), {
    message: "GEMINI_API_KEY is required when dry-run is disabled",
  });
});

test("buildGeminiClient uses Google GenAI client when API key is configured", () => {
  const client = buildGeminiClient(new GeminiSettings({ apiKey: "test-key", dryRun: false, useVertexAi: false }));

  assert.ok(client instanceof GoogleGenAIClient);
});

test("normalizeGeminiError summarizes zero-quota RESOURCE_EXHAUSTED errors", () => {
  const error = new Error(
    JSON.stringify({
      error: {
        code: 429,
        message:
          "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-lite",
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              {
                quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
              },
            ],
          },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "5s",
          },
        ],
      },
    }),
  );

  const normalized = normalizeGeminiError(error, "gemini-3.1-flash-lite");

  assert.ok(normalized instanceof GeminiApiError);
  assert.strictEqual(normalized.statusCode, 429);
  assert.strictEqual(normalized.apiStatus, "RESOURCE_EXHAUSTED");
  assert.strictEqual(normalized.retryable, false);
  assert.strictEqual(normalized.retryDelayMs, 5000);
  assert.match(normalized.message, /no usable free-tier quota/);
  assert.match(normalized.message, /GenerateRequestsPerDayPerProjectPerModel-FreeTier/);
});

test("normalizeGeminiError marks retryable quota errors without zero-limit hint", () => {
  const error = new Error(
    JSON.stringify({
      error: {
        code: 429,
        message: "Please retry in 5s.",
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "5s",
          },
        ],
      },
    }),
  );

  const normalized = normalizeGeminiError(error, "gemini-3.1-flash-lite");

  assert.strictEqual(normalized.retryable, true);
  assert.strictEqual(normalized.retryDelayMs, 5000);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "../src/local-env.js";

test("loadEnvFile reads dotenv values without overriding existing environment variables", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-worker-env-"));
  const envPath = path.join(tempDir, ".env");
  fs.writeFileSync(
    envPath,
    [
      "# local settings",
      "GEMINI_USE_VERTEX_AI=true",
      "GOOGLE_CLOUD_PROJECT=phoenixdevops",
      "GOOGLE_CLOUD_LOCATION=global",
      "EXISTING=value-from-file",
      "QUOTED=\"line\\nvalue\"",
      "SINGLE='single quoted'",
      "INLINE=value # comment",
      "",
    ].join("\n"),
  );

  const env: NodeJS.ProcessEnv = {
    EXISTING: "value-from-shell",
  };

  assert.equal(loadEnvFile(envPath, env), true);
  assert.equal(env.GEMINI_USE_VERTEX_AI, "true");
  assert.equal(env.GOOGLE_CLOUD_PROJECT, "phoenixdevops");
  assert.equal(env.GOOGLE_CLOUD_LOCATION, "global");
  assert.equal(env.EXISTING, "value-from-shell");
  assert.equal(env.QUOTED, "line\nvalue");
  assert.equal(env.SINGLE, "single quoted");
  assert.equal(env.INLINE, "value");
});

test("loadEnvFile ignores missing files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-worker-env-"));
  const env: NodeJS.ProcessEnv = {};

  assert.equal(loadEnvFile(path.join(tempDir, ".env"), env), false);
  assert.deepEqual(env, {});
});

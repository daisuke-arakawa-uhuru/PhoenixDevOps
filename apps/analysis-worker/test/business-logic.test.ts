import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterBusinessLogicFiles,
  buildBusinessLogicOverview,
  buildBusinessLogicSpecPrompt,
  GeminiBusinessLogicAgent,
  PlaceholderBusinessLogicAgent
} from "../src/business-logic.js";
import { AnalysisTaskPayload, StorageObjectRef } from "../src/payload.js";
import { GeminiClient } from "../src/gemini.js";

const payload = () => new AnalysisTaskPayload({
  jobId: "job-bl-1",
  sourceArchive: new StorageObjectRef("bucket", "source.zip"),
  documents: [new StorageObjectRef("bucket", "doc.pdf")],
  resultsPrefix: "results/job-bl-1"
});

const inputs = (sourceFiles: Array<{ path: string; content: string }>) => ({
  sourceArchiveUri: "gs://bucket/source.zip",
  sourceFiles,
  documentUris: ["gs://bucket/doc.pdf"],
  documentFiles: [],
  allSourceFiles: sourceFiles
});

test("filterBusinessLogicFiles correctly includes code and excludes test/IaC", () => {
  const files = [
    { path: "src/services/UserService.ts", content: "export class UserService {}" },
    { path: "src/services/UserService.test.ts", content: "describe('UserService')" },
    { path: "src/app.js", content: "const express = require('express');" },
    { path: "infra/main.tf", content: "resource \"google_compute_instance\" \"default\" {}" },
    { path: "docker-compose.yml", content: "services:\n  api:" },
    { path: "package.json", content: "{\"name\": \"test\"}" },
    { path: "README.md", content: "# Main project" },
    { path: "src/domain/order.py", content: "class Order:\n    pass" }
  ];

  const filtered = filterBusinessLogicFiles(files);
  const paths = filtered.map((f) => f.path);

  assert.ok(paths.includes("src/services/UserService.ts"));
  assert.ok(paths.includes("src/app.js"));
  assert.ok(paths.includes("src/domain/order.py"));
  assert.strictEqual(paths.includes("src/services/UserService.test.ts"), false);
  assert.strictEqual(paths.includes("infra/main.tf"), false);
  assert.strictEqual(paths.includes("docker-compose.yml"), false);
  assert.strictEqual(paths.includes("package.json"), false);
  assert.strictEqual(paths.includes("README.md"), false);
});

test("buildBusinessLogicOverview extracts JS/TS, Python, Go symbols correctly", () => {
  const files = [
    {
      path: "src/services/UserService.ts",
      content: `
        export class UserService {
          constructor() {}
        }
        export function registerUser() {}
        export const DEFAULT_ROLE = 'user';
      `
    },
    {
      path: "src/domain/order.py",
      content: `
class Order:
    def __init__(self):
        pass
    def calculate_total(self):
        return 0
      `
    },
    {
      path: "src/core/utils.go",
      content: `
package core
func ProcessPayment(amount int) {
}
type Payment struct {
	ID string
}
      `
    }
  ];

  const overview = buildBusinessLogicOverview(files);

  assert.strictEqual(overview.totalFiles, 3);
  
  const symbols = overview.symbols;
  
  // TypeScript checks
  const tsSymbols = symbols.filter((s) => s.source.startsWith("src/services/UserService.ts:"));
  assert.ok(tsSymbols.some((s) => s.kind === "class" && s.name === "UserService"));
  assert.ok(tsSymbols.some((s) => s.kind === "function" && s.name === "registerUser"));
  assert.ok(tsSymbols.some((s) => s.kind === "const" && s.name === "DEFAULT_ROLE"));

  // Python checks
  const pySymbols = symbols.filter((s) => s.source.startsWith("src/domain/order.py:"));
  assert.ok(pySymbols.some((s) => s.kind === "class" && s.name === "Order"));
  assert.ok(pySymbols.some((s) => s.kind === "method" && s.name === "calculate_total"));

  // Go checks
  const goSymbols = symbols.filter((s) => s.source.startsWith("src/core/utils.go:"));
  assert.ok(goSymbols.some((s) => s.kind === "function" && s.name === "ProcessPayment"));
  assert.ok(goSymbols.some((s) => s.kind === "type" && s.name === "Payment"));
});

test("buildBusinessLogicSpecPrompt contains required task title and overview data", () => {
  const files = [{ path: "src/app.js", content: "console.log('hello');" }];
  const overviewMarkdown = "## Mock Overview";
  const prompt = buildBusinessLogicSpecPrompt(payload(), overviewMarkdown, files);

  assert.match(prompt, /\[TASK: BUSINESS_LOGIC_SPEC\]/);
  assert.match(prompt, /## 事前抽出済みのビジネスロジック構造情報/);
  assert.match(prompt, /## ビジネスロジック入力ファイル本文/);
  assert.match(prompt, /Mock Overview/);
  assert.match(prompt, /src\/app\.js/);
});

test("GeminiBusinessLogicAgent executes the Gemini client with prompt and appends overview", async () => {
  const captured: string[] = [];
  const stubClient: GeminiClient = {
    async generate(prompt: string): Promise<string> {
      captured.push(prompt);
      return "## 主要機能・ユースケース一覧\n\n- ユーザー登録機能です。";
    }
  };

  const agent = new GeminiBusinessLogicAgent(stubClient);
  const spec = await agent.analyze(
    payload(),
    inputs([
      { path: "src/services/UserService.ts", content: "export class UserService {}" },
      { path: "infra/main.tf", content: "resource \"google_compute_instance\" \"default\" {}" }
    ])
  );

  assert.strictEqual(captured.length, 1);
  assert.match(captured[0], /\[TASK: BUSINESS_LOGIC_SPEC\]/);
  // IaC files should not be included in the prompt
  assert.doesNotMatch(captured[0], /infra\/main\.tf/);
  assert.match(spec, /# ビジネスロジック・ユースケース仕様書/);
  assert.match(spec, /ジョブID: job-bl-1/);
  assert.match(spec, /## Gemini抽出結果/);
  assert.match(spec, /ユーザー登録機能です。/);
});

test("PlaceholderBusinessLogicAgent falls back if no business files are present", async () => {
  const captured: string[] = [];
  const stubClient: GeminiClient = {
    async generate(prompt: string): Promise<string> {
      captured.push(prompt);
      return "Should not be called";
    }
  };

  const agent = new GeminiBusinessLogicAgent(stubClient);
  const spec = await agent.analyze(
    payload(),
    inputs([]) // No files
  );

  assert.strictEqual(captured.length, 0); // No call to Gemini
  assert.match(spec, /ビジネスロジック入力ファイルが検出されなかったか/);
});

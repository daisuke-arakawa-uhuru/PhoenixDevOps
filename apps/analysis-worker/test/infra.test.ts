import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GeminiInfrastructureAgent,
  buildIacOverview,
  buildInfrastructureSpecPrompt,
  filterIacFiles,
  renderIacOverviewMarkdown,
} from "../src/infra.js";
import { AnalysisTaskPayload, StorageObjectRef } from "../src/payload.js";
import { GeminiClient } from "../src/gemini.js";
import { AnalysisInput } from "../src/prompts.js";
import { LocalFileInputLoader } from "../src/storage.js";

const TERRAFORM_SAMPLE = `
terraform {
  backend "gcs" {
    bucket = "tf-state"
  }
}

provider "google" {
  project = var.project_id
}

variable "project_id" {
  type = string
}

resource "google_compute_network" "main" {
  name = "main-vpc"
}

resource "google_compute_firewall" "allow_http" {
  name    = "allow-http"
  network = google_compute_network.main.name
}

resource "google_project_iam_member" "worker" {
  role   = "roles/run.invoker"
}

module "tasks" {
  source = "../modules/tasks"
}

output "vpc_name" {
  value = google_compute_network.main.name
}
`;

const COMPOSE_SAMPLE = `
services:
  api:
    image: node:24
    ports:
      - "8080:8080"
  db:
    image: postgres:16
`;

const K8S_SAMPLE = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: prod
---
apiVersion: v1
kind: Service
metadata:
  name: web-svc
`;

function payload(): AnalysisTaskPayload {
  return new AnalysisTaskPayload({
    jobId: "job-infra-1",
    projectName: "legacy-system",
    sourceArchive: new StorageObjectRef("local", "src.zip"),
    documents: [],
  });
}

function inputs(
  files: Array<{ path: string; content: string }>,
  infrastructureFiles?: Array<{ path: string; content: string }>,
): AnalysisInput {
  return {
    sourceArchiveUri: "local://src.zip",
    sourceFiles: files,
    infrastructureFiles,
    documentUris: [],
    documentFiles: [],
  };
}

test("filterIacFiles keeps infrastructure-specific inputs only", () => {
  const files = [
    { path: "infra/main.tf", content: TERRAFORM_SAMPLE },
    { path: "docker-compose.yml", content: COMPOSE_SAMPLE },
    { path: "k8s/deploy.yaml", content: K8S_SAMPLE },
    { path: "Dockerfile", content: "FROM node:24\nEXPOSE 8080\n" },
    { path: "cdk/lib/app-stack.ts", content: "import { Stack } from 'aws-cdk-lib';" },
    {
      path: "cloudformation/template.yaml",
      content: "AWSTemplateFormatVersion: '2010-09-09'\nResources:\n  Bucket:\n    Type: AWS::S3::Bucket\n",
    },
    { path: "codebase-map.json", content: "{}" },
    { path: "exported-symbols-infra.md", content: "# Terraform symbols" },
    { path: "src/app.ts", content: "export const x = 1;" },
    { path: "config/values.yaml", content: "replicas: 3\nname: web" },
  ];

  const iac = filterIacFiles(files).map((file) => file.path);

  assert.deepStrictEqual(iac, [
    "infra/main.tf",
    "docker-compose.yml",
    "k8s/deploy.yaml",
    "Dockerfile",
    "cdk/lib/app-stack.ts",
    "cloudformation/template.yaml",
    "codebase-map.json",
    "exported-symbols-infra.md",
  ]);
});

test("buildIacOverview extracts terraform blocks and flags security resources", () => {
  const overview = buildIacOverview([{ path: "infra/main.tf", content: TERRAFORM_SAMPLE }]);

  assert.strictEqual(overview.terraformFiles.length, 1);
  assert.strictEqual(overview.providers.length, 1);
  assert.strictEqual(overview.modules.length, 1);
  assert.strictEqual(overview.variables.length, 1);
  assert.strictEqual(overview.outputs.length, 1);
  assert.deepStrictEqual(overview.backends.map((block) => block.name), ["gcs"]);

  const resourceTypes = overview.resources.map((block) => block.type).sort();
  assert.deepStrictEqual(resourceTypes, [
    "google_compute_firewall",
    "google_compute_network",
    "google_project_iam_member",
  ]);

  const categories = overview.securityFindings.map((finding) => finding.category);
  assert.ok(categories.includes("ネットワーク境界（SG/Firewall）"));
  assert.ok(categories.includes("IAM・権限設定"));
});

test("buildIacOverview parses compose services and k8s manifests", () => {
  const overview = buildIacOverview([
    { path: "docker-compose.yml", content: COMPOSE_SAMPLE },
    { path: "k8s/deploy.yaml", content: K8S_SAMPLE },
    { path: "Dockerfile", content: "FROM node:24\nEXPOSE 3000/tcp 8080\n" },
    { path: "cdk/lib/app-stack.ts", content: "import * as cdk from 'aws-cdk-lib';" },
    { path: "codebase-map.json", content: "{}" },
  ]);

  assert.deepStrictEqual(
    overview.composeServices.map((service) => `${service.name}:${service.image}`),
    ["api:node:24", "db:postgres:16"],
  );
  assert.deepStrictEqual(overview.composeServices[0].ports, ["8080:8080"]);

  assert.deepStrictEqual(
    overview.k8sManifests.map((manifest) => `${manifest.kind}/${manifest.name}`),
    ["Deployment/web", "Service/web-svc"],
  );
  assert.strictEqual(overview.k8sManifests[0].namespace, "prod");
  assert.deepStrictEqual(overview.dockerfiles, ["Dockerfile"]);
  assert.deepStrictEqual(overview.cdkFiles, ["cdk/lib/app-stack.ts"]);
  assert.deepStrictEqual(overview.f01ArtifactFiles, ["codebase-map.json"]);
  assert.ok(overview.securityFindings.some((finding) => finding.detail.includes("EXPOSE 3000/tcp")));
});

test("renderIacOverviewMarkdown reports when no IaC is present", () => {
  const markdown = renderIacOverviewMarkdown(buildIacOverview([]));

  assert.match(markdown, /IaC として解析可能なファイル/);
});

test("buildInfrastructureSpecPrompt embeds task marker and overview", () => {
  const files = [{ path: "infra/main.tf", content: TERRAFORM_SAMPLE }];
  const overview = renderIacOverviewMarkdown(buildIacOverview(files));
  const prompt = buildInfrastructureSpecPrompt(payload(), overview, files);

  assert.match(prompt, /\[TASK: INFRASTRUCTURE_SPEC\]/);
  assert.match(prompt, /## 事前抽出済みのIaC構造情報/);
  assert.match(prompt, /## IaC入力ファイル抜粋/);
  assert.match(prompt, /google_compute_firewall/);
});

test("GeminiInfrastructureAgent composes the spec from overview and Gemini output", async () => {
  const captured: string[] = [];
  const stubClient: GeminiClient = {
    async generate(prompt: string): Promise<string> {
      captured.push(prompt);
      return "## システム構成概要\n\nGCP 上の VPC とファイアウォール構成です。";
    },
  };
  const agent = new GeminiInfrastructureAgent(stubClient);

  const spec = await agent.analyze(
    payload(),
    inputs([
      { path: "infra/main.tf", content: TERRAFORM_SAMPLE },
      { path: "src/app.ts", content: "export const x = 1;" },
    ]),
  );

  assert.strictEqual(captured.length, 1);
  assert.match(captured[0], /\[TASK: INFRASTRUCTURE_SPEC\]/);
  // 非 IaC ファイルは prompt に含めない。
  assert.doesNotMatch(captured[0], /app\.ts/);
  assert.match(spec, /# インフラ物理\/論理構成仕様/);
  assert.match(spec, /ジョブID: job-infra-1/);
  assert.match(spec, /## Gemini抽出結果/);
  assert.match(spec, /GCP 上の VPC とファイアウォール構成です。/);
});

test("GeminiInfrastructureAgent uses dedicated infrastructureFiles when present", async () => {
  const captured: string[] = [];
  const stubClient: GeminiClient = {
    async generate(prompt: string): Promise<string> {
      captured.push(prompt);
      return "## システム構成概要\n\n専用 IaC 入力から生成しました。";
    },
  };
  const agent = new GeminiInfrastructureAgent(stubClient);

  const spec = await agent.analyze(
    payload(),
    inputs(
      [{ path: "src/app.ts", content: "export const x = 1;" }],
      [{ path: "infra/main.tf", content: TERRAFORM_SAMPLE }],
    ),
  );

  assert.strictEqual(captured.length, 1);
  assert.match(captured[0], /infra\/main\.tf/);
  assert.doesNotMatch(captured[0], /src\/app\.ts/);
  assert.match(spec, /専用 IaC 入力から生成しました。/);
});

test("GeminiInfrastructureAgent returns fallback without Gemini when no IaC is present", async () => {
  const stubClient: GeminiClient = {
    async generate(): Promise<string> {
      throw new Error("Gemini should not be called without IaC input");
    },
  };
  const agent = new GeminiInfrastructureAgent(stubClient);

  const spec = await agent.analyze(payload(), inputs([{ path: "src/app.ts", content: "export const x = 1;" }]));

  assert.match(spec, /解析対象に IaC コードが含まれていなかった/);
  assert.doesNotMatch(spec, /Gemini抽出結果/);
});

test("LocalFileInputLoader keeps infrastructure files outside the general source limit", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-infra-loader-"));
  try {
    fs.mkdirSync(path.join(tempRoot, "zz-infra"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "00-app.ts"), "export const x = 1;\n", "utf8");
    fs.writeFileSync(path.join(tempRoot, "zz-infra", "main.tf"), TERRAFORM_SAMPLE, "utf8");

    const loader = new LocalFileInputLoader(tempRoot, [], { maxFiles: 1, maxInfrastructureFiles: 10 });
    const loaded = await loader.load();

    assert.deepStrictEqual(loaded.sourceFiles.map((file) => file.path), ["00-app.ts"]);
    assert.deepStrictEqual(loaded.infrastructureFiles.map((file) => file.path), ["zz-infra/main.tf"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

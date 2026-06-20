import { test } from "node:test";
import assert from "node:assert/strict";
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

function inputs(files: Array<{ path: string; content: string }>): AnalysisInput {
  return {
    sourceArchiveUri: "local://src.zip",
    sourceFiles: files,
    documentUris: [],
    documentFiles: [],
  };
}

test("filterIacFiles keeps Terraform, compose, and k8s manifests only", () => {
  const files = [
    { path: "infra/main.tf", content: TERRAFORM_SAMPLE },
    { path: "docker-compose.yml", content: COMPOSE_SAMPLE },
    { path: "k8s/deploy.yaml", content: K8S_SAMPLE },
    { path: "src/app.ts", content: "export const x = 1;" },
    { path: "config/values.yaml", content: "replicas: 3\nname: web" },
  ];

  const iac = filterIacFiles(files).map((file) => file.path);

  assert.deepStrictEqual(iac, ["infra/main.tf", "docker-compose.yml", "k8s/deploy.yaml"]);
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

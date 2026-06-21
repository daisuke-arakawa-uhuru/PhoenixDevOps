import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCodebaseMap,
  codebaseMapArtifacts,
  renderIacStructureMarkdown,
  renderModuleDependenciesMermaid,
} from "../src/code-map.js";

test("buildCodebaseMap extracts manifests, module edges, API routes, DB definitions, and Terraform blocks", () => {
  const codebaseMap = buildCodebaseMap([
    {
      path: "package.json",
      content: JSON.stringify({
        dependencies: { express: "^5.0.0" },
        devDependencies: { typescript: "^6.0.0" },
      }),
    },
    {
      path: "requirements.txt",
      content: "flask==3.0.0\n",
    },
    {
      path: "go.mod",
      content: "module example.com/app\n\nrequire github.com/gin-gonic/gin v1.9.1\n",
    },
    {
      path: "src/index.ts",
      content: [
        'import express from "express";',
        'import { helper } from "./util";',
        'const config = require("./config");',
        'app.get("/health", handler);',
      ].join("\n"),
    },
    {
      path: "src/util.ts",
      content: "export const helper = () => true;\n",
    },
    {
      path: "src/config.ts",
      content: "export const config = {};\n",
    },
    {
      path: "app/models.py",
      content: "from django.db import models\n\nclass Customer(models.Model):\n    pass\n",
    },
    {
      path: "app/service.py",
      content: "import app.models\n",
    },
    {
      path: "infra/main.tf",
      content: [
        "terraform {",
        "  required_providers {",
        "    google = {",
        '      source  = "hashicorp/google"',
        '      version = "~> 6.0"',
        "    }",
        "  }",
        "}",
        "",
        'provider "google" {',
        "  project = var.project_id",
        "}",
        "",
        'module "api" {',
        '  source = "../../modules/api"',
        "}",
        "",
        'resource "google_storage_bucket" "uploads" {',
        "  name = var.bucket_name",
        "}",
      ].join("\n"),
    },
  ]);

  assert.equal(codebaseMap.summary.fileCount, 9);
  assert.ok(codebaseMap.fileTree.includes("|-- app"));
  assert.ok(codebaseMap.dependencies.some((item) => item.name === "express"));
  assert.ok(codebaseMap.dependencies.some((item) => item.name === "flask"));
  assert.ok(codebaseMap.dependencies.some((item) => item.name === "github.com/gin-gonic/gin"));
  assert.ok(
    codebaseMap.moduleDependencies.some(
      (item) => item.source === "src/index.ts" && item.target === "src/util.ts",
    ),
  );
  assert.ok(
    codebaseMap.moduleDependencies.some(
      (item) => item.source === "src/index.ts" && item.target === "pkg:express",
    ),
  );
  assert.ok(codebaseMap.apiRoutes.some((item) => item.method === "GET" && item.path === "/health"));
  assert.ok(codebaseMap.databaseDefinitions.some((item) => item.name === "Customer"));
  assert.ok(codebaseMap.iac.providers.some((item) => item.name === "google"));
  assert.ok(codebaseMap.iac.modules.some((item) => item.name === "api"));
  assert.ok(codebaseMap.iac.resources.some((item) => item.type === "google_storage_bucket"));
});

test("renderers produce backend artifacts for downstream agents", () => {
  const rawFiles = [
    {
      path: "src/index.ts",
      content: 'import { helper } from "./helper";\nhelper();\n',
    },
    {
      path: "src/helper.ts",
      content: "export function helper() {}\n",
    },
    {
      path: "infra/main.tf",
      content: 'module "storage" {\n  source = "../modules/storage"\n}\n',
    },
  ];
  const codebaseMap = buildCodebaseMap(rawFiles);

  const artifacts = codebaseMapArtifacts(codebaseMap, rawFiles);

  assert.deepEqual(Object.keys(artifacts).sort(), [
    "codebase-map.json",
    "codebase-map.md",
    "exported-symbols-ungrouped.md",
    "iac-structure.md",
    "module-dependencies.mmd",
  ]);
  assert.match(renderModuleDependenciesMermaid(codebaseMap), /flowchart LR/);
  assert.match(renderModuleDependenciesMermaid(codebaseMap), /src\/index\.ts/);
  assert.match(renderIacStructureMarkdown(codebaseMap), /storage/);
  assert.match(artifacts["codebase-map.json"], /"moduleDependencies"/);
});

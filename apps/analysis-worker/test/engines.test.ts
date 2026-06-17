import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDirectoryTree,
  buildModuleDependencyGraph,
  buildIaCStructureMap,
} from "../src/engines.js";

// ─────────────────────────────────────────────────────────────────────────────
// buildDirectoryTree
// ─────────────────────────────────────────────────────────────────────────────

describe("buildDirectoryTree", () => {
  it("空リストで空文字を返す", () => {
    assert.strictEqual(buildDirectoryTree([]), "");
  });

  it("単一ファイル（ルート）を正しく表示する", () => {
    const result = buildDirectoryTree(["README.md"]);
    assert.ok(result.includes("README.md"), `expected README.md in:\n${result}`);
  });

  it("ネストしたパスからツリーを生成する", () => {
    const result = buildDirectoryTree([
      "src/index.ts",
      "src/engines.ts",
      "README.md",
    ]);
    assert.ok(result.includes("src/"), `expected src/ dir in:\n${result}`);
    assert.ok(result.includes("index.ts"), `expected index.ts in:\n${result}`);
    assert.ok(result.includes("engines.ts"), `expected engines.ts in:\n${result}`);
    assert.ok(result.includes("README.md"), `expected README.md in:\n${result}`);
  });

  it("深くネストしたパスを正しく処理する", () => {
    const result = buildDirectoryTree([
      "apps/analysis-worker/src/index.ts",
      "apps/analysis-worker/src/engines.ts",
      "apps/api/src/index.ts",
    ]);
    assert.ok(result.includes("apps/"), `expected apps/ in:\n${result}`);
    assert.ok(result.includes("analysis-worker/"), `expected analysis-worker/ in:\n${result}`);
    assert.ok(result.includes("api/"), `expected api/ in:\n${result}`);
  });

  it("Windowsスタイルのバックスラッシュパスを正規化する", () => {
    const result = buildDirectoryTree(["src\\index.ts", "src\\engines.ts"]);
    assert.ok(result.includes("src/"), `expected src/ in:\n${result}`);
    assert.ok(result.includes("index.ts"), `expected index.ts in:\n${result}`);
  });

  it("ツリー末尾ノードに└──、中間ノードに├──を使う", () => {
    const result = buildDirectoryTree(["src/a.ts", "src/b.ts"]);
    // 2ファイルある場合、最初は├── 、最後は└──
    assert.ok(result.includes("├──") || result.includes("└──"), `expected tree chars in:\n${result}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildModuleDependencyGraph
// ─────────────────────────────────────────────────────────────────────────────

describe("buildModuleDependencyGraph", () => {
  it("空ファイル一覧でMermaidブロックが生成されないことを確認", () => {
    const result = buildModuleDependencyGraph([]);
    assert.ok(!result.includes("```mermaid"), `expected no mermaid block in:\n${result}`);
  });

  it("TypeScript の ES import（相対パス）を検出する", () => {
    const files = [
      {
        path: "src/index.ts",
        content: `import { foo } from './engines.js';\nimport bar from './storage.js';`,
      },
    ];
    const result = buildModuleDependencyGraph(files);
    assert.ok(result.includes("```mermaid"), `expected mermaid block in:\n${result}`);
    assert.ok(result.includes("src/engines"), `expected src/engines edge in:\n${result}`);
    assert.ok(result.includes("src/storage"), `expected src/storage edge in:\n${result}`);
  });

  it("外部パッケージ（非相対パス）を除外する", () => {
    const files = [
      {
        path: "src/index.ts",
        content: `import fs from 'node:fs';\nimport React from 'react';\nimport { foo } from './local.js';`,
      },
    ];
    const result = buildModuleDependencyGraph(files);
    assert.ok(!result.includes("react"), `should not include react in:\n${result}`);
    assert.ok(!result.includes("node:fs"), `should not include node:fs in:\n${result}`);
    // ローカルは含まれる
    assert.ok(result.includes("local"), `should include local in:\n${result}`);
  });

  it("Python の from .foo import bar を検出する", () => {
    const files = [
      {
        path: "app/main.py",
        content: `from .models import User\nfrom .services import AuthService`,
      },
    ];
    const result = buildModuleDependencyGraph(files);
    assert.ok(result.includes("```mermaid"), `expected mermaid block in:\n${result}`);
    assert.ok(result.includes("app/main.py"), `expected app/main.py in:\n${result}`);
  });

  it("テストファイルを除外する", () => {
    const files = [
      {
        path: "test/engines.test.ts",
        content: `import { foo } from '../src/engines.js';`,
      },
    ];
    const result = buildModuleDependencyGraph(files);
    // テストファイルは除外されるのでエッジが生成されない
    assert.ok(!result.includes("```mermaid"), `test file should be excluded, got:\n${result}`);
  });

  it("エッジ数が50件を超えた場合に省略メッセージを付与する", () => {
    // 51件のファイルを用意する（各1エッジ）
    const files = Array.from({ length: 51 }, (_, i) => ({
      path: `src/module${i}.ts`,
      content: `import { foo } from './target.js';`,
    }));
    const result = buildModuleDependencyGraph(files);
    assert.ok(result.includes("省略"), `expected truncation notice in:\n${result}`);
  });

  it("相対パスの../を正しく解決してラベルを生成する", () => {
    const files = [
      {
        path: "apps/api/src/index.ts",
        content: `import { foo } from '../../shared/utils.js';`,
      },
    ];
    const result = buildModuleDependencyGraph(files);
    assert.ok(result.includes("```mermaid"), `expected mermaid in:\n${result}`);
    // apps/api/src/../../shared/utils → apps/shared/utils
    assert.ok(result.includes("apps/shared/utils"), `expected resolved path in:\n${result}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildIaCStructureMap
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIaCStructureMap", () => {
  it(".tfファイルが存在しない場合は「検出されませんでした」を返す", () => {
    const result = buildIaCStructureMap([
      { path: "src/index.ts", content: 'provider "google" {}' },
    ]);
    assert.ok(result.includes("検出されませんでした"), `expected no-tf message in:\n${result}`);
  });

  it(".tfファイルが空の場合は「検出されませんでした」を返す", () => {
    const result = buildIaCStructureMap([{ path: "main.tf", content: "" }]);
    assert.ok(result.includes("検出されませんでした"), `expected no-tf message in:\n${result}`);
  });

  it("provider ブロックを検出する", () => {
    const result = buildIaCStructureMap([
      { path: "main.tf", content: 'provider "google" {\n  project = "my-project"\n}' },
    ]);
    assert.ok(result.includes("provider"), `expected provider in:\n${result}`);
    assert.ok(result.includes("google"), `expected google in:\n${result}`);
  });

  it("resource ブロックを検出する", () => {
    const result = buildIaCStructureMap([
      {
        path: "main.tf",
        content: 'resource "google_cloud_run_v2_service" "api" {\n  name = "api"\n}',
      },
    ]);
    assert.ok(result.includes("resource"), `expected resource in:\n${result}`);
    assert.ok(
      result.includes("google_cloud_run_v2_service.api"),
      `expected resource name in:\n${result}`,
    );
  });

  it("module ブロックを検出する", () => {
    const result = buildIaCStructureMap([
      { path: "main.tf", content: 'module "network" {\n  source = "./modules/vpc"\n}' },
    ]);
    assert.ok(result.includes("module"), `expected module in:\n${result}`);
    assert.ok(result.includes("network"), `expected network in:\n${result}`);
  });

  it("variable ブロックを検出する", () => {
    const result = buildIaCStructureMap([
      {
        path: "variables.tf",
        content: 'variable "project_id" {\n  type = string\n}',
      },
    ]);
    assert.ok(result.includes("variable"), `expected variable in:\n${result}`);
    assert.ok(result.includes("project_id"), `expected project_id in:\n${result}`);
  });

  it("output ブロックを検出する", () => {
    const result = buildIaCStructureMap([
      {
        path: "outputs.tf",
        content: 'output "api_url" {\n  value = google_cloud_run_v2_service.api.uri\n}',
      },
    ]);
    assert.ok(result.includes("output"), `expected output in:\n${result}`);
    assert.ok(result.includes("api_url"), `expected api_url in:\n${result}`);
  });

  it("複数の.tfファイルをまとめて処理する", () => {
    const result = buildIaCStructureMap([
      { path: "main.tf", content: 'provider "google" {}' },
      { path: "variables.tf", content: 'variable "project_id" {}' },
      {
        path: "resources.tf",
        content: 'resource "google_storage_bucket" "uploads" {}',
      },
    ]);
    assert.ok(result.includes("provider"), `expected provider in:\n${result}`);
    assert.ok(result.includes("variable"), `expected variable in:\n${result}`);
    assert.ok(result.includes("resource"), `expected resource in:\n${result}`);
    // ファイルパスも表示される
    assert.ok(result.includes("main.tf"), `expected main.tf in:\n${result}`);
    assert.ok(result.includes("variables.tf"), `expected variables.tf in:\n${result}`);
    assert.ok(result.includes("resources.tf"), `expected resources.tf in:\n${result}`);
  });

  it("Markdownテーブル形式で出力する", () => {
    const result = buildIaCStructureMap([
      { path: "main.tf", content: 'provider "google" {}' },
    ]);
    assert.ok(result.includes("| 種別 |"), `expected table header in:\n${result}`);
    assert.ok(result.includes("| --- |"), `expected table separator in:\n${result}`);
  });

  it("AWS CDK (TypeScript) を検出する", () => {
    const files = [
      {
        path: "cdk/lib/my-stack.ts",
        content: `
          import { Stack } from 'aws-cdk-lib';
          import * as s3 from 'aws-cdk-lib/aws-s3';
          export class MyStack extends Stack {
            constructor() {
              new s3.Bucket(this, 'MyBucket');
            }
          }
        `,
      },
    ];
    const result = buildIaCStructureMap(files);
    assert.ok(result.includes("CDK Stack"), `expected CDK Stack in:\n${result}`);
    assert.ok(result.includes("MyStack"), `expected MyStack in:\n${result}`);
    assert.ok(result.includes("CDK Resource"), `expected CDK Resource in:\n${result}`);
    assert.ok(result.includes("s3.Bucket"), `expected s3.Bucket in:\n${result}`);
  });

  it("CloudFormation を検出する", () => {
    const files = [
      {
        path: "template.yaml",
        content: `
          AWSTemplateFormatVersion: '2010-09-09'
          Resources:
            MyBucket:
              Type: AWS::S3::Bucket
        `,
      },
    ];
    const result = buildIaCStructureMap(files);
    assert.ok(result.includes("CloudFormation Resource"), `expected CF Resource in:\n${result}`);
    assert.ok(result.includes("MyBucket (AWS::S3::Bucket)"), `expected Bucket info in:\n${result}`);
  });

  it("Kubernetes を検出する", () => {
    const files = [
      {
        path: "pod.yaml",
        content: `
          apiVersion: v1
          kind: Pod
          metadata:
            name: my-pod
        `,
      },
    ];
    const result = buildIaCStructureMap(files);
    assert.ok(result.includes("Kubernetes Pod"), `expected Kubernetes Pod in:\n${result}`);
    assert.ok(result.includes("my-pod"), `expected my-pod in:\n${result}`);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AnalysisEngine,
  DatabaseSchemaEngine,
  DesignGenerator,
  ExtractionResult,
  SsotSynthesisGenerator,
} from "../src/engines.js";
import { AnalysisOrchestrator } from "../src/orchestrator.js";
import { AnalysisTaskPayload, StorageObjectRef } from "../src/payload.js";
import { SynthesisComponentSpecifications } from "../src/prompts.js";
import { InMemoryJobRepository, JobStatus } from "../src/repositories.js";
import { InMemoryArtifactWriter, InputLoader, LoadedInputs } from "../src/storage.js";

class StaticInputLoader implements InputLoader {
  async load(): Promise<LoadedInputs> {
    return {
      sourceArchiveUri: "gs://bucket/source.zip",
      documentUris: ["gs://bucket/doc.md"],
      sourceFiles: [],
      infrastructureFiles: [],
      documentFiles: [],
      allSourceFiles: [],
    };
  }
}

class StaticEngine implements AnalysisEngine {
  constructor(private result: ExtractionResult) {}

  async extract(): Promise<ExtractionResult> {
    return this.result;
  }
}

class StaticGenerator implements DesignGenerator {
  constructor(private content: string) {}

  async generate(): Promise<string> {
    return this.content;
  }
}

class StaticDatabaseSchemaEngine implements DatabaseSchemaEngine {
  async analyze(): Promise<string> {
    return "# DB Schema\n";
  }
}

class StaticSsotSynthesisGenerator implements SsotSynthesisGenerator {
  public componentSpecifications: SynthesisComponentSpecifications | null = null;

  async generate(
    _payload: AnalysisTaskPayload,
    _sourceSpecification: ExtractionResult,
    _documentSpecification: ExtractionResult,
    componentSpecifications: SynthesisComponentSpecifications,
  ): Promise<string> {
    this.componentSpecifications = componentSpecifications;
    return "# Single Source of Truth\n";
  }
}

test("AnalysisOrchestrator writes source analysis, component specs, and SSOT artifacts", async () => {
  const writer = new InMemoryArtifactWriter();
  const ssotSynthesisGenerator = new StaticSsotSynthesisGenerator();
  const orchestrator = new AnalysisOrchestrator({
    jobRepository: new InMemoryJobRepository(),
    inputLoader: new StaticInputLoader(),
    artifactWriter: writer,
    sourceCodeEngine: new StaticEngine({
      summary: "source summary",
      extractedItems: { source_archive_uri: "gs://bucket/source.zip" },
      artifacts: {
        "codebase-map.md": "# Codebase Map\n",
        "module-dependencies.mmd": "flowchart LR\n",
        "iac-structure.md": "# IaC Structure Dump\n",
        "codebase-map.json": "{}\n",
        "api-spec.yaml": "openapi: 3.0.0\n",
      },
    }),
    documentEngine: new StaticEngine({
      summary: "document summary",
      extractedItems: { document_uris: ["gs://bucket/doc.md"] },
    }),
    trueDesignGenerator: new StaticGenerator("# True Design\n"),
    driftReportGenerator: new StaticGenerator("# Drift Report\n"),
    databaseSchemaEngine: new StaticDatabaseSchemaEngine(),
    ssotSynthesisGenerator,
  });
  const payload = new AnalysisTaskPayload({
    jobId: "job-1",
    sourceArchive: new StorageObjectRef("bucket", "source.zip"),
    documents: [new StorageObjectRef("bucket", "doc.md")],
    resultsPrefix: "results/job-1",
  });

  const result = await orchestrator.run(payload);
  const files = writer.filesByJobId["job-1"];

  assert.equal(result.status, JobStatus.SUCCEEDED);
  assert.deepEqual(Object.keys(files).sort(), [
    "api-spec.yaml",
    "codebase-map.json",
    "codebase-map.md",
    "database_schema_spec.md",
    "document-drift-report.md",
    "iac-structure.md",
    "module-dependencies.mmd",
    "single-source-of-truth.md",
    "true-design.md",
  ]);
  assert.equal(files["single-source-of-truth.md"], "# Single Source of Truth\n");
  assert.match(ssotSynthesisGenerator.componentSpecifications?.infrastructureSpecMarkdown ?? "", /IaC Structure/);
  assert.match(ssotSynthesisGenerator.componentSpecifications?.apiSpecMarkdown ?? "", /openapi: 3\.0\.0/);
  assert.match(ssotSynthesisGenerator.componentSpecifications?.databaseSchemaSpecMarkdown ?? "", /DB Schema/);
});

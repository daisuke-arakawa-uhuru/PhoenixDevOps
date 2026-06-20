import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisEngine, DesignGenerator, ExtractionResult } from "../src/engines.js";
import { AnalysisOrchestrator } from "../src/orchestrator.js";
import { AnalysisTaskPayload, StorageObjectRef } from "../src/payload.js";
import { InMemoryJobRepository, JobStatus } from "../src/repositories.js";
import { InMemoryArtifactWriter, InputLoader, LoadedInputs } from "../src/storage.js";

class StaticInputLoader implements InputLoader {
  async load(): Promise<LoadedInputs> {
    return {
      sourceArchiveUri: "gs://bucket/source.zip",
      documentUris: ["gs://bucket/doc.md"],
      sourceFiles: [],
      documentFiles: [],
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

test("AnalysisOrchestrator writes source analysis artifacts alongside generated Markdown", async () => {
  const writer = new InMemoryArtifactWriter();
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
      },
    }),
    documentEngine: new StaticEngine({
      summary: "document summary",
      extractedItems: { document_uris: ["gs://bucket/doc.md"] },
    }),
    trueDesignGenerator: new StaticGenerator("# True Design\n"),
    driftReportGenerator: new StaticGenerator("# Drift Report\n"),
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
    "codebase-map.json",
    "codebase-map.md",
    "document-drift-report.md",
    "iac-structure.md",
    "module-dependencies.mmd",
    "true-design.md",
  ]);
});

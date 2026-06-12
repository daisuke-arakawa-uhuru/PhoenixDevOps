"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { WorkerConfig } = require("./config");
const {
  GeminiDocumentExtractionEngine,
  GeminiDriftReportGenerator,
  GeminiSourceCodeAnalysisEngine,
  GeminiTrueDesignGenerator,
} = require("./engines");
const { buildGeminiClient, GeminiSettings } = require("./gemini");
const { AnalysisOrchestrator } = require("./orchestrator");
const { AnalysisTaskPayload, StorageObjectRef } = require("./payload");
const { InMemoryJobRepository } = require("./repositories");
const { LocalArtifactWriter, LocalFileInputLoader } = require("./storage");

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const config = WorkerConfig.fromEnv(process.env);
  const geminiClient = buildGeminiClient(
    new GeminiSettings({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      dryRun: args.dryRun || config.geminiDryRun,
    }),
  );

  const jobId = args.jobId || `local-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const payload = new AnalysisTaskPayload({
    jobId,
    projectName: args.projectName,
    sourceArchive: new StorageObjectRef("local", args.source),
    documents: args.documents.map((document) => new StorageObjectRef("local", document)),
    resultsPrefix: jobId,
  });

  const orchestrator = new AnalysisOrchestrator({
    jobRepository: new InMemoryJobRepository(),
    inputLoader: new LocalFileInputLoader(args.source, args.documents),
    artifactWriter: new LocalArtifactWriter(args.output),
    sourceCodeEngine: new GeminiSourceCodeAnalysisEngine(geminiClient),
    documentEngine: new GeminiDocumentExtractionEngine(geminiClient),
    trueDesignGenerator: new GeminiTrueDesignGenerator(geminiClient),
    driftReportGenerator: new GeminiDriftReportGenerator(geminiClient),
  });

  const result = await orchestrator.run(payload);
  process.stdout.write(`${JSON.stringify(result.toResponse(), null, 2)}\n`);
}

function parseArgs(argv) {
  const args = {
    documents: [],
    output: "output",
    projectName: null,
    jobId: null,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    const value = argv[index + 1];
    if (value == null) {
      throw new Error(`${item} requires a value`);
    }
    index += 1;

    if (item === "--source") {
      args.source = value;
    } else if (item === "--document") {
      args.documents.push(value);
    } else if (item === "--project-name") {
      args.projectName = value;
    } else if (item === "--job-id") {
      args.jobId = value;
    } else if (item === "--output") {
      args.output = value;
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }

  if (!args.source) {
    throw new Error("--source is required");
  }
  if (!fs.existsSync(args.source)) {
    throw new Error(`--source does not exist: ${args.source}`);
  }
  for (const document of args.documents) {
    if (!fs.existsSync(document)) {
      throw new Error(`--document does not exist: ${document}`);
    }
  }
  if (args.documents.length === 0) {
    throw new Error("--document is required at least once");
  }

  args.source = path.normalize(args.source);
  args.documents = args.documents.map((document) => path.normalize(document));
  args.output = path.normalize(args.output);
  return args;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
};

"use strict";

const {
  GeminiDocumentExtractionEngine,
  GeminiDriftReportGenerator,
  GeminiSourceCodeAnalysisEngine,
  GeminiTrueDesignGenerator,
} = require("./engines");
const { buildGeminiClient, GeminiSettings } = require("./gemini");
const { AnalysisOrchestrator } = require("./orchestrator");
const { FirestoreJobRepository } = require("./repositories");
const { GcsArtifactWriter, GcsInputLoader } = require("./storage");

function buildOrchestrator(config) {
  const geminiClient = buildGeminiClient(
    new GeminiSettings({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      dryRun: config.geminiDryRun,
    }),
  );

  return new AnalysisOrchestrator({
    jobRepository: new FirestoreJobRepository(config.firestoreJobsCollection),
    inputLoader: new GcsInputLoader(),
    artifactWriter: new GcsArtifactWriter({
      resultsBucket: config.resultsBucket,
      resultsPrefixTemplate: config.resultsPrefixTemplate,
    }),
    sourceCodeEngine: new GeminiSourceCodeAnalysisEngine(geminiClient),
    documentEngine: new GeminiDocumentExtractionEngine(geminiClient),
    trueDesignGenerator: new GeminiTrueDesignGenerator(geminiClient),
    driftReportGenerator: new GeminiDriftReportGenerator(geminiClient),
  });
}

module.exports = {
  buildOrchestrator,
};

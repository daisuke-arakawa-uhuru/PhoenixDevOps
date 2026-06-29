import {
  GeminiDocumentExtractionEngine,
  GeminiDriftReportGenerator,
  GeminiSourceCodeAnalysisEngine,
  GeminiTrueDesignGenerator,
  GeminiDatabaseSchemaAnalysisEngine,
  GeminiBusinessLogicAnalysisEngine,
  GeminiSsotSynthesisGenerator,
} from "./engines.js";
import { buildGeminiClient, GeminiSettings } from "./gemini.js";
import { AnalysisOrchestrator } from "./orchestrator.js";
import { FirestoreJobRepository } from "./repositories.js";
import { GcsArtifactWriter, GcsInputLoader } from "./storage.js";
import { WorkerConfig } from "./config.js";

export function buildOrchestrator(config: WorkerConfig): AnalysisOrchestrator {
  const geminiClient = buildGeminiClient(
    new GeminiSettings({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      dryRun: config.geminiDryRun,
      useVertexAi: config.geminiUseVertexAi,
      project: config.geminiProject,
      location: config.geminiLocation,
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
    databaseSchemaEngine: new GeminiDatabaseSchemaAnalysisEngine(geminiClient),
    businessLogicEngine: new GeminiBusinessLogicAnalysisEngine(geminiClient),
    ssotSynthesisGenerator: new GeminiSsotSynthesisGenerator(geminiClient),
  });
}

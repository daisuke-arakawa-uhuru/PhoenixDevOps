import { AnalysisTaskPayload } from "./payload.js";
import { JobRepository, JobStatus } from "./repositories.js";
import { InputLoader } from "./storage.js";
import {
  AnalysisEngine,
  DesignGenerator,
  BusinessLogicEngine,
  DatabaseSchemaEngine,
  generatedArtifacts,
  ExtractionResult,
  SsotSynthesisGenerator,
} from "./engines.js";
import { InfrastructureAgent } from "./infra.js";
import type { SynthesisComponentSpecifications } from "./prompts.js";

export class WorkerResult {
  jobId: string;
  status: string;
  artifactPaths: Record<string, string>;
  message: string | null;

  constructor({
    jobId,
    status,
    artifactPaths,
    message = null,
  }: {
    jobId: string;
    status: string;
    artifactPaths: Record<string, string>;
    message?: string | null;
  }) {
    this.jobId = jobId;
    this.status = status;
    this.artifactPaths = artifactPaths;
    this.message = message;
  }

  toResponse(): Record<string, any> {
    const response: Record<string, any> = {
      jobId: this.jobId,
      status: this.status,
      artifactPaths: this.artifactPaths,
    };
    if (this.message) {
      response.message = this.message;
    }
    return response;
  }
}

export class AnalysisOrchestrator {
  private jobRepository: JobRepository;
  private inputLoader: InputLoader;
  private artifactWriter: any; // TODO: Define ArtifactWriter interface properly
  private sourceCodeEngine: AnalysisEngine;
  private documentEngine: AnalysisEngine;
  private trueDesignGenerator: DesignGenerator;
  private driftReportGenerator: DesignGenerator;
  private infrastructureAgent: InfrastructureAgent | null;
  private databaseSchemaEngine: DatabaseSchemaEngine | null;
  private businessLogicEngine: BusinessLogicEngine | null;
  private ssotSynthesisGenerator: SsotSynthesisGenerator | null;

  constructor({
    jobRepository,
    inputLoader,
    artifactWriter,
    sourceCodeEngine,
    documentEngine,
    trueDesignGenerator,
    driftReportGenerator,
    infrastructureAgent = null,
    databaseSchemaEngine = null,
    businessLogicEngine = null,
    ssotSynthesisGenerator = null,
  }: {
    jobRepository: JobRepository;
    inputLoader: InputLoader;
    artifactWriter: any;
    sourceCodeEngine: AnalysisEngine;
    documentEngine: AnalysisEngine;
    trueDesignGenerator: DesignGenerator;
    driftReportGenerator: DesignGenerator;
    infrastructureAgent?: InfrastructureAgent | null;
    databaseSchemaEngine?: DatabaseSchemaEngine | null;
    businessLogicEngine?: BusinessLogicEngine | null;
    ssotSynthesisGenerator?: SsotSynthesisGenerator | null;
  }) {
    this.jobRepository = jobRepository;
    this.inputLoader = inputLoader;
    this.artifactWriter = artifactWriter;
    this.sourceCodeEngine = sourceCodeEngine;
    this.documentEngine = documentEngine;
    this.trueDesignGenerator = trueDesignGenerator;
    this.driftReportGenerator = driftReportGenerator;
    this.infrastructureAgent = infrastructureAgent;
    this.databaseSchemaEngine = databaseSchemaEngine;
    this.businessLogicEngine = businessLogicEngine;
    this.ssotSynthesisGenerator = ssotSynthesisGenerator;
  }

  async run(payload: AnalysisTaskPayload): Promise<WorkerResult> {
    const currentJob = await this.jobRepository.get(payload.jobId);
    if (currentJob && currentJob.status === JobStatus.SUCCEEDED) {
      return new WorkerResult({
        jobId: payload.jobId,
        status: JobStatus.SUCCEEDED,
        artifactPaths: currentJob.artifactPaths,
        message: "job_already_succeeded",
      });
    }

    await this.jobRepository.markRunning(payload.jobId);

    try {
      const inputs = await this.inputLoader.load(payload);
      const sourceSpecification = await this.sourceCodeEngine.extract(payload, inputs);
      const documentSpecification = await this.documentEngine.extract(payload, inputs);

      // DB・データモデル解析（エンジンが設定されている場合のみ実行）
      let databaseSchemaSpecMarkdown: string | null = null;
      if (this.databaseSchemaEngine) {
        databaseSchemaSpecMarkdown = await this.databaseSchemaEngine.analyze(
          payload,
          inputs,
          sourceSpecification,
        );
      }

      // ビジネスロジック解析（エンジンが設定されている場合のみ実行）
      let businessLogicSpecMarkdown: string | null = null;
      if (this.businessLogicEngine) {
        businessLogicSpecMarkdown = await this.businessLogicEngine.analyze(
          payload,
          inputs,
          sourceSpecification,
        );
      }

      const componentSpecifications = buildSynthesisComponentSpecifications(
        sourceSpecification,
        databaseSchemaSpecMarkdown,
        businessLogicSpecMarkdown,
      );

      let ssotMarkdown: string | null = null;
      if (this.ssotSynthesisGenerator) {
        ssotMarkdown = await this.ssotSynthesisGenerator.generate(
          payload,
          sourceSpecification,
          documentSpecification,
          componentSpecifications,
        );
      }

      const artifacts = generatedArtifacts({
        trueDesignMarkdown: await this.trueDesignGenerator.generate(
          payload,
          sourceSpecification,
          documentSpecification,
        ),
        driftReportMarkdown: await this.driftReportGenerator.generate(
          payload,
          sourceSpecification,
          documentSpecification,
        ),
        ssotMarkdown,
        extraFiles: sourceSpecification.artifacts,
        databaseSchemaSpecMarkdown,
        businessLogicSpecMarkdown,
      });

      const files = artifacts.asFiles();
      const debugFiles = {
        ...(sourceSpecification.debugArtifacts ?? {}),
        ...(documentSpecification.debugArtifacts ?? {}),
      };
      if (this.infrastructureAgent) {
        files["infrastructure_spec.md"] = await this.infrastructureAgent.analyze(payload, inputs);
      }
      const artifactPaths = await this.artifactWriter.write(payload, {
        ...files,
        ...debugFiles,
      });
      await this.jobRepository.markSucceeded(payload.jobId, artifactPaths);
      return new WorkerResult({
        jobId: payload.jobId,
        status: JobStatus.SUCCEEDED,
        artifactPaths,
      });
    } catch (error) {
      await this.jobRepository.markFailed(
        payload.jobId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}

function buildSynthesisComponentSpecifications(
  sourceSpecification: ExtractionResult,
  databaseSchemaSpecMarkdown: string | null,
  businessLogicSpecMarkdown: string | null,
): SynthesisComponentSpecifications {
  const artifacts = sourceSpecification.artifacts ?? {};
  return {
    infrastructureSpecMarkdown: firstArtifactContent(artifacts, [
      "infrastructure_spec.md",
      "infrastructure-spec.md",
      "iac-structure.md",
    ]),
    apiSpecMarkdown: collectApiSpecMarkdown(artifacts),
    databaseSchemaSpecMarkdown,
    businessLogicSpecMarkdown,
  };
}

function firstArtifactContent(
  artifacts: Record<string, string>,
  candidateNames: string[],
): string | null {
  for (const name of candidateNames) {
    const content = artifacts[name];
    if (content && content.trim()) {
      return content;
    }
  }
  return null;
}

function collectApiSpecMarkdown(artifacts: Record<string, string>): string | null {
  const apiArtifacts = Object.entries(artifacts)
    .filter(([name, content]) => isApiSpecArtifact(name) && content.trim())
    .sort(([left], [right]) => left.localeCompare(right));
  if (apiArtifacts.length === 0) {
    return null;
  }
  return apiArtifacts
    .map(([name, content]) =>
      [`### ${name}`, "", `\`\`\`${fenceLanguageForArtifact(name)}`, content.trim(), "```"].join(
        "\n",
      ),
    )
    .join("\n\n");
}

function isApiSpecArtifact(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized.includes("api-spec") ||
    normalized.includes("api_spec") ||
    normalized.includes("api-specification") ||
    normalized.includes("api_specification") ||
    normalized.includes("openapi") ||
    normalized.includes("swagger")
  );
}

function fenceLanguageForArtifact(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.endsWith(".json")) {
    return "json";
  }
  if (normalized.endsWith(".yaml") || normalized.endsWith(".yml")) {
    return "yaml";
  }
  if (normalized.endsWith(".md")) {
    return "markdown";
  }
  return "text";
}

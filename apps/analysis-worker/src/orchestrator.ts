import { AnalysisTaskPayload } from "./payload.js";
import { JobRepository, JobStatus } from "./repositories.js";
import { InputLoader } from "./storage.js";
import {
  AnalysisEngine,
  DesignGenerator,
  generatedArtifacts,
  ExtractionResult,
} from "./engines.js";

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

  constructor({
    jobRepository,
    inputLoader,
    artifactWriter,
    sourceCodeEngine,
    documentEngine,
    trueDesignGenerator,
    driftReportGenerator,
  }: {
    jobRepository: JobRepository;
    inputLoader: InputLoader;
    artifactWriter: any;
    sourceCodeEngine: AnalysisEngine;
    documentEngine: AnalysisEngine;
    trueDesignGenerator: DesignGenerator;
    driftReportGenerator: DesignGenerator;
  }) {
    this.jobRepository = jobRepository;
    this.inputLoader = inputLoader;
    this.artifactWriter = artifactWriter;
    this.sourceCodeEngine = sourceCodeEngine;
    this.documentEngine = documentEngine;
    this.trueDesignGenerator = trueDesignGenerator;
    this.driftReportGenerator = driftReportGenerator;
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
      const artifacts = generatedArtifacts(
        await this.trueDesignGenerator.generate(payload, sourceSpecification, documentSpecification),
        await this.driftReportGenerator.generate(payload, sourceSpecification, documentSpecification),
      );
      const debugFiles = {
        ...(sourceSpecification.debugArtifacts ?? {}),
        ...(documentSpecification.debugArtifacts ?? {}),
      };
      const artifactPaths = await this.artifactWriter.write(payload, {
        ...artifacts.asFiles(),
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

"use strict";

const { generatedArtifacts } = require("./engines");
const { JobStatus } = require("./repositories");

class WorkerResult {
  constructor({ jobId, status, artifactPaths, message = null }) {
    this.jobId = jobId;
    this.status = status;
    this.artifactPaths = artifactPaths;
    this.message = message;
  }

  toResponse() {
    const response = {
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

class AnalysisOrchestrator {
  constructor({
    jobRepository,
    inputLoader,
    artifactWriter,
    sourceCodeEngine,
    documentEngine,
    trueDesignGenerator,
    driftReportGenerator,
  }) {
    this.jobRepository = jobRepository;
    this.inputLoader = inputLoader;
    this.artifactWriter = artifactWriter;
    this.sourceCodeEngine = sourceCodeEngine;
    this.documentEngine = documentEngine;
    this.trueDesignGenerator = trueDesignGenerator;
    this.driftReportGenerator = driftReportGenerator;
  }

  async run(payload) {
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
      const artifactPaths = await this.artifactWriter.write(payload, artifacts.asFiles());
      await this.jobRepository.markSucceeded(payload.jobId, artifactPaths);
      return new WorkerResult({
        jobId: payload.jobId,
        status: JobStatus.SUCCEEDED,
        artifactPaths,
      });
    } catch (error) {
      await this.jobRepository.markFailed(payload.jobId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

module.exports = {
  AnalysisOrchestrator,
  WorkerResult,
};

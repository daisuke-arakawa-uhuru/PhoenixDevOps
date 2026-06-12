"use strict";

class WorkerConfig {
  constructor({
    firestoreJobsCollection = "jobs",
    resultsBucket = null,
    resultsPrefixTemplate = "results/{job_id}",
    geminiApiKey = null,
    geminiModel = "gemini-2.0-flash",
    geminiDryRun = false,
  } = {}) {
    this.firestoreJobsCollection = firestoreJobsCollection;
    this.resultsBucket = resultsBucket;
    this.resultsPrefixTemplate = resultsPrefixTemplate;
    this.geminiApiKey = geminiApiKey;
    this.geminiModel = geminiModel;
    this.geminiDryRun = geminiDryRun;
  }

  static fromEnv(env = process.env) {
    return new WorkerConfig({
      firestoreJobsCollection: env.FIRESTORE_JOBS_COLLECTION || "jobs",
      resultsBucket: env.RESULTS_BUCKET || null,
      resultsPrefixTemplate: env.RESULTS_PREFIX_TEMPLATE || "results/{job_id}",
      geminiApiKey: env.GEMINI_API_KEY || null,
      geminiModel: env.GEMINI_MODEL || "gemini-2.0-flash",
      geminiDryRun: ["1", "true", "yes"].includes(String(env.GEMINI_DRY_RUN || "").toLowerCase()),
    });
  }
}

module.exports = {
  WorkerConfig,
};

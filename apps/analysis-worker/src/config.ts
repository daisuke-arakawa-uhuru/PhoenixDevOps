export class WorkerConfig {
  firestoreJobsCollection: string;
  resultsBucket: string | null;
  resultsPrefixTemplate: string;
  geminiApiKey: string | null;
  geminiModel: string;
  geminiDryRun: boolean;

  constructor({
    firestoreJobsCollection = "jobs",
    resultsBucket = null,
    resultsPrefixTemplate = "results/{job_id}",
    geminiApiKey = null,
    geminiModel = "gemini-3.1-flash-lite",
    geminiDryRun = false,
  }: {
    firestoreJobsCollection?: string;
    resultsBucket?: string | null;
    resultsPrefixTemplate?: string;
    geminiApiKey?: string | null;
    geminiModel?: string;
    geminiDryRun?: boolean;
  } = {}) {
    this.firestoreJobsCollection = firestoreJobsCollection;
    this.resultsBucket = resultsBucket;
    this.resultsPrefixTemplate = resultsPrefixTemplate;
    this.geminiApiKey = geminiApiKey;
    this.geminiModel = geminiModel;
    this.geminiDryRun = geminiDryRun;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
    return new WorkerConfig({
      firestoreJobsCollection: env.FIRESTORE_JOBS_COLLECTION || "jobs",
      resultsBucket: env.RESULTS_BUCKET || null,
      resultsPrefixTemplate: env.RESULTS_PREFIX_TEMPLATE || "results/{job_id}",
      geminiApiKey: env.GEMINI_API_KEY || null,
      geminiModel: env.GEMINI_MODEL || "gemini-3.1-flash-lite",
      geminiDryRun: ["1", "true", "yes"].includes(String(env.GEMINI_DRY_RUN || "").toLowerCase()),
    });
  }
}

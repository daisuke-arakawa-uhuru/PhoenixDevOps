export class WorkerConfig {
  firestoreJobsCollection: string;
  resultsBucket: string | null;
  resultsPrefixTemplate: string;
  geminiApiKey: string | null;
  geminiModel: string;
  geminiDryRun: boolean;
  geminiUseVertexAi: boolean;
  geminiProject: string | null;
  geminiLocation: string | null;

  constructor({
    firestoreJobsCollection = "jobs",
    resultsBucket = null,
    resultsPrefixTemplate = "results/{job_id}",
    geminiApiKey = null,
    geminiModel = "gemini-3.1-flash-lite",
    geminiDryRun = false,
    geminiUseVertexAi = false,
    geminiProject = null,
    geminiLocation = null,
  }: {
    firestoreJobsCollection?: string;
    resultsBucket?: string | null;
    resultsPrefixTemplate?: string;
    geminiApiKey?: string | null;
    geminiModel?: string;
    geminiDryRun?: boolean;
    geminiUseVertexAi?: boolean;
    geminiProject?: string | null;
    geminiLocation?: string | null;
  } = {}) {
    this.firestoreJobsCollection = firestoreJobsCollection;
    this.resultsBucket = resultsBucket;
    this.resultsPrefixTemplate = resultsPrefixTemplate;
    this.geminiApiKey = geminiApiKey;
    this.geminiModel = geminiModel;
    this.geminiDryRun = geminiDryRun;
    this.geminiUseVertexAi = geminiUseVertexAi;
    this.geminiProject = geminiProject;
    this.geminiLocation = geminiLocation;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
    let useVertexAi = true;
    if (env.GEMINI_USE_VERTEX_AI !== undefined) {
      useVertexAi = ["1", "true", "yes"].includes(String(env.GEMINI_USE_VERTEX_AI).toLowerCase());
    } else if (env.GOOGLE_GENAI_USE_VERTEXAI !== undefined) {
      useVertexAi = ["1", "true", "yes"].includes(String(env.GOOGLE_GENAI_USE_VERTEXAI).toLowerCase());
    }

    const location = env.GOOGLE_CLOUD_LOCATION || env.GCP_LOCATION || env.GEMINI_LOCATION || (useVertexAi ? "global" : null);

    return new WorkerConfig({
      firestoreJobsCollection: env.FIRESTORE_JOBS_COLLECTION || "jobs",
      resultsBucket: env.RESULTS_BUCKET || null,
      resultsPrefixTemplate: env.RESULTS_PREFIX_TEMPLATE || "results/{job_id}",
      geminiApiKey: env.GEMINI_API_KEY || null,
      geminiModel: env.GEMINI_MODEL || "gemini-3.1-flash-lite",
      geminiDryRun: ["1", "true", "yes"].includes(String(env.GEMINI_DRY_RUN || "").toLowerCase()),
      geminiUseVertexAi: useVertexAi,
      geminiProject: env.GOOGLE_CLOUD_PROJECT || env.GCP_PROJECT || env.GEMINI_PROJECT || null,
      geminiLocation: location,
    });
  }
}

import { CloudTasksClient } from "@google-cloud/tasks";
import { ApiConfig } from "./config";

export type AnalysisTaskPayload = {
  jobId: string;
  sourceArchiveUri: string;
  documentUris: string[];
  resultsPrefix: string;
  projectName?: string;
  requestedBy?: string;
};

type TasksClient = {
  queuePath(project: string, location: string, queue: string): string;
  createTask(request: {
    parent: string;
    task: {
      httpRequest: {
        httpMethod: "POST";
        url: string;
        headers: Record<string, string>;
        body: Buffer;
        oidcToken?: {
          serviceAccountEmail: string;
        };
      };
    };
  }): Promise<[{ name?: string } | undefined]>;
};

export interface TaskEnqueuer {
  enqueueAnalysisTask(payload: AnalysisTaskPayload): Promise<string | null>;
}

export class CloudTasksEnqueuer implements TaskEnqueuer {
  private readonly config: ApiConfig;
  private readonly client: TasksClient;

  constructor(config: ApiConfig, tasksClient: TasksClient | null = null) {
    this.config = config;
    this.client = tasksClient ?? (new CloudTasksClient() as unknown as TasksClient);
  }

  async enqueueAnalysisTask(payload: AnalysisTaskPayload): Promise<string | null> {
    this.config.requireTasksConfig();
    const parent = this.client.queuePath(
      this.config.tasksProjectId!,
      this.config.tasksLocation!,
      this.config.tasksQueue!,
    );
    const httpRequest: {
      httpMethod: "POST";
      url: string;
      headers: Record<string, string>;
      body: Buffer;
      oidcToken?: { serviceAccountEmail: string };
    } = {
      httpMethod: "POST",
      url: this.config.workerUrl!,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify(payload), "utf8"),
    };
    if (this.config.tasksServiceAccountEmail) {
      httpRequest.oidcToken = {
        serviceAccountEmail: this.config.tasksServiceAccountEmail,
      };
    }

    const [response] = await this.client.createTask({
      parent,
      task: { httpRequest },
    });
    return response?.name || null;
  }
}

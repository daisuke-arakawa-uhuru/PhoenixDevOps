import { WorkerConfig } from "./config.js";
import { buildOrchestrator } from "./factories.js";
import { AnalysisTaskPayload, PayloadValidationError } from "./payload.js";
import { Request, Response } from "@google-cloud/functions-framework";

export async function runAnalysisWorker(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  let payload: AnalysisTaskPayload;
  try {
    payload = AnalysisTaskPayload.fromMapping(req.body);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      console.warn("Invalid analysis worker payload:", error.message);
      res.status(400).json({ error: "invalid_payload", message: error.message });
      return;
    }
    throw error;
  }

  const config = WorkerConfig.fromEnv(process.env);
  const orchestrator = buildOrchestrator(config);

  try {
    const result = await orchestrator.run(payload);
    res.status(200).json(result.toResponse());
  } catch (error) {
    console.error(`Analysis worker failed for job_id=${payload.jobId}`, error);
    res.status(500).json({
      jobId: payload.jobId,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

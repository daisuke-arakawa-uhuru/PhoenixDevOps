import { Hono, Context } from "hono";
import { cors } from "hono/cors";
import { ApiConfig } from "./config";
import { ApiError, ConfigError } from "./errors";
import { DriftApiService, buildService } from "./service";

type ServiceFactory = (c: Context) => DriftApiService;

export function createApp({ serviceFactory = null }: { serviceFactory?: ServiceFactory | null } = {}): Hono {
  const app = new Hono();
  const resolveService: ServiceFactory = serviceFactory || (() => buildService(ApiConfig.fromEnv()));

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 3600,
    }),
  );

  app.post("/upload", async (c) => {
    const service = resolveService(c);
    const formData = await c.req.formData();
    const sourceFile =
      formData.get("sourceArchive") || formData.get("source") || formData.get("source_archive");
    const documentFiles = [
      ...formData.getAll("documents"),
      ...formData.getAll("documents[]"),
      ...formData.getAll("document"),
    ].filter(isFormFile);
    const projectName = formData.get("projectName") || formData.get("project_name");

    return c.json(
      await service.createUpload(
        isFormFile(sourceFile) ? sourceFile : null,
        documentFiles,
        typeof projectName === "string" ? projectName : null,
      ),
      201,
    );
  });

  app.post("/jobs", async (c) => {
    const service = resolveService(c);
    const body = await readJsonObject(c);
    return c.json(await service.createJob(body), 201);
  });

  app.get("/jobs/:jobId/results", async (c) => {
    const service = resolveService(c);
    return c.json(await service.getResults(c.req.param("jobId")));
  });

  app.get("/jobs/:jobId", async (c) => {
    const service = resolveService(c);
    return c.json(await service.getJob(c.req.param("jobId")));
  });

  app.all("/upload", (c) => methodNotAllowed(c, "POST is required for /upload"));
  app.all("/jobs", (c) => methodNotAllowed(c, "POST is required for /jobs"));
  app.all("/jobs/:jobId/results", (c) => methodNotAllowed(c, "GET is required for job resources"));
  app.all("/jobs/:jobId", (c) => methodNotAllowed(c, "GET is required for job resources"));

  app.notFound((c) => {
    throw new ApiError(404, "not_found", `Route not found: ${new URL(c.req.url).pathname}`);
  });

  app.onError((error, c) => errorResponse(c, error));

  return app;
}

async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "JSON body is required");
  }
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "invalid_json", "JSON body must be an object");
  }
  return body as Record<string, unknown>;
}

function methodNotAllowed(c: Context, message: string): Response {
  return errorResponse(c, new ApiError(405, "method_not_allowed", message));
}

export function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof ApiError) {
    const payload: {
      error: string;
      message: string;
      details?: Record<string, unknown>;
    } = {
      error: error.code,
      message: error.message,
    };
    if (error.details && Object.keys(error.details).length > 0) {
      payload.details = error.details;
    }
    return c.json(payload, error.statusCode);
  }

  if (error instanceof ConfigError) {
    return c.json(
      {
        error: "configuration_error",
        message: error.message,
      },
      500,
    );
  }

  console.error("Unexpected drift API failure", error);
  return c.json(
    {
      error: "internal_error",
      message: "Unexpected API error",
    },
    500,
  );
}

function isFormFile(value: FormDataEntryValue | null): value is File {
  return !!value && typeof value !== "string";
}

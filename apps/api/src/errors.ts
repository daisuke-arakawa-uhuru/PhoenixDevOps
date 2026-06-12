import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ApiErrorDetails = Record<string, unknown>;

export class ApiError extends Error {
  readonly statusCode: ContentfulStatusCode;
  readonly code: string;
  readonly details: ApiErrorDetails;

  constructor(statusCode: ContentfulStatusCode, code: string, message: string, details: ApiErrorDetails = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

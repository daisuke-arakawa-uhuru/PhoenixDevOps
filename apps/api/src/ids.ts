import crypto from "node:crypto";

export function newUploadId(): string {
  return `upload-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function newJobId(): string {
  return `job-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

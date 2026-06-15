import { ApiError } from "./errors";

export class GcsUri {
  readonly bucket: string;
  readonly objectName: string;

  constructor(bucket: string, objectName: string) {
    this.bucket = bucket;
    this.objectName = objectName;
  }

  get uri(): string {
    return `gs://${this.bucket}/${this.objectName}`;
  }
}

export function parseGcsUri(value: unknown, fieldName = "uri"): GcsUri {
  if (typeof value !== "string" || !value.startsWith("gs://")) {
    throw new ApiError(400, "invalid_gcs_uri", `${fieldName} must be a gs:// URI`);
  }

  const rest = value.slice("gs://".length);
  const separatorIndex = rest.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === rest.length - 1) {
    throw new ApiError(400, "invalid_gcs_uri", `${fieldName} must be a full gs://bucket/object URI`);
  }

  return new GcsUri(rest.slice(0, separatorIndex), rest.slice(separatorIndex + 1));
}

export class PayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadValidationError";
  }
}

export class StorageObjectRef {
  constructor(public bucket: string, public objectName: string) {}

  static fromValue(value: unknown, fieldName: string): StorageObjectRef {
    if (typeof value === "string") {
      return StorageObjectRef.fromUri(value, fieldName);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const mapping = value as Record<string, unknown>;
      const bucket = readFirst(mapping, "bucket", "bucketName");
      const objectName = readFirst(mapping, "object", "objectName", "path", "name");
      if (!bucket || !objectName) {
        throw new PayloadValidationError(`${fieldName} must include bucket and object/objectName`);
      }
      return new StorageObjectRef(String(bucket), String(objectName));
    }
    throw new PayloadValidationError(`${fieldName} must be a gs:// URI or object reference`);
  }

  static fromUri(uri: string, fieldName: string): StorageObjectRef {
    if (!uri.startsWith("gs://")) {
      throw new PayloadValidationError(`${fieldName} must start with gs://`);
    }
    const rest = uri.slice("gs://".length);
    const separatorIndex = rest.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === rest.length - 1) {
      throw new PayloadValidationError(`${fieldName} must be a full gs://bucket/object URI`);
    }
    return new StorageObjectRef(rest.slice(0, separatorIndex), rest.slice(separatorIndex + 1));
  }

  get uri(): string {
    return `gs://${this.bucket}/${this.objectName}`;
  }
}

export class AnalysisTaskPayload {
  jobId: string;
  sourceArchive: StorageObjectRef;
  documents: readonly StorageObjectRef[];
  projectName: string | null;
  resultsPrefix: string | null;
  requestedBy: string | null;

  constructor({
    jobId,
    sourceArchive,
    documents,
    projectName = null,
    resultsPrefix = null,
    requestedBy = null,
  }: {
    jobId: string;
    sourceArchive: StorageObjectRef;
    documents: StorageObjectRef[];
    projectName?: string | null;
    resultsPrefix?: string | null;
    requestedBy?: string | null;
  }) {
    this.jobId = jobId;
    this.sourceArchive = sourceArchive;
    this.documents = Object.freeze([...documents]);
    this.projectName = projectName;
    this.resultsPrefix = resultsPrefix;
    this.requestedBy = requestedBy;
  }

  static fromMapping(raw: unknown): AnalysisTaskPayload {
    if (raw == null) {
      throw new PayloadValidationError("JSON body is required");
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new PayloadValidationError("JSON body must be an object");
    }

    const mapping = raw as Record<string, unknown>;

    const jobId = readFirst(mapping, "job_id", "jobId");
    if (!jobId) {
      throw new PayloadValidationError("job_id/jobId is required");
    }

    const sourceValue = readFirst(
      mapping,
      "source_archive",
      "sourceArchive",
      "source_archive_uri",
      "sourceArchiveUri",
    );
    if (!sourceValue) {
      throw new PayloadValidationError("source_archive/sourceArchiveUri is required");
    }

    const documentValues = readFirst(mapping, "documents", "documentUris", "document_uris");
    if (documentValues == null) {
      throw new PayloadValidationError("documents/documentUris is required");
    }
    if (!Array.isArray(documentValues)) {
      throw new PayloadValidationError("documents/documentUris must be an array");
    }
    if (documentValues.length === 0) {
      throw new PayloadValidationError("documents/documentUris must not be empty");
    }

    return new AnalysisTaskPayload({
      jobId: String(jobId),
      projectName: toOptionalString(readFirst(mapping, "project_name", "projectName")),
      sourceArchive: StorageObjectRef.fromValue(sourceValue, "source_archive"),
      documents: (documentValues as unknown[]).map((value, index) =>
        StorageObjectRef.fromValue(value, `documents[${index}]`),
      ),
      resultsPrefix: toOptionalString(readFirst(mapping, "results_prefix", "resultsPrefix")),
      requestedBy: toOptionalString(readFirst(mapping, "requested_by", "requestedBy")),
    });
  }
}

export function readFirst(mapping: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(mapping, key)) {
      return mapping[key];
    }
  }
  return undefined;
}

function toOptionalString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

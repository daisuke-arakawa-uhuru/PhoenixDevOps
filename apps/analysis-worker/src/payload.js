"use strict";

class PayloadValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PayloadValidationError";
  }
}

class StorageObjectRef {
  constructor(bucket, objectName) {
    this.bucket = bucket;
    this.objectName = objectName;
  }

  static fromValue(value, fieldName) {
    if (typeof value === "string") {
      return StorageObjectRef.fromUri(value, fieldName);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const bucket = readFirst(value, "bucket", "bucketName");
      const objectName = readFirst(value, "object", "objectName", "path", "name");
      if (!bucket || !objectName) {
        throw new PayloadValidationError(`${fieldName} must include bucket and object/objectName`);
      }
      return new StorageObjectRef(String(bucket), String(objectName));
    }
    throw new PayloadValidationError(`${fieldName} must be a gs:// URI or object reference`);
  }

  static fromUri(uri, fieldName) {
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

  get uri() {
    return `gs://${this.bucket}/${this.objectName}`;
  }
}

class AnalysisTaskPayload {
  constructor({
    jobId,
    sourceArchive,
    documents,
    projectName = null,
    resultsPrefix = null,
    requestedBy = null,
  }) {
    this.jobId = jobId;
    this.sourceArchive = sourceArchive;
    this.documents = Object.freeze([...documents]);
    this.projectName = projectName;
    this.resultsPrefix = resultsPrefix;
    this.requestedBy = requestedBy;
  }

  static fromMapping(raw) {
    if (raw == null) {
      throw new PayloadValidationError("JSON body is required");
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new PayloadValidationError("JSON body must be an object");
    }

    const jobId = readFirst(raw, "job_id", "jobId");
    if (!jobId) {
      throw new PayloadValidationError("job_id/jobId is required");
    }

    const sourceValue = readFirst(
      raw,
      "source_archive",
      "sourceArchive",
      "source_archive_uri",
      "sourceArchiveUri",
    );
    if (!sourceValue) {
      throw new PayloadValidationError("source_archive/sourceArchiveUri is required");
    }

    const documentValues = readFirst(raw, "documents", "documentUris", "document_uris");
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
      projectName: toOptionalString(readFirst(raw, "project_name", "projectName")),
      sourceArchive: StorageObjectRef.fromValue(sourceValue, "source_archive"),
      documents: documentValues.map((value, index) =>
        StorageObjectRef.fromValue(value, `documents[${index}]`),
      ),
      resultsPrefix: toOptionalString(readFirst(raw, "results_prefix", "resultsPrefix")),
      requestedBy: toOptionalString(readFirst(raw, "requested_by", "requestedBy")),
    });
  }
}

function readFirst(mapping, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(mapping, key)) {
      return mapping[key];
    }
  }
  return undefined;
}

function toOptionalString(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

module.exports = {
  AnalysisTaskPayload,
  PayloadValidationError,
  StorageObjectRef,
  readFirst,
};

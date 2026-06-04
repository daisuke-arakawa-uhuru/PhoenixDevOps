from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence, Tuple


class PayloadValidationError(ValueError):
    pass


@dataclass(frozen=True)
class StorageObjectRef:
    bucket: str
    object_name: str

    @classmethod
    def from_value(cls, value: Any, field_name: str) -> "StorageObjectRef":
        if isinstance(value, str):
            return cls.from_uri(value, field_name)
        if isinstance(value, Mapping):
            bucket = _read_first(value, "bucket", "bucketName")
            object_name = _read_first(value, "object", "objectName", "path", "name")
            if not bucket or not object_name:
                raise PayloadValidationError(
                    f"{field_name} must include bucket and object/objectName"
                )
            return cls(bucket=str(bucket), object_name=str(object_name))
        raise PayloadValidationError(f"{field_name} must be a gs:// URI or object reference")

    @classmethod
    def from_uri(cls, uri: str, field_name: str) -> "StorageObjectRef":
        if not uri.startswith("gs://"):
            raise PayloadValidationError(f"{field_name} must start with gs://")
        rest = uri[len("gs://") :]
        bucket, separator, object_name = rest.partition("/")
        if not bucket or not separator or not object_name:
            raise PayloadValidationError(f"{field_name} must be a full gs://bucket/object URI")
        return cls(bucket=bucket, object_name=object_name)

    @property
    def uri(self) -> str:
        return f"gs://{self.bucket}/{self.object_name}"


@dataclass(frozen=True)
class AnalysisTaskPayload:
    job_id: str
    source_archive: StorageObjectRef
    documents: Tuple[StorageObjectRef, ...]
    project_name: Optional[str] = None
    results_prefix: Optional[str] = None
    requested_by: Optional[str] = None

    @classmethod
    def from_mapping(cls, raw: Optional[Mapping[str, Any]]) -> "AnalysisTaskPayload":
        if raw is None:
            raise PayloadValidationError("JSON body is required")
        if not isinstance(raw, Mapping):
            raise PayloadValidationError("JSON body must be an object")

        job_id = _read_first(raw, "job_id", "jobId")
        if not job_id:
            raise PayloadValidationError("job_id/jobId is required")

        source_value = _read_first(
            raw,
            "source_archive",
            "sourceArchive",
            "source_archive_uri",
            "sourceArchiveUri",
        )
        if not source_value:
            raise PayloadValidationError("source_archive/sourceArchiveUri is required")

        document_values = _read_first(raw, "documents", "documentUris", "document_uris")
        if document_values is None:
            raise PayloadValidationError("documents/documentUris is required")
        if not isinstance(document_values, Sequence) or isinstance(document_values, (str, bytes)):
            raise PayloadValidationError("documents/documentUris must be an array")
        if not document_values:
            raise PayloadValidationError("documents/documentUris must not be empty")

        return cls(
            job_id=str(job_id),
            project_name=_to_optional_string(_read_first(raw, "project_name", "projectName")),
            source_archive=StorageObjectRef.from_value(source_value, "source_archive"),
            documents=tuple(
                StorageObjectRef.from_value(value, f"documents[{index}]")
                for index, value in enumerate(document_values)
            ),
            results_prefix=_to_optional_string(_read_first(raw, "results_prefix", "resultsPrefix")),
            requested_by=_to_optional_string(_read_first(raw, "requested_by", "requestedBy")),
        )


def _read_first(mapping: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _to_optional_string(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None

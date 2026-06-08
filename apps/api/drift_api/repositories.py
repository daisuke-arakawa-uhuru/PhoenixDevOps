from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional, Sequence


@dataclass(frozen=True)
class UploadRecord:
    upload_id: str
    source_archive_uri: str
    document_uris: Sequence[str]
    project_name: Optional[str] = None
    source_file_name: Optional[str] = None
    document_file_names: Sequence[str] = field(default_factory=tuple)


@dataclass(frozen=True)
class JobRecord:
    job_id: str
    status: str
    source_archive_uri: str
    document_uris: Sequence[str]
    results_prefix: str
    upload_id: Optional[str] = None
    project_name: Optional[str] = None
    artifact_paths: Dict[str, str] = field(default_factory=dict)
    error_message: Optional[str] = None


class FirestoreUploadRepository:
    def __init__(self, collection_name: str, firestore_client=None) -> None:
        if firestore_client is None:
            from google.cloud import firestore

            firestore_client = firestore.Client()
            self._server_timestamp = firestore.SERVER_TIMESTAMP
        else:
            self._server_timestamp = getattr(firestore_client, "SERVER_TIMESTAMP", None)
        self._collection = firestore_client.collection(collection_name)

    def create(self, record: UploadRecord) -> None:
        self._collection.document(record.upload_id).set(
            {
                "upload_id": record.upload_id,
                "source_archive_uri": record.source_archive_uri,
                "document_uris": list(record.document_uris),
                "project_name": record.project_name,
                "source_file_name": record.source_file_name,
                "document_file_names": list(record.document_file_names),
                "created_at": self._server_timestamp,
            }
        )

    def get(self, upload_id: str) -> Optional[UploadRecord]:
        snapshot = self._collection.document(upload_id).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict() or {}
        return UploadRecord(
            upload_id=upload_id,
            source_archive_uri=str(data.get("source_archive_uri") or data.get("sourceArchiveUri") or ""),
            document_uris=tuple(data.get("document_uris") or data.get("documentUris") or ()),
            project_name=data.get("project_name") or data.get("projectName"),
            source_file_name=data.get("source_file_name") or data.get("sourceFileName"),
            document_file_names=tuple(
                data.get("document_file_names") or data.get("documentFileNames") or ()
            ),
        )


class FirestoreJobRepository:
    def __init__(self, collection_name: str, firestore_client=None) -> None:
        if firestore_client is None:
            from google.cloud import firestore

            firestore_client = firestore.Client()
            self._server_timestamp = firestore.SERVER_TIMESTAMP
        else:
            self._server_timestamp = getattr(firestore_client, "SERVER_TIMESTAMP", None)
        self._collection = firestore_client.collection(collection_name)

    def create_queued(self, record: JobRecord) -> None:
        self._collection.document(record.job_id).set(
            {
                "job_id": record.job_id,
                "upload_id": record.upload_id,
                "project_name": record.project_name,
                "source_archive_uri": record.source_archive_uri,
                "document_uris": list(record.document_uris),
                "results_prefix": record.results_prefix,
                "status": "queued",
                "artifact_paths": {},
                "error_message": None,
                "created_at": self._server_timestamp,
                "updated_at": self._server_timestamp,
            }
        )

    def mark_failed(self, job_id: str, error_message: str) -> None:
        self._collection.document(job_id).set(
            {
                "status": "failed",
                "error_message": error_message,
                "updated_at": self._server_timestamp,
            },
            merge=True,
        )

    def get(self, job_id: str) -> Optional[JobRecord]:
        snapshot = self._collection.document(job_id).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict() or {}
        return JobRecord(
            job_id=job_id,
            status=str(data.get("status", "")),
            upload_id=data.get("upload_id") or data.get("uploadId"),
            project_name=data.get("project_name") or data.get("projectName"),
            source_archive_uri=str(data.get("source_archive_uri") or data.get("sourceArchiveUri") or ""),
            document_uris=tuple(data.get("document_uris") or data.get("documentUris") or ()),
            results_prefix=str(data.get("results_prefix") or data.get("resultsPrefix") or ""),
            artifact_paths=dict(data.get("artifact_paths") or data.get("artifactPaths") or {}),
            error_message=data.get("error_message") or data.get("errorMessage"),
        )


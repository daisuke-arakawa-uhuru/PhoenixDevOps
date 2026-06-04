from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, Optional, Protocol


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(frozen=True)
class JobRecord:
    job_id: str
    status: str
    artifact_paths: Dict[str, str] = field(default_factory=dict)
    error_message: Optional[str] = None


class JobRepository(Protocol):
    def get(self, job_id: str) -> Optional[JobRecord]:
        ...

    def mark_running(self, job_id: str) -> None:
        ...

    def mark_succeeded(self, job_id: str, artifact_paths: Dict[str, str]) -> None:
        ...

    def mark_failed(self, job_id: str, error_message: str) -> None:
        ...


class FirestoreJobRepository:
    def __init__(self, collection_name: str) -> None:
        from google.cloud import firestore

        self._firestore = firestore
        self._client = firestore.Client()
        self._collection = self._client.collection(collection_name)

    def get(self, job_id: str) -> Optional[JobRecord]:
        snapshot = self._collection.document(job_id).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict() or {}
        return JobRecord(
            job_id=job_id,
            status=str(data.get("status", "")),
            artifact_paths=dict(data.get("artifact_paths") or data.get("artifactPaths") or {}),
            error_message=data.get("error_message") or data.get("errorMessage"),
        )

    def mark_running(self, job_id: str) -> None:
        self._collection.document(job_id).set(
            {
                "status": JobStatus.RUNNING.value,
                "updated_at": self._firestore.SERVER_TIMESTAMP,
                "error_message": None,
            },
            merge=True,
        )

    def mark_succeeded(self, job_id: str, artifact_paths: Dict[str, str]) -> None:
        self._collection.document(job_id).set(
            {
                "status": JobStatus.SUCCEEDED.value,
                "artifact_paths": artifact_paths,
                "updated_at": self._firestore.SERVER_TIMESTAMP,
                "error_message": None,
            },
            merge=True,
        )

    def mark_failed(self, job_id: str, error_message: str) -> None:
        self._collection.document(job_id).set(
            {
                "status": JobStatus.FAILED.value,
                "updated_at": self._firestore.SERVER_TIMESTAMP,
                "error_message": error_message,
            },
            merge=True,
        )


class InMemoryJobRepository:
    def __init__(self) -> None:
        self.records: Dict[str, JobRecord] = {}
        self.transitions: Dict[str, str] = {}

    def get(self, job_id: str) -> Optional[JobRecord]:
        return self.records.get(job_id)

    def mark_running(self, job_id: str) -> None:
        self.transitions[job_id] = JobStatus.RUNNING.value
        self.records[job_id] = JobRecord(job_id=job_id, status=JobStatus.RUNNING.value)

    def mark_succeeded(self, job_id: str, artifact_paths: Dict[str, str]) -> None:
        self.transitions[job_id] = JobStatus.SUCCEEDED.value
        self.records[job_id] = JobRecord(
            job_id=job_id,
            status=JobStatus.SUCCEEDED.value,
            artifact_paths=artifact_paths,
        )

    def mark_failed(self, job_id: str, error_message: str) -> None:
        self.transitions[job_id] = JobStatus.FAILED.value
        self.records[job_id] = JobRecord(
            job_id=job_id,
            status=JobStatus.FAILED.value,
            error_message=error_message,
        )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

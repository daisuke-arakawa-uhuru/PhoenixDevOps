from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from drift_api.errors import ConfigError


@dataclass(frozen=True)
class ApiConfig:
    uploads_bucket: str
    firestore_uploads_collection: str = "uploads"
    firestore_jobs_collection: str = "jobs"
    tasks_project_id: Optional[str] = None
    tasks_location: Optional[str] = None
    tasks_queue: Optional[str] = None
    worker_url: Optional[str] = None
    tasks_service_account_email: Optional[str] = None
    signed_url_expiration_seconds: int = 3600
    uploads_prefix_template: str = "uploads/{upload_id}"
    results_prefix_template: str = "results/{job_id}"
    max_document_files: int = 600

    @classmethod
    def from_env(cls) -> "ApiConfig":
        uploads_bucket = os.getenv("UPLOADS_BUCKET") or os.getenv("STORAGE_BUCKET")
        if not uploads_bucket:
            raise ConfigError("UPLOADS_BUCKET is required")

        return cls(
            uploads_bucket=uploads_bucket,
            firestore_uploads_collection=os.getenv("FIRESTORE_UPLOADS_COLLECTION", "uploads"),
            firestore_jobs_collection=os.getenv("FIRESTORE_JOBS_COLLECTION", "jobs"),
            tasks_project_id=(
                os.getenv("TASKS_PROJECT_ID")
                or os.getenv("GOOGLE_CLOUD_PROJECT")
                or os.getenv("GCP_PROJECT")
            ),
            tasks_location=os.getenv("TASKS_LOCATION"),
            tasks_queue=os.getenv("TASKS_QUEUE"),
            worker_url=os.getenv("WORKER_URL"),
            tasks_service_account_email=os.getenv("TASKS_SERVICE_ACCOUNT_EMAIL"),
            signed_url_expiration_seconds=_read_int_env(
                "SIGNED_URL_EXPIRATION_SECONDS",
                3600,
            ),
            uploads_prefix_template=os.getenv(
                "UPLOADS_PREFIX_TEMPLATE",
                "uploads/{upload_id}",
            ),
            results_prefix_template=os.getenv(
                "RESULTS_PREFIX_TEMPLATE",
                "results/{job_id}",
            ),
            max_document_files=_read_int_env("MAX_DOCUMENT_FILES", 600),
        )

    def require_tasks_config(self) -> None:
        missing = [
            name
            for name, value in (
                ("TASKS_PROJECT_ID or GOOGLE_CLOUD_PROJECT", self.tasks_project_id),
                ("TASKS_LOCATION", self.tasks_location),
                ("TASKS_QUEUE", self.tasks_queue),
                ("WORKER_URL", self.worker_url),
            )
            if not value
        ]
        if missing:
            raise ConfigError(f"Missing Cloud Tasks configuration: {', '.join(missing)}")


def _read_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None or raw_value == "":
        return default
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc
    if value <= 0:
        raise ConfigError(f"{name} must be greater than zero")
    return value


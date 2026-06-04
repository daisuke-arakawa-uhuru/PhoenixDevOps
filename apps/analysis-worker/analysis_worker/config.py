from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class WorkerConfig:
    firestore_jobs_collection: str = "jobs"
    results_bucket: Optional[str] = None
    results_prefix_template: str = "results/{job_id}"
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-2.0-flash"
    gemini_dry_run: bool = False

    @classmethod
    def from_env(cls) -> "WorkerConfig":
        return cls(
            firestore_jobs_collection=os.getenv("FIRESTORE_JOBS_COLLECTION", "jobs"),
            results_bucket=os.getenv("RESULTS_BUCKET"),
            results_prefix_template=os.getenv("RESULTS_PREFIX_TEMPLATE", "results/{job_id}"),
            gemini_api_key=os.getenv("GEMINI_API_KEY"),
            gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
            gemini_dry_run=os.getenv("GEMINI_DRY_RUN", "").lower() in {"1", "true", "yes"},
        )

from __future__ import annotations

import uuid


def new_upload_id() -> str:
    return f"upload-{uuid.uuid4().hex[:16]}"


def new_job_id() -> str:
    return f"job-{uuid.uuid4().hex[:16]}"


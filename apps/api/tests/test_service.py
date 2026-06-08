from __future__ import annotations

import unittest

from drift_api.config import ApiConfig
from drift_api.errors import ApiError
from drift_api.repositories import JobRecord, UploadRecord
from drift_api.service import DriftApiService


class FakeUploadRepository:
    def __init__(self) -> None:
        self.records = {}

    def create(self, record: UploadRecord) -> None:
        self.records[record.upload_id] = record

    def get(self, upload_id: str):
        return self.records.get(upload_id)


class FakeJobRepository:
    def __init__(self) -> None:
        self.records = {}
        self.failed = {}

    def create_queued(self, record: JobRecord) -> None:
        self.records[record.job_id] = record

    def mark_failed(self, job_id: str, error_message: str) -> None:
        self.failed[job_id] = error_message
        current = self.records[job_id]
        self.records[job_id] = JobRecord(
            job_id=current.job_id,
            upload_id=current.upload_id,
            project_name=current.project_name,
            source_archive_uri=current.source_archive_uri,
            document_uris=current.document_uris,
            results_prefix=current.results_prefix,
            status="failed",
            error_message=error_message,
        )

    def get(self, job_id: str):
        return self.records.get(job_id)


class FakeStorageService:
    def __init__(self) -> None:
        self.signed_url_calls = []

    def signed_url(self, uri: str, expiration_seconds: int) -> str:
        self.signed_url_calls.append((uri, expiration_seconds))
        return f"https://signed.example/{uri.removeprefix('gs://')}"


class FakeTasks:
    def __init__(self) -> None:
        self.payloads = []

    def enqueue_analysis_task(self, payload):
        self.payloads.append(payload)
        return "task-name-1"


class FailingTasks:
    def enqueue_analysis_task(self, payload):
        raise RuntimeError("queue unavailable")


class DriftApiServiceTest(unittest.TestCase):
    def test_create_job_from_upload_enqueues_worker_payload(self):
        uploads = FakeUploadRepository()
        uploads.create(
            UploadRecord(
                upload_id="upload-123",
                project_name="Legacy SaaS",
                source_archive_uri="gs://uploads/uploads/upload-123/source/source.zip",
                document_uris=("gs://uploads/uploads/upload-123/documents/spec.md",),
            )
        )
        jobs = FakeJobRepository()
        tasks = FakeTasks()
        service = _service(uploads=uploads, jobs=jobs, tasks=tasks)

        response = service.create_job({"uploadId": "upload-123"})

        job_id = response["jobId"]
        self.assertEqual(response["status"], "queued")
        self.assertEqual(response["uploadId"], "upload-123")
        self.assertEqual(jobs.records[job_id].project_name, "Legacy SaaS")
        self.assertEqual(
            tasks.payloads[0],
            {
                "jobId": job_id,
                "sourceArchiveUri": "gs://uploads/uploads/upload-123/source/source.zip",
                "documentUris": ["gs://uploads/uploads/upload-123/documents/spec.md"],
                "resultsPrefix": f"results/{job_id}",
                "projectName": "Legacy SaaS",
            },
        )

    def test_create_job_accepts_direct_gcs_references(self):
        jobs = FakeJobRepository()
        tasks = FakeTasks()
        service = _service(jobs=jobs, tasks=tasks)

        response = service.create_job(
            {
                "projectName": "Direct",
                "sourceArchiveUri": "gs://uploads/source.zip",
                "documentUris": ["gs://uploads/spec.md"],
            }
        )

        self.assertEqual(response["status"], "queued")
        self.assertEqual(response["projectName"], "Direct")
        self.assertEqual(tasks.payloads[0]["sourceArchiveUri"], "gs://uploads/source.zip")

    def test_create_job_marks_failed_when_task_enqueue_fails(self):
        uploads = FakeUploadRepository()
        uploads.create(
            UploadRecord(
                upload_id="upload-123",
                source_archive_uri="gs://uploads/source.zip",
                document_uris=("gs://uploads/spec.md",),
            )
        )
        jobs = FakeJobRepository()
        service = _service(uploads=uploads, jobs=jobs, tasks=FailingTasks())

        with self.assertRaisesRegex(RuntimeError, "queue unavailable"):
            service.create_job({"uploadId": "upload-123"})

        job_id = next(iter(jobs.records))
        self.assertEqual(jobs.records[job_id].status, "failed")

    def test_get_results_requires_succeeded_job(self):
        jobs = FakeJobRepository()
        jobs.records["job-123"] = JobRecord(
            job_id="job-123",
            status="running",
            source_archive_uri="gs://uploads/source.zip",
            document_uris=("gs://uploads/spec.md",),
            results_prefix="results/job-123",
        )
        service = _service(jobs=jobs)

        with self.assertRaisesRegex(ApiError, "available only after"):
            service.get_results("job-123")

    def test_get_results_returns_signed_artifact_urls(self):
        jobs = FakeJobRepository()
        jobs.records["job-123"] = JobRecord(
            job_id="job-123",
            status="succeeded",
            source_archive_uri="gs://uploads/source.zip",
            document_uris=("gs://uploads/spec.md",),
            results_prefix="results/job-123",
            artifact_paths={
                "true-design.md": "gs://uploads/results/job-123/true-design.md",
                "document-drift-report.md": "gs://uploads/results/job-123/document-drift-report.md",
            },
        )
        storage = FakeStorageService()
        service = _service(jobs=jobs, storage=storage)

        response = service.get_results("job-123")

        self.assertEqual(response["status"], "succeeded")
        self.assertEqual(len(response["artifacts"]), 2)
        self.assertEqual(response["expiresIn"], 600)
        self.assertEqual(
            storage.signed_url_calls[0],
            ("gs://uploads/results/job-123/document-drift-report.md", 600),
        )


def _service(
    uploads=None,
    jobs=None,
    storage=None,
    tasks=None,
) -> DriftApiService:
    return DriftApiService(
        config=ApiConfig(
            uploads_bucket="uploads",
            tasks_project_id="project",
            tasks_location="asia-northeast1",
            tasks_queue="analysis",
            worker_url="https://worker.example",
            signed_url_expiration_seconds=600,
        ),
        storage_service=storage or FakeStorageService(),
        upload_repository=uploads or FakeUploadRepository(),
        job_repository=jobs or FakeJobRepository(),
        task_enqueuer=tasks or FakeTasks(),
    )


if __name__ == "__main__":
    unittest.main()


from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Dict, Optional

from drift_api.config import ApiConfig
from drift_api.errors import ApiError
from drift_api.gcs import parse_gcs_uri
from drift_api.ids import new_job_id, new_upload_id
from drift_api.repositories import (
    FirestoreJobRepository,
    FirestoreUploadRepository,
    JobRecord,
    UploadRecord,
)
from drift_api.storage import StorageService
from drift_api.tasks import CloudTasksEnqueuer


class DriftApiService:
    def __init__(
        self,
        config: ApiConfig,
        storage_service: StorageService,
        upload_repository: FirestoreUploadRepository,
        job_repository: FirestoreJobRepository,
        task_enqueuer: CloudTasksEnqueuer,
    ) -> None:
        self._config = config
        self._storage = storage_service
        self._uploads = upload_repository
        self._jobs = job_repository
        self._tasks = task_enqueuer

    def create_upload(
        self,
        source_file,
        document_files: Sequence[object],
        project_name: Optional[str] = None,
    ) -> Dict[str, object]:
        upload_id = new_upload_id()
        stored_bundle = self._storage.upload_bundle(
            upload_id,
            source_file,
            document_files,
            max_document_files=self._config.max_document_files,
        )
        record = UploadRecord(
            upload_id=upload_id,
            source_archive_uri=stored_bundle.source.uri,
            document_uris=tuple(document.uri for document in stored_bundle.documents),
            project_name=_optional_text(project_name),
            source_file_name=stored_bundle.source.original_filename,
            document_file_names=tuple(
                document.original_filename for document in stored_bundle.documents
            ),
        )
        self._uploads.create(record)
        return _upload_response(record)

    def create_job(self, raw_body: Mapping[str, object]) -> Dict[str, object]:
        upload_id = _optional_text(_read_first(raw_body, "uploadId", "upload_id"))
        upload_record: Optional[UploadRecord] = None
        if upload_id:
            upload_record = self._uploads.get(upload_id)
            if upload_record is None:
                raise ApiError(404, "upload_not_found", f"Upload not found: {upload_id}")

        source_archive_uri = _optional_text(
            _read_first(raw_body, "sourceArchiveUri", "source_archive_uri")
        )
        document_uris = _read_first(raw_body, "documentUris", "document_uris", "documents")
        project_name = _optional_text(_read_first(raw_body, "projectName", "project_name"))
        requested_by = _optional_text(_read_first(raw_body, "requestedBy", "requested_by"))

        if upload_record is not None:
            source_archive_uri = source_archive_uri or upload_record.source_archive_uri
            document_uris = document_uris if document_uris is not None else upload_record.document_uris
            project_name = project_name or upload_record.project_name

        if not source_archive_uri:
            raise ApiError(400, "missing_source_archive", "sourceArchiveUri or uploadId is required")
        parse_gcs_uri(source_archive_uri, "sourceArchiveUri")

        normalized_document_uris = _normalize_document_uris(document_uris)
        for index, document_uri in enumerate(normalized_document_uris):
            parse_gcs_uri(document_uri, f"documentUris[{index}]")

        job_id = new_job_id()
        results_prefix = self._config.results_prefix_template.format(job_id=job_id).strip("/")
        record = JobRecord(
            job_id=job_id,
            upload_id=upload_id,
            project_name=project_name,
            source_archive_uri=source_archive_uri,
            document_uris=normalized_document_uris,
            results_prefix=results_prefix,
            status="queued",
        )
        self._jobs.create_queued(record)

        task_payload = {
            "jobId": job_id,
            "sourceArchiveUri": source_archive_uri,
            "documentUris": list(normalized_document_uris),
            "resultsPrefix": results_prefix,
        }
        if project_name:
            task_payload["projectName"] = project_name
        if requested_by:
            task_payload["requestedBy"] = requested_by

        try:
            task_name = self._tasks.enqueue_analysis_task(task_payload)
        except Exception as exc:
            self._jobs.mark_failed(job_id, str(exc))
            raise

        response = _job_response(record)
        if task_name:
            response["taskName"] = task_name
        return response

    def get_job(self, job_id: str) -> Dict[str, object]:
        record = self._jobs.get(job_id)
        if record is None:
            raise ApiError(404, "job_not_found", f"Job not found: {job_id}")
        return _job_response(record)

    def get_results(self, job_id: str) -> Dict[str, object]:
        record = self._jobs.get(job_id)
        if record is None:
            raise ApiError(404, "job_not_found", f"Job not found: {job_id}")
        if record.status != "succeeded":
            raise ApiError(
                409,
                "job_not_succeeded",
                "Job results are available only after the job succeeds",
                {"status": record.status},
            )
        if not record.artifact_paths:
            raise ApiError(404, "results_not_found", f"No artifacts found for job: {job_id}")

        artifacts = []
        for name, uri in sorted(record.artifact_paths.items()):
            parse_gcs_uri(uri, f"artifactPaths.{name}")
            artifacts.append(
                {
                    "name": name,
                    "uri": uri,
                    "url": self._storage.signed_url(
                        uri,
                        self._config.signed_url_expiration_seconds,
                    ),
                }
            )

        return {
            "jobId": record.job_id,
            "status": record.status,
            "expiresIn": self._config.signed_url_expiration_seconds,
            "artifacts": artifacts,
        }


def build_service(config: ApiConfig) -> DriftApiService:
    storage_service = StorageService(
        config.uploads_bucket,
        uploads_prefix_template=config.uploads_prefix_template,
    )
    return DriftApiService(
        config=config,
        storage_service=storage_service,
        upload_repository=FirestoreUploadRepository(config.firestore_uploads_collection),
        job_repository=FirestoreJobRepository(config.firestore_jobs_collection),
        task_enqueuer=CloudTasksEnqueuer(config),
    )


def _upload_response(record: UploadRecord) -> Dict[str, object]:
    response: Dict[str, object] = {
        "uploadId": record.upload_id,
        "sourceArchiveUri": record.source_archive_uri,
        "documentUris": list(record.document_uris),
    }
    if record.project_name:
        response["projectName"] = record.project_name
    return response


def _job_response(record: JobRecord) -> Dict[str, object]:
    response: Dict[str, object] = {
        "jobId": record.job_id,
        "status": record.status,
        "sourceArchiveUri": record.source_archive_uri,
        "documentUris": list(record.document_uris),
        "resultsPrefix": record.results_prefix,
    }
    if record.upload_id:
        response["uploadId"] = record.upload_id
    if record.project_name:
        response["projectName"] = record.project_name
    if record.artifact_paths:
        response["artifactPaths"] = record.artifact_paths
    if record.error_message:
        response["errorMessage"] = record.error_message
    return response


def _normalize_document_uris(value: object) -> Sequence[str]:
    if value is None:
        raise ApiError(400, "missing_documents", "documentUris or uploadId is required")
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ApiError(400, "invalid_documents", "documentUris must be an array")
    if not value:
        raise ApiError(400, "missing_documents", "documentUris must not be empty")
    return tuple(str(item) for item in value)


def _read_first(mapping: Mapping[str, object], *keys: str) -> object:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _optional_text(value: object) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None

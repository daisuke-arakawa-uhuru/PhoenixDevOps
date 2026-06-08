from __future__ import annotations

import logging

import functions_framework

from drift_api.config import ApiConfig
from drift_api.errors import ApiError, ConfigError
from drift_api.http import empty_response, error_response, json_response
from drift_api.service import build_service


logger = logging.getLogger(__name__)


@functions_framework.http
def drift_api(request):
    if request.method == "OPTIONS":
        return empty_response()

    try:
        service = build_service(ApiConfig.from_env())
        return _dispatch(request, service)
    except (ApiError, ConfigError) as exc:
        return error_response(exc)
    except Exception as exc:
        logger.exception("Unexpected drift API failure")
        return error_response(exc)


def _dispatch(request, service):
    path = _normalized_path(request.path)

    if path == "/upload":
        if request.method != "POST":
            raise ApiError(405, "method_not_allowed", "POST is required for /upload")
        source_file = (
            request.files.get("sourceArchive")
            or request.files.get("source")
            or request.files.get("source_archive")
        )
        document_files = (
            request.files.getlist("documents")
            or request.files.getlist("documents[]")
            or request.files.getlist("document")
        )
        project_name = request.form.get("projectName") or request.form.get("project_name")
        return json_response(
            service.create_upload(source_file, document_files, project_name=project_name),
            201,
        )

    if path == "/jobs":
        if request.method != "POST":
            raise ApiError(405, "method_not_allowed", "POST is required for /jobs")
        body = request.get_json(silent=True)
        if body is None:
            raise ApiError(400, "invalid_json", "JSON body is required")
        if not isinstance(body, dict):
            raise ApiError(400, "invalid_json", "JSON body must be an object")
        return json_response(service.create_job(body), 201)

    job_status_match = _match_job_path(path)
    if job_status_match and request.method == "GET":
        job_id, suffix = job_status_match
        if suffix == "":
            return json_response(service.get_job(job_id))
        if suffix == "/results":
            return json_response(service.get_results(job_id))

    if job_status_match:
        raise ApiError(405, "method_not_allowed", "GET is required for job resources")

    raise ApiError(404, "not_found", f"Route not found: {path}")


def _normalized_path(path: str) -> str:
    if not path:
        return "/"
    normalized = path.rstrip("/")
    return normalized or "/"


def _match_job_path(path: str):
    parts = path.strip("/").split("/")
    if len(parts) == 2 and parts[0] == "jobs" and parts[1]:
        return parts[1], ""
    if len(parts) == 3 and parts[0] == "jobs" and parts[1] and parts[2] == "results":
        return parts[1], "/results"
    return None


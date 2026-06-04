from __future__ import annotations

import logging

import functions_framework
from flask import jsonify

from analysis_worker.config import WorkerConfig
from analysis_worker.factories import build_orchestrator
from analysis_worker.payload import AnalysisTaskPayload, PayloadValidationError


logger = logging.getLogger(__name__)


@functions_framework.http
def run_analysis_worker(request):
    if request.method != "POST":
        return jsonify({"error": "method_not_allowed"}), 405

    try:
        payload = AnalysisTaskPayload.from_mapping(request.get_json(silent=True))
    except PayloadValidationError as exc:
        logger.warning("Invalid analysis worker payload: %s", exc)
        return jsonify({"error": "invalid_payload", "message": str(exc)}), 400

    config = WorkerConfig.from_env()
    orchestrator = build_orchestrator(config)

    try:
        result = orchestrator.run(payload)
    except Exception as exc:
        logger.exception("Analysis worker failed for job_id=%s", payload.job_id)
        return jsonify({"jobId": payload.job_id, "status": "failed", "message": str(exc)}), 500

    return jsonify(result.to_response()), 200

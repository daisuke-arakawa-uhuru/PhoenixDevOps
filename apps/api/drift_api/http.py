from __future__ import annotations

from typing import Dict, Tuple

from flask import jsonify

from drift_api.errors import ApiError, ConfigError


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "3600",
}


def json_response(payload: Dict[str, object], status_code: int = 200) -> Tuple[object, int, Dict[str, str]]:
    return jsonify(payload), status_code, CORS_HEADERS


def empty_response(status_code: int = 204) -> Tuple[str, int, Dict[str, str]]:
    return "", status_code, CORS_HEADERS


def error_response(exc: Exception) -> Tuple[object, int, Dict[str, str]]:
    if isinstance(exc, ApiError):
        payload: Dict[str, object] = {
            "error": exc.code,
            "message": exc.message,
        }
        if exc.details:
            payload["details"] = exc.details
        return json_response(payload, exc.status_code)

    if isinstance(exc, ConfigError):
        return json_response(
            {
                "error": "configuration_error",
                "message": str(exc),
            },
            500,
        )

    return json_response(
        {
            "error": "internal_error",
            "message": "Unexpected API error",
        },
        500,
    )


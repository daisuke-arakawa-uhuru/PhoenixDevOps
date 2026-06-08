from __future__ import annotations

import json
from typing import Dict, Optional

from drift_api.config import ApiConfig


class CloudTasksEnqueuer:
    def __init__(self, config: ApiConfig, tasks_client=None) -> None:
        self._config = config
        self._tasks_v2 = None
        if tasks_client is None:
            from google.cloud import tasks_v2

            tasks_client = tasks_v2.CloudTasksClient()
            self._tasks_v2 = tasks_v2
        self._client = tasks_client

    def enqueue_analysis_task(self, payload: Dict[str, object]) -> Optional[str]:
        self._config.require_tasks_config()
        parent = self._client.queue_path(
            self._config.tasks_project_id,
            self._config.tasks_location,
            self._config.tasks_queue,
        )
        http_request = {
            "http_method": self._http_post_method(),
            "url": self._config.worker_url,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        }
        if self._config.tasks_service_account_email:
            http_request["oidc_token"] = {
                "service_account_email": self._config.tasks_service_account_email,
            }

        response = self._client.create_task(
            request={
                "parent": parent,
                "task": {"http_request": http_request},
            }
        )
        return getattr(response, "name", None)

    def _http_post_method(self):
        if self._tasks_v2 is None:
            return "POST"
        return self._tasks_v2.HttpMethod.POST


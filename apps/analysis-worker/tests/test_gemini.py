from __future__ import annotations

import unittest

from analysis_worker.gemini import DryRunGeminiClient, GeminiSettings, build_gemini_client


class DryRunGeminiClientTest(unittest.TestCase):
    def test_builds_dry_run_client_without_api_key(self):
        client = build_gemini_client(
            GeminiSettings(
                api_key=None,
                model="gemini-test",
                dry_run=False,
            )
        )

        self.assertIsInstance(client, DryRunGeminiClient)

    def test_returns_task_specific_response(self):
        client = DryRunGeminiClient()

        response = client.generate("[TASK: TRUE_DESIGN]\nbody")

        self.assertIn("真の設計書", response)
        self.assertIn("dry-run", response)


if __name__ == "__main__":
    unittest.main()

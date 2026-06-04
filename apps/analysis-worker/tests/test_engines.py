from __future__ import annotations

import unittest

from analysis_worker.engines import (
    GeminiDocumentExtractionEngine,
    GeminiSourceCodeAnalysisEngine,
)
from analysis_worker.payload import AnalysisTaskPayload
from analysis_worker.storage import InputBundle, TextFile


class RecordingGeminiClient:
    def __init__(self, response: str = "gemini response") -> None:
        self.response = response
        self.prompts = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.response


def build_payload() -> AnalysisTaskPayload:
    return AnalysisTaskPayload.from_mapping(
        {
            "jobId": "job-123",
            "projectName": "Legacy SaaS",
            "sourceArchiveUri": "gs://uploads/source.zip",
            "documentUris": ["gs://uploads/spec.md"],
        }
    )


class GeminiSourceCodeAnalysisEngineTest(unittest.TestCase):
    def test_adds_static_source_overview_to_prompt_and_summary(self):
        client = RecordingGeminiClient()
        inputs = InputBundle(
            source_archive_uri="gs://uploads/source.zip",
            document_uris=("gs://uploads/spec.md",),
            source_files=(
                TextFile(
                    path="package.json",
                    content='{"dependencies":{"fastapi":"^0.1.0"}}',
                ),
                TextFile(
                    path="app.py",
                    content='@app.get("/health")\ndef health():\n    return {"ok": True}\n',
                ),
                TextFile(
                    path="schema.sql",
                    content="CREATE TABLE users (id integer primary key);",
                ),
                TextFile(
                    path="tests/test_routes.py",
                    content='@app.get("/test-only")\nCREATE TABLE fake (id integer);',
                ),
                TextFile(path="README.md", content="# Service\n"),
            ),
        )

        specification = GeminiSourceCodeAnalysisEngine(client).extract(build_payload(), inputs)

        self.assertIn("## 事前抽出済みの構造情報", client.prompts[0])
        self.assertIn("fastapi", specification.summary)
        self.assertIn("/health", specification.summary)
        self.assertNotIn("/test-only", specification.summary)
        self.assertIn("users", specification.summary)
        self.assertEqual(
            specification.extracted_items["static_overview"]["api_routes"][0]["path"],
            "/health",
        )


class GeminiDocumentExtractionEngineTest(unittest.TestCase):
    def test_adds_document_overview_to_prompt_and_summary(self):
        client = RecordingGeminiClient()
        inputs = InputBundle(
            source_archive_uri="gs://uploads/source.zip",
            document_uris=("gs://uploads/spec.md",),
            document_files=(TextFile(path="spec.md", content="# Spec\n"),),
        )

        specification = GeminiDocumentExtractionEngine(client).extract(build_payload(), inputs)

        self.assertIn("## 事前抽出済みのドキュメント情報", client.prompts[0])
        self.assertIn("読み込み済み本文ファイル数: 1", specification.summary)
        self.assertEqual(
            specification.extracted_items["document_overview"]["document_file_paths"],
            ["spec.md"],
        )


if __name__ == "__main__":
    unittest.main()

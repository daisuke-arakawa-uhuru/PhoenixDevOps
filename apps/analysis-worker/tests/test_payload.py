from __future__ import annotations

import unittest

from analysis_worker.payload import AnalysisTaskPayload, PayloadValidationError, StorageObjectRef


class StorageObjectRefTest(unittest.TestCase):
    def test_from_uri(self):
        ref = StorageObjectRef.from_value("gs://bucket/path/to/file.zip", "source")

        self.assertEqual(ref.bucket, "bucket")
        self.assertEqual(ref.object_name, "path/to/file.zip")
        self.assertEqual(ref.uri, "gs://bucket/path/to/file.zip")

    def test_from_object_reference(self):
        ref = StorageObjectRef.from_value(
            {"bucket": "bucket", "objectName": "path/to/file.zip"},
            "source",
        )

        self.assertEqual(ref.uri, "gs://bucket/path/to/file.zip")

    def test_rejects_non_gcs_uri(self):
        with self.assertRaises(PayloadValidationError):
            StorageObjectRef.from_value("https://example.com/source.zip", "source")


class AnalysisTaskPayloadTest(unittest.TestCase):
    def test_accepts_camel_case_payload(self):
        payload = AnalysisTaskPayload.from_mapping(
            {
                "jobId": "job-123",
                "projectName": "Legacy SaaS",
                "sourceArchiveUri": "gs://uploads/uploads/job-123/source.zip",
                "documentUris": ["gs://uploads/uploads/job-123/docs/spec.pdf"],
                "resultsPrefix": "results/job-123",
            }
        )

        self.assertEqual(payload.job_id, "job-123")
        self.assertEqual(payload.project_name, "Legacy SaaS")
        self.assertEqual(payload.source_archive.uri, "gs://uploads/uploads/job-123/source.zip")
        self.assertEqual(payload.documents[0].uri, "gs://uploads/uploads/job-123/docs/spec.pdf")
        self.assertEqual(payload.results_prefix, "results/job-123")

    def test_accepts_snake_case_payload(self):
        payload = AnalysisTaskPayload.from_mapping(
            {
                "job_id": "job-123",
                "project_name": "Legacy SaaS",
                "source_archive": {"bucket": "uploads", "object": "source.zip"},
                "documents": [{"bucket": "uploads", "object": "docs/spec.xlsx"}],
                "results_prefix": "results/job-123",
            }
        )

        self.assertEqual(payload.job_id, "job-123")
        self.assertEqual(payload.documents[0].uri, "gs://uploads/docs/spec.xlsx")

    def test_rejects_missing_documents(self):
        with self.assertRaisesRegex(PayloadValidationError, "documents"):
            AnalysisTaskPayload.from_mapping(
                {
                    "jobId": "job-123",
                    "sourceArchiveUri": "gs://uploads/source.zip",
                }
            )


if __name__ == "__main__":
    unittest.main()

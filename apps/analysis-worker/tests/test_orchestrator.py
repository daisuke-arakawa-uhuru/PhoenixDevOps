from __future__ import annotations

import unittest

from analysis_worker.engines import (
    PlaceholderDocumentExtractionEngine,
    PlaceholderDriftReportGenerator,
    PlaceholderSourceCodeAnalysisEngine,
    PlaceholderTrueDesignGenerator,
)
from analysis_worker.orchestrator import AnalysisOrchestrator
from analysis_worker.payload import AnalysisTaskPayload
from analysis_worker.repositories import InMemoryJobRepository, JobStatus
from analysis_worker.storage import InMemoryArtifactWriter, ReferenceOnlyInputLoader


class FailingInputLoader:
    def load(self, payload):
        raise RuntimeError("storage unavailable")


def build_payload() -> AnalysisTaskPayload:
    return AnalysisTaskPayload.from_mapping(
        {
            "jobId": "job-123",
            "projectName": "Legacy SaaS",
            "sourceArchiveUri": "gs://uploads/uploads/job-123/source.zip",
            "documentUris": ["gs://uploads/uploads/job-123/docs/spec.pdf"],
            "resultsPrefix": "results/job-123",
        }
    )


def build_orchestrator(repository, input_loader, artifact_writer):
    return AnalysisOrchestrator(
        job_repository=repository,
        input_loader=input_loader,
        artifact_writer=artifact_writer,
        source_code_engine=PlaceholderSourceCodeAnalysisEngine(),
        document_engine=PlaceholderDocumentExtractionEngine(),
        true_design_generator=PlaceholderTrueDesignGenerator(),
        drift_report_generator=PlaceholderDriftReportGenerator(),
    )


class AnalysisOrchestratorTest(unittest.TestCase):
    def test_run_marks_job_succeeded_and_writes_placeholder_artifacts(self):
        repository = InMemoryJobRepository()
        artifact_writer = InMemoryArtifactWriter()
        orchestrator = build_orchestrator(
            repository,
            ReferenceOnlyInputLoader(),
            artifact_writer,
        )

        result = orchestrator.run(build_payload())

        self.assertEqual(result.status, JobStatus.SUCCEEDED.value)
        self.assertIn("true-design.md", result.artifact_paths)
        self.assertIn("document-drift-report.md", result.artifact_paths)
        self.assertEqual(repository.get("job-123").status, JobStatus.SUCCEEDED.value)
        self.assertIn("placeholder artifact", artifact_writer.files_by_job_id["job-123"]["true-design.md"])

    def test_run_marks_job_failed_when_phase_raises(self):
        repository = InMemoryJobRepository()
        orchestrator = build_orchestrator(
            repository,
            FailingInputLoader(),
            InMemoryArtifactWriter(),
        )

        with self.assertRaisesRegex(RuntimeError, "storage unavailable"):
            orchestrator.run(build_payload())

        record = repository.get("job-123")
        self.assertEqual(record.status, JobStatus.FAILED.value)
        self.assertEqual(record.error_message, "storage unavailable")

    def test_succeeded_job_is_idempotent(self):
        repository = InMemoryJobRepository()
        artifact_writer = InMemoryArtifactWriter()
        orchestrator = build_orchestrator(
            repository,
            ReferenceOnlyInputLoader(),
            artifact_writer,
        )

        first = orchestrator.run(build_payload())
        second = orchestrator.run(build_payload())

        self.assertEqual(second.status, JobStatus.SUCCEEDED.value)
        self.assertEqual(second.artifact_paths, first.artifact_paths)
        self.assertEqual(second.message, "job_already_succeeded")


if __name__ == "__main__":
    unittest.main()

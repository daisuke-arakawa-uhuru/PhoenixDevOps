from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

from analysis_worker.engines import (
    DocumentExtractionEngine,
    DriftReportGenerator,
    GeneratedArtifacts,
    SourceCodeAnalysisEngine,
    TrueDesignGenerator,
)
from analysis_worker.payload import AnalysisTaskPayload
from analysis_worker.repositories import JobRepository, JobStatus
from analysis_worker.storage import ArtifactWriter, InputLoader


@dataclass(frozen=True)
class WorkerResult:
    job_id: str
    status: str
    artifact_paths: Dict[str, str]
    message: Optional[str] = None

    def to_response(self) -> Dict[str, object]:
        response: Dict[str, object] = {
            "jobId": self.job_id,
            "status": self.status,
            "artifactPaths": self.artifact_paths,
        }
        if self.message:
            response["message"] = self.message
        return response


class AnalysisOrchestrator:
    def __init__(
        self,
        job_repository: JobRepository,
        input_loader: InputLoader,
        artifact_writer: ArtifactWriter,
        source_code_engine: SourceCodeAnalysisEngine,
        document_engine: DocumentExtractionEngine,
        true_design_generator: TrueDesignGenerator,
        drift_report_generator: DriftReportGenerator,
    ) -> None:
        self._job_repository = job_repository
        self._input_loader = input_loader
        self._artifact_writer = artifact_writer
        self._source_code_engine = source_code_engine
        self._document_engine = document_engine
        self._true_design_generator = true_design_generator
        self._drift_report_generator = drift_report_generator

    def run(self, payload: AnalysisTaskPayload) -> WorkerResult:
        current_job = self._job_repository.get(payload.job_id)
        if current_job and current_job.status == JobStatus.SUCCEEDED.value:
            return WorkerResult(
                job_id=payload.job_id,
                status=JobStatus.SUCCEEDED.value,
                artifact_paths=current_job.artifact_paths,
                message="job_already_succeeded",
            )

        self._job_repository.mark_running(payload.job_id)

        try:
            inputs = self._input_loader.load(payload)
            source_specification = self._source_code_engine.extract(payload, inputs)
            document_specification = self._document_engine.extract(payload, inputs)
            artifacts = GeneratedArtifacts(
                true_design_markdown=self._true_design_generator.generate(
                    payload,
                    source_specification,
                    document_specification,
                ),
                drift_report_markdown=self._drift_report_generator.generate(
                    payload,
                    source_specification,
                    document_specification,
                ),
            )
            artifact_paths = self._artifact_writer.write(payload, artifacts.as_files())
            self._job_repository.mark_succeeded(payload.job_id, artifact_paths)
            return WorkerResult(
                job_id=payload.job_id,
                status=JobStatus.SUCCEEDED.value,
                artifact_paths=artifact_paths,
            )
        except Exception as exc:
            self._job_repository.mark_failed(payload.job_id, str(exc))
            raise

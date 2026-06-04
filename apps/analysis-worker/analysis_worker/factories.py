from __future__ import annotations

from analysis_worker.config import WorkerConfig
from analysis_worker.engines import (
    GeminiDocumentExtractionEngine,
    GeminiDriftReportGenerator,
    GeminiSourceCodeAnalysisEngine,
    GeminiTrueDesignGenerator,
)
from analysis_worker.gemini import GeminiSettings, build_gemini_client
from analysis_worker.orchestrator import AnalysisOrchestrator
from analysis_worker.repositories import FirestoreJobRepository
from analysis_worker.storage import GcsArtifactWriter, ReferenceOnlyInputLoader


def build_orchestrator(config: WorkerConfig) -> AnalysisOrchestrator:
    gemini_client = build_gemini_client(
        GeminiSettings(
            api_key=config.gemini_api_key,
            model=config.gemini_model,
            dry_run=config.gemini_dry_run,
        )
    )
    return AnalysisOrchestrator(
        job_repository=FirestoreJobRepository(config.firestore_jobs_collection),
        input_loader=ReferenceOnlyInputLoader(),
        artifact_writer=GcsArtifactWriter(
            results_bucket=config.results_bucket,
            results_prefix_template=config.results_prefix_template,
        ),
        source_code_engine=GeminiSourceCodeAnalysisEngine(gemini_client),
        document_engine=GeminiDocumentExtractionEngine(gemini_client),
        true_design_generator=GeminiTrueDesignGenerator(gemini_client),
        drift_report_generator=GeminiDriftReportGenerator(gemini_client),
    )

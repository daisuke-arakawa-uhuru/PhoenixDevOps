from __future__ import annotations

import argparse
import json
from pathlib import Path
from uuid import uuid4

from analysis_worker.config import WorkerConfig
from analysis_worker.engines import (
    GeminiDocumentExtractionEngine,
    GeminiDriftReportGenerator,
    GeminiSourceCodeAnalysisEngine,
    GeminiTrueDesignGenerator,
)
from analysis_worker.gemini import GeminiSettings, build_gemini_client
from analysis_worker.orchestrator import AnalysisOrchestrator
from analysis_worker.payload import AnalysisTaskPayload, StorageObjectRef
from analysis_worker.repositories import InMemoryJobRepository
from analysis_worker.storage import LocalArtifactWriter, LocalFileInputLoader


def main() -> None:
    args = _parse_args()
    config = WorkerConfig.from_env()
    gemini_client = build_gemini_client(
        GeminiSettings(
            api_key=config.gemini_api_key,
            model=config.gemini_model,
            dry_run=args.dry_run or config.gemini_dry_run,
        )
    )

    job_id = args.job_id or f"local-{uuid4().hex[:12]}"
    payload = AnalysisTaskPayload(
        job_id=job_id,
        project_name=args.project_name,
        source_archive=StorageObjectRef(bucket="local", object_name=str(args.source)),
        documents=tuple(
            StorageObjectRef(bucket="local", object_name=str(document))
            for document in args.document
        ),
        results_prefix=job_id,
    )

    orchestrator = AnalysisOrchestrator(
        job_repository=InMemoryJobRepository(),
        input_loader=LocalFileInputLoader(args.source, args.document),
        artifact_writer=LocalArtifactWriter(args.output),
        source_code_engine=GeminiSourceCodeAnalysisEngine(gemini_client),
        document_engine=GeminiDocumentExtractionEngine(gemini_client),
        true_design_generator=GeminiTrueDesignGenerator(gemini_client),
        drift_report_generator=GeminiDriftReportGenerator(gemini_client),
    )

    result = orchestrator.run(payload)
    print(json.dumps(result.to_response(), ensure_ascii=False, indent=2))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the analysis worker locally.")
    parser.add_argument("--source", required=True, type=Path, help="Source directory or zip file.")
    parser.add_argument(
        "--document",
        action="append",
        default=[],
        type=Path,
        help="Document file or directory. Repeatable.",
    )
    parser.add_argument("--project-name", default=None)
    parser.add_argument("--job-id", default=None)
    parser.add_argument("--output", default=Path("output"), type=Path)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not call Gemini API. Generate deterministic local artifacts.",
    )
    args = parser.parse_args()

    if not args.source.exists():
        parser.error(f"--source does not exist: {args.source}")
    for document in args.document:
        if not document.exists():
            parser.error(f"--document does not exist: {document}")
    if not args.document:
        parser.error("--document is required at least once")

    return args


if __name__ == "__main__":
    main()

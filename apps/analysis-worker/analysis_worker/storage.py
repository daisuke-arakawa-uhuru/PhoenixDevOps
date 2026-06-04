from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import zipfile
from typing import Dict, Iterable, List, Optional, Protocol, Sequence, Tuple

from analysis_worker.payload import AnalysisTaskPayload


@dataclass(frozen=True)
class TextFile:
    path: str
    content: str


@dataclass(frozen=True)
class InputBundle:
    source_archive_uri: str
    document_uris: Tuple[str, ...]
    source_files: Tuple[TextFile, ...] = ()
    document_files: Tuple[TextFile, ...] = ()


class InputLoader(Protocol):
    def load(self, payload: AnalysisTaskPayload) -> InputBundle:
        ...


class ArtifactWriter(Protocol):
    def write(self, payload: AnalysisTaskPayload, markdown_files: Dict[str, str]) -> Dict[str, str]:
        ...


class ReferenceOnlyInputLoader:
    def load(self, payload: AnalysisTaskPayload) -> InputBundle:
        return InputBundle(
            source_archive_uri=payload.source_archive.uri,
            document_uris=tuple(document.uri for document in payload.documents),
        )


class LocalFileInputLoader:
    def __init__(
        self,
        source_path: Path,
        document_paths: Sequence[Path],
        max_files: int = 80,
        max_chars_per_file: int = 12000,
    ) -> None:
        self._source_path = source_path
        self._document_paths = tuple(document_paths)
        self._max_files = max_files
        self._max_chars_per_file = max_chars_per_file

    def load(self, payload: AnalysisTaskPayload) -> InputBundle:
        source_files = tuple(
            _limit_files(
                _read_source_files(self._source_path, self._max_chars_per_file),
                self._max_files,
            )
        )
        document_files = tuple(
            _limit_files(
                _read_document_files(self._document_paths, self._max_chars_per_file),
                self._max_files,
            )
        )
        return InputBundle(
            source_archive_uri=str(self._source_path),
            document_uris=tuple(str(path) for path in self._document_paths),
            source_files=source_files,
            document_files=document_files,
        )


class GcsArtifactWriter:
    def __init__(self, results_bucket: str = None, results_prefix_template: str = "results/{job_id}") -> None:
        from google.cloud import storage

        self._client = storage.Client()
        self._results_bucket = results_bucket
        self._results_prefix_template = results_prefix_template

    def write(self, payload: AnalysisTaskPayload, markdown_files: Dict[str, str]) -> Dict[str, str]:
        bucket_name = self._results_bucket or payload.source_archive.bucket
        bucket = self._client.bucket(bucket_name)
        prefix = self._result_prefix(payload)
        artifact_paths: Dict[str, str] = {}

        for file_name, content in markdown_files.items():
            object_name = f"{prefix}/{file_name}"
            blob = bucket.blob(object_name)
            blob.upload_from_string(content, content_type="text/markdown; charset=utf-8")
            artifact_paths[file_name] = f"gs://{bucket_name}/{object_name}"

        return artifact_paths

    def _result_prefix(self, payload: AnalysisTaskPayload) -> str:
        raw_prefix = payload.results_prefix or self._results_prefix_template.format(job_id=payload.job_id)
        return raw_prefix.strip("/")


class InMemoryArtifactWriter:
    def __init__(self) -> None:
        self.files_by_job_id: Dict[str, Dict[str, str]] = {}

    def write(self, payload: AnalysisTaskPayload, markdown_files: Dict[str, str]) -> Dict[str, str]:
        self.files_by_job_id[payload.job_id] = dict(markdown_files)
        prefix = (payload.results_prefix or f"results/{payload.job_id}").strip("/")
        return {
            file_name: f"memory://{prefix}/{file_name}"
            for file_name in markdown_files
        }


class LocalArtifactWriter:
    def __init__(self, output_dir: Path) -> None:
        self._output_dir = output_dir

    def write(self, payload: AnalysisTaskPayload, markdown_files: Dict[str, str]) -> Dict[str, str]:
        job_output_dir = self._output_dir / payload.job_id
        job_output_dir.mkdir(parents=True, exist_ok=True)

        artifact_paths: Dict[str, str] = {}
        for file_name, content in markdown_files.items():
            path = job_output_dir / file_name
            path.write_text(content, encoding="utf-8")
            artifact_paths[file_name] = str(path)

        return artifact_paths


_SKIPPED_DIRS = {
    ".git",
    ".venv",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
}

_TEXT_EXTENSIONS = {
    "",
    ".c",
    ".conf",
    ".css",
    ".csv",
    ".env",
    ".go",
    ".h",
    ".html",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".kt",
    ".lock",
    ".md",
    ".php",
    ".properties",
    ".py",
    ".rb",
    ".rs",
    ".sh",
    ".sql",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}


def _read_source_files(source_path: Path, max_chars_per_file: int) -> Iterable[TextFile]:
    if source_path.is_dir():
        for path in sorted(source_path.rglob("*")):
            if not path.is_file() or _should_skip(path):
                continue
            text = _read_text(path, max_chars_per_file)
            if text is not None:
                yield TextFile(path=str(path.relative_to(source_path)), content=text)
        return

    if source_path.is_file() and source_path.suffix.lower() == ".zip":
        yield from _read_zip_text_files(source_path, max_chars_per_file)
        return

    text = _read_text(source_path, max_chars_per_file)
    if text is not None:
        yield TextFile(path=source_path.name, content=text)


def _read_document_files(document_paths: Sequence[Path], max_chars_per_file: int) -> Iterable[TextFile]:
    for path in document_paths:
        if path.is_dir():
            for child in sorted(path.rglob("*")):
                if child.is_file() and not _should_skip(child):
                    yield from _read_document_path(child, max_chars_per_file)
        else:
            yield from _read_document_path(path, max_chars_per_file)


def _read_document_path(path: Path, max_chars_per_file: int) -> Iterable[TextFile]:
    if path.suffix.lower() == ".zip":
        yield from _read_zip_text_files(path, max_chars_per_file)
        return

    text = _read_text(path, max_chars_per_file)
    if text is not None:
        yield TextFile(path=str(path), content=text)
        return

    yield TextFile(
        path=str(path),
        content=f"[未対応のローカル文書形式です: {path.suffix or '拡張子なし'}]",
    )


def _read_zip_text_files(zip_path: Path, max_chars_per_file: int) -> Iterable[TextFile]:
    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            path = Path(info.filename)
            if info.is_dir() or _should_skip(path):
                continue
            if path.suffix.lower() not in _TEXT_EXTENSIONS:
                continue
            try:
                data = archive.read(info)
                text = data.decode("utf-8")
            except (RuntimeError, UnicodeDecodeError):
                continue
            yield TextFile(
                path=info.filename,
                content=_truncate(text, max_chars_per_file),
            )


def _limit_files(files: Iterable[TextFile], max_files: int) -> List[TextFile]:
    limited: List[TextFile] = []
    for file in files:
        limited.append(file)
        if len(limited) >= max_files:
            break
    return limited


def _read_text(path: Path, max_chars_per_file: int) -> Optional[str]:
    if not path.exists() or not path.is_file():
        return None
    if path.suffix.lower() not in _TEXT_EXTENSIONS:
        return None
    try:
        return _truncate(path.read_text(encoding="utf-8"), max_chars_per_file)
    except UnicodeDecodeError:
        return None


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n...[truncated]"


def _should_skip(path: Path) -> bool:
    return any(part in _SKIPPED_DIRS for part in path.parts)

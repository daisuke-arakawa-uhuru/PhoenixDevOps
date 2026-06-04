from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET
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


class GcsInputLoader:
    def __init__(
        self,
        storage_client=None,
        max_files: int = 80,
        max_chars_per_file: int = 12000,
    ) -> None:
        if storage_client is None:
            from google.cloud import storage

            storage_client = storage.Client()
        self._storage_client = storage_client
        self._max_files = max_files
        self._max_chars_per_file = max_chars_per_file

    def load(self, payload: AnalysisTaskPayload) -> InputBundle:
        source_data = _download_storage_object(self._storage_client, payload.source_archive)
        source_files = tuple(
            _limit_files(
                _read_source_object(
                    payload.source_archive.object_name,
                    source_data,
                    self._max_chars_per_file,
                ),
                self._max_files,
            )
        )

        document_files: List[TextFile] = []
        for document in payload.documents:
            document_data = _download_storage_object(self._storage_client, document)
            document_files.extend(
                _limit_files(
                    _read_document_object(
                        document.object_name,
                        document_data,
                        self._max_chars_per_file,
                    ),
                    self._max_files - len(document_files),
                )
            )
            if len(document_files) >= self._max_files:
                break

        return InputBundle(
            source_archive_uri=payload.source_archive.uri,
            document_uris=tuple(document.uri for document in payload.documents),
            source_files=source_files,
            document_files=tuple(document_files),
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

    if path.suffix.lower() == ".xlsx":
        yield TextFile(
            path=str(path),
            content=_extract_xlsx_text_from_bytes(path.read_bytes(), max_chars_per_file),
        )
        return

    if path.suffix.lower() == ".pdf":
        yield TextFile(
            path=str(path),
            content=_extract_pdf_text_from_bytes(path.read_bytes(), max_chars_per_file),
        )
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
        yield from _read_zip_text_entries(archive, max_chars_per_file)


def _read_source_object(
    object_name: str,
    data: bytes,
    max_chars_per_file: int,
) -> Iterable[TextFile]:
    suffix = Path(object_name).suffix.lower()
    if suffix == ".zip":
        yield from _read_zip_text_files_from_bytes(data, max_chars_per_file)
        return

    if suffix in _TEXT_EXTENSIONS:
        text = _decode_utf8(data, max_chars_per_file)
        if text is not None:
            yield TextFile(path=object_name, content=text)


def _read_document_object(
    object_name: str,
    data: bytes,
    max_chars_per_file: int,
) -> Iterable[TextFile]:
    suffix = Path(object_name).suffix.lower()
    if suffix == ".zip":
        yield from _read_zip_text_files_from_bytes(
            data,
            max_chars_per_file,
            path_prefix=object_name,
        )
        return

    if suffix == ".xlsx":
        yield TextFile(
            path=object_name,
            content=_extract_xlsx_text_from_bytes(data, max_chars_per_file),
        )
        return

    if suffix == ".pdf":
        yield TextFile(
            path=object_name,
            content=_extract_pdf_text_from_bytes(data, max_chars_per_file),
        )
        return

    if suffix in _TEXT_EXTENSIONS:
        text = _decode_utf8(data, max_chars_per_file)
        if text is not None:
            yield TextFile(path=object_name, content=text)
            return

    yield TextFile(
        path=object_name,
        content=f"[未対応の文書形式です: {suffix or '拡張子なし'}]",
    )


def _read_zip_text_files_from_bytes(
    data: bytes,
    max_chars_per_file: int,
    path_prefix: Optional[str] = None,
) -> Iterable[TextFile]:
    with zipfile.ZipFile(BytesIO(data)) as archive:
        yield from _read_zip_text_entries(archive, max_chars_per_file, path_prefix)


def _read_zip_text_entries(
    archive: zipfile.ZipFile,
    max_chars_per_file: int,
    path_prefix: Optional[str] = None,
) -> Iterable[TextFile]:
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
        file_path = info.filename
        if path_prefix:
            file_path = f"{path_prefix}::{info.filename}"
        yield TextFile(
            path=file_path,
            content=_truncate(text, max_chars_per_file),
        )


def _limit_files(files: Iterable[TextFile], max_files: int) -> List[TextFile]:
    if max_files <= 0:
        return []

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


def _decode_utf8(data: bytes, max_chars_per_file: int) -> Optional[str]:
    try:
        return _truncate(data.decode("utf-8"), max_chars_per_file)
    except UnicodeDecodeError:
        return None


def _download_storage_object(storage_client, ref) -> bytes:
    bucket = storage_client.bucket(ref.bucket)
    blob = bucket.blob(ref.object_name)
    return blob.download_as_bytes()


def _extract_pdf_text_from_bytes(data: bytes, max_chars: int) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return "[PDF本文抽出には pypdf が必要です]"

    reader = PdfReader(BytesIO(data))
    page_blocks: List[str] = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = text.strip()
        if text:
            page_blocks.append(f"## page {page_number}\n{text}")
        if sum(len(block) for block in page_blocks) >= max_chars:
            break

    if not page_blocks:
        return "[PDFからテキストを抽出できませんでした]"
    return _truncate("\n\n".join(page_blocks), max_chars)


def _extract_xlsx_text_from_bytes(data: bytes, max_chars: int) -> str:
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            shared_strings = _read_xlsx_shared_strings(archive)
            worksheet_names = sorted(
                name
                for name in archive.namelist()
                if name.startswith("xl/worksheets/") and name.endswith(".xml")
            )
            blocks: List[str] = []
            for worksheet_name in worksheet_names:
                rows = _read_xlsx_worksheet_rows(
                    archive.read(worksheet_name),
                    shared_strings,
                )
                if rows:
                    blocks.append(
                        "\n".join(
                            [
                                f"## {worksheet_name}",
                                *["\t".join(row) for row in rows],
                            ]
                        )
                    )
                if sum(len(block) for block in blocks) >= max_chars:
                    break
    except (KeyError, ET.ParseError, zipfile.BadZipFile):
        return "[Excelからテキストを抽出できませんでした]"

    if not blocks:
        return "[Excelからテキストを抽出できませんでした]"
    return _truncate("\n\n".join(blocks), max_chars)


def _read_xlsx_shared_strings(archive: zipfile.ZipFile) -> List[str]:
    try:
        data = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []

    root = ET.fromstring(data)
    strings: List[str] = []
    for item in root.findall(".//{*}si"):
        parts = [text_node.text or "" for text_node in item.findall(".//{*}t")]
        strings.append("".join(parts))
    return strings


def _read_xlsx_worksheet_rows(data: bytes, shared_strings: Sequence[str]) -> List[List[str]]:
    root = ET.fromstring(data)
    rows: List[List[str]] = []
    for row in root.findall(".//{*}row"):
        values: List[str] = []
        for cell in row.findall("{*}c"):
            values.append(_read_xlsx_cell_value(cell, shared_strings))
        if any(value.strip() for value in values):
            rows.append(values)
    return rows


def _read_xlsx_cell_value(cell: ET.Element, shared_strings: Sequence[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        text_node = cell.find(".//{*}t")
        return text_node.text if text_node is not None and text_node.text else ""

    value_node = cell.find("{*}v")
    if value_node is None or value_node.text is None:
        return ""

    raw_value = value_node.text
    if cell_type == "s":
        try:
            return shared_strings[int(raw_value)]
        except (ValueError, IndexError):
            return raw_value
    return raw_value


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n...[truncated]"


def _should_skip(path: Path) -> bool:
    return any(part in _SKIPPED_DIRS for part in path.parts)

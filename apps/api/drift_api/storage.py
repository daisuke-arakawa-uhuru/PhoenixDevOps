from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from pathlib import PurePath
import re
import zipfile
from typing import List, Optional, Sequence

from drift_api.errors import ApiError
from drift_api.gcs import parse_gcs_uri


@dataclass(frozen=True)
class StoredObject:
    original_filename: str
    object_name: str
    uri: str
    content_type: Optional[str] = None


@dataclass(frozen=True)
class StoredUploadBundle:
    upload_id: str
    source: StoredObject
    documents: Sequence[StoredObject]


class StorageService:
    def __init__(
        self,
        bucket_name: str,
        uploads_prefix_template: str = "uploads/{upload_id}",
        storage_client=None,
    ) -> None:
        if storage_client is None:
            from google.cloud import storage

            storage_client = storage.Client()
        self._client = storage_client
        self._bucket_name = bucket_name
        self._uploads_prefix_template = uploads_prefix_template

    def upload_bundle(
        self,
        upload_id: str,
        source_file,
        document_files: Sequence[object],
        max_document_files: int = 600,
    ) -> StoredUploadBundle:
        if not source_file or not _filename(source_file):
            raise ApiError(400, "missing_source_archive", "sourceArchive file is required")
        if not document_files:
            raise ApiError(400, "missing_documents", "At least one documents file is required")
        if len(document_files) > max_document_files:
            raise ApiError(
                400,
                "too_many_documents",
                f"documents must contain at most {max_document_files} files",
            )

        source_name = sanitize_filename(_filename(source_file))
        if not source_name.lower().endswith(".zip"):
            raise ApiError(400, "invalid_source_archive", "sourceArchive must be a ZIP file")
        if not _is_zip_file(source_file):
            raise ApiError(400, "invalid_source_archive", "sourceArchive is not a readable ZIP file")

        prefix = self._upload_prefix(upload_id)
        source_object = self._upload_one(
            source_file,
            f"{prefix}/source/{source_name}",
        )

        document_objects: List[StoredObject] = []
        for index, document_file in enumerate(document_files, start=1):
            if not document_file or not _filename(document_file):
                raise ApiError(400, "invalid_document", "documents files must have filenames")
            document_name = sanitize_filename(_filename(document_file))
            document_objects.append(
                self._upload_one(
                    document_file,
                    f"{prefix}/documents/{index:04d}-{document_name}",
                )
            )

        return StoredUploadBundle(
            upload_id=upload_id,
            source=source_object,
            documents=tuple(document_objects),
        )

    def signed_url(self, uri: str, expiration_seconds: int) -> str:
        ref = parse_gcs_uri(uri)
        blob = self._client.bucket(ref.bucket).blob(ref.object_name)
        return blob.generate_signed_url(
            version="v4",
            expiration=timedelta(seconds=expiration_seconds),
            method="GET",
        )

    def _upload_one(self, file_storage, object_name: str) -> StoredObject:
        bucket = self._client.bucket(self._bucket_name)
        blob = bucket.blob(object_name)
        stream = _stream(file_storage)
        if hasattr(stream, "seek"):
            stream.seek(0)
        content_type = getattr(file_storage, "content_type", None) or "application/octet-stream"
        blob.upload_from_file(stream, content_type=content_type)
        return StoredObject(
            original_filename=_filename(file_storage),
            object_name=object_name,
            uri=f"gs://{self._bucket_name}/{object_name}",
            content_type=content_type,
        )

    def _upload_prefix(self, upload_id: str) -> str:
        return self._uploads_prefix_template.format(upload_id=upload_id).strip("/")


def sanitize_filename(value: str) -> str:
    name = PurePath(value).name.strip()
    stem, separator, suffix = name.rpartition(".")

    if separator and stem.strip("._-"):
        safe_stem = _safe_filename_part(stem) or "file"
        safe_suffix = re.sub(r"[^A-Za-z0-9]+", "", suffix)
        if safe_suffix:
            return f"{safe_stem}.{safe_suffix}"
        return safe_stem

    return _safe_filename_part(name) or "file"


def _safe_filename_part(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._-")


def _filename(file_storage) -> str:
    return str(getattr(file_storage, "filename", "") or "")


def _stream(file_storage):
    return getattr(file_storage, "stream", file_storage)


def _is_zip_file(file_storage) -> bool:
    stream = _stream(file_storage)
    if not hasattr(stream, "seek"):
        return _filename(file_storage).lower().endswith(".zip")

    position = stream.tell()
    try:
        return zipfile.is_zipfile(stream)
    finally:
        stream.seek(position)

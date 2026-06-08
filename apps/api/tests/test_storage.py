from __future__ import annotations

from io import BytesIO
import zipfile
import unittest

from drift_api.errors import ApiError
from drift_api.storage import StorageService, sanitize_filename


class StubFile:
    def __init__(
        self,
        filename: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> None:
        self.filename = filename
        self.stream = BytesIO(data)
        self.content_type = content_type


class FakeBlob:
    def __init__(self, bucket_name: str, object_name: str, store: dict) -> None:
        self._bucket_name = bucket_name
        self._object_name = object_name
        self._store = store

    def upload_from_file(self, stream, content_type: str = None) -> None:
        self._store[(self._bucket_name, self._object_name)] = {
            "data": stream.read(),
            "content_type": content_type,
        }

    def generate_signed_url(self, **kwargs) -> str:
        return f"https://signed.example/{self._bucket_name}/{self._object_name}"


class FakeBucket:
    def __init__(self, bucket_name: str, store: dict) -> None:
        self._bucket_name = bucket_name
        self._store = store

    def blob(self, object_name: str) -> FakeBlob:
        return FakeBlob(self._bucket_name, object_name, self._store)


class FakeStorageClient:
    def __init__(self) -> None:
        self.store = {}

    def bucket(self, bucket_name: str) -> FakeBucket:
        return FakeBucket(bucket_name, self.store)


class StorageServiceTest(unittest.TestCase):
    def test_upload_bundle_stores_source_and_documents(self):
        client = FakeStorageClient()
        service = StorageService(
            "uploads",
            uploads_prefix_template="uploads/{upload_id}",
            storage_client=client,
        )

        bundle = service.upload_bundle(
            "upload-123",
            StubFile("source.zip", _zip_bytes({"app.py": "print('hello')"})),
            [
                StubFile("spec.md", b"# Spec\n", "text/markdown"),
                StubFile("../design.pdf", b"%PDF"),
            ],
        )

        self.assertEqual(
            bundle.source.uri,
            "gs://uploads/uploads/upload-123/source/source.zip",
        )
        self.assertEqual(
            bundle.documents[0].uri,
            "gs://uploads/uploads/upload-123/documents/0001-spec.md",
        )
        self.assertEqual(
            bundle.documents[1].uri,
            "gs://uploads/uploads/upload-123/documents/0002-design.pdf",
        )
        self.assertIn(
            ("uploads", "uploads/upload-123/source/source.zip"),
            client.store,
        )

    def test_rejects_source_that_is_not_a_readable_zip(self):
        service = StorageService("uploads", storage_client=FakeStorageClient())

        with self.assertRaisesRegex(ApiError, "readable ZIP"):
            service.upload_bundle(
                "upload-123",
                StubFile("source.zip", b"not zip"),
                [StubFile("spec.md", b"# Spec\n")],
            )

    def test_sanitize_filename_removes_paths_and_unsafe_characters(self):
        self.assertEqual(sanitize_filename("../my source (copy).zip"), "my_source_copy.zip")
        self.assertEqual(sanitize_filename("ソースコード.zip"), "file.zip")
        self.assertEqual(sanitize_filename("..."), "file")

    def test_signed_url_uses_gcs_uri_target(self):
        service = StorageService("uploads", storage_client=FakeStorageClient())

        url = service.signed_url("gs://results/results/job-1/true-design.md", 300)

        self.assertEqual(url, "https://signed.example/results/results/job-1/true-design.md")


def _zip_bytes(files) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return buffer.getvalue()


if __name__ == "__main__":
    unittest.main()

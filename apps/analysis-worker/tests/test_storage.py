from __future__ import annotations

from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import zipfile
import unittest

from analysis_worker.payload import AnalysisTaskPayload
from analysis_worker.storage import GcsInputLoader, LocalFileInputLoader


class FakeBlob:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def download_as_bytes(self) -> bytes:
        return self._data


class FakeBucket:
    def __init__(self, objects):
        self._objects = objects

    def blob(self, object_name: str) -> FakeBlob:
        return FakeBlob(self._objects[object_name])


class FakeStorageClient:
    def __init__(self, buckets):
        self._buckets = buckets

    def bucket(self, bucket_name: str) -> FakeBucket:
        return FakeBucket(self._buckets[bucket_name])


class LocalFileInputLoaderTest(unittest.TestCase):
    def test_loads_text_files_from_local_source_and_documents(self):
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "source"
            source.mkdir()
            (source / "README.md").write_text("# App\n", encoding="utf-8")
            (source / "node_modules").mkdir()
            (source / "node_modules" / "ignored.js").write_text("ignored", encoding="utf-8")
            document = root / "spec.md"
            document.write_text("# Spec\n", encoding="utf-8")

            payload = AnalysisTaskPayload.from_mapping(
                {
                    "jobId": "job-123",
                    "sourceArchiveUri": "gs://uploads/source.zip",
                    "documentUris": ["gs://uploads/spec.md"],
                }
            )
            bundle = LocalFileInputLoader(source, [document]).load(payload)

            self.assertEqual(bundle.source_archive_uri, str(source))
            self.assertEqual(bundle.source_files[0].path, "README.md")
            self.assertEqual(bundle.source_files[0].content, "# App\n")
            self.assertEqual(bundle.document_files[0].content, "# Spec\n")

    def test_extracts_text_from_local_xlsx_documents(self):
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "source"
            source.mkdir()
            (source / "README.md").write_text("# App\n", encoding="utf-8")
            document = root / "spec.xlsx"
            document.write_bytes(_minimal_xlsx_bytes())

            payload = AnalysisTaskPayload.from_mapping(
                {
                    "jobId": "job-123",
                    "sourceArchiveUri": "gs://uploads/source.zip",
                    "documentUris": ["gs://uploads/spec.xlsx"],
                }
            )
            bundle = LocalFileInputLoader(source, [document]).load(payload)

            self.assertIn("Feature", bundle.document_files[0].content)
            self.assertIn("Login", bundle.document_files[0].content)


class GcsInputLoaderTest(unittest.TestCase):
    def test_loads_source_zip_and_text_documents_from_gcs(self):
        storage_client = FakeStorageClient(
            {
                "uploads": {
                    "source.zip": _zip_bytes({"app.py": "print('hello')"}),
                    "docs/spec.md": b"# Spec\n",
                }
            }
        )
        payload = AnalysisTaskPayload.from_mapping(
            {
                "jobId": "job-123",
                "sourceArchiveUri": "gs://uploads/source.zip",
                "documentUris": ["gs://uploads/docs/spec.md"],
            }
        )

        bundle = GcsInputLoader(storage_client=storage_client).load(payload)

        self.assertEqual(bundle.source_archive_uri, "gs://uploads/source.zip")
        self.assertEqual(bundle.source_files[0].path, "app.py")
        self.assertEqual(bundle.source_files[0].content, "print('hello')")
        self.assertEqual(bundle.document_files[0].path, "docs/spec.md")
        self.assertEqual(bundle.document_files[0].content, "# Spec\n")


def _zip_bytes(files) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return buffer.getvalue()


def _minimal_xlsx_bytes() -> bytes:
    return _zip_bytes(
        {
            "xl/sharedStrings.xml": (
                '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                "<si><t>Feature</t></si>"
                "<si><t>Login</t></si>"
                "</sst>"
            ),
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                "<sheetData>"
                '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>'
                "</sheetData>"
                "</worksheet>"
            ),
        }
    )


if __name__ == "__main__":
    unittest.main()

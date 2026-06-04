from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from analysis_worker.payload import AnalysisTaskPayload
from analysis_worker.storage import LocalFileInputLoader


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


if __name__ == "__main__":
    unittest.main()

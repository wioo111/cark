import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from zotero_client import (
    ZoteroClient,
    ZoteroUnavailableError,
    file_url_to_path,
    normalize_item_key,
)


class ZoteroClientTests(unittest.TestCase):
    def test_lists_recent_items_with_pdf_attachments(self):
        parent_response = Mock(status_code=200)
        parent_response.json.return_value = [
            {
                "key": "ABCD1234",
                "data": {
                    "key": "ABCD1234",
                    "title": "A Useful Paper",
                    "date": "2024-05-10",
                    "creators": [
                        {"firstName": "Ada", "lastName": "Lovelace"},
                        {"name": "Research Group"},
                    ],
                },
            }
        ]
        child_response = Mock(status_code=200)
        child_response.json.return_value = [
            {
                "key": "PDFD1234",
                "data": {
                    "key": "PDFD1234",
                    "contentType": "application/pdf",
                    "filename": "paper.pdf",
                },
            }
        ]

        with patch.object(
            ZoteroClient,
            "_request",
            side_effect=[parent_response, child_response],
        ):
            papers = ZoteroClient().list_papers("useful")

        self.assertEqual(
            papers,
            [
                {
                    "itemKey": "ABCD1234",
                    "attachmentKey": "PDFD1234",
                    "title": "A Useful Paper",
                    "creators": ["Ada Lovelace", "Research Group"],
                    "year": "2024",
                    "fileName": "paper.pdf",
                }
            ],
        )

    def test_resolves_local_pdf_without_modifying_zotero(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf = Path(temp_dir) / "paper.pdf"
            pdf.write_bytes(b"%PDF-1.4")
            metadata_response = Mock(status_code=200)
            metadata_response.json.return_value = {
                "data": {
                    "key": "PDFD1234",
                    "parentItem": "ABCD1234",
                    "contentType": "application/pdf",
                    "filename": "paper.pdf",
                }
            }
            location_response = Mock(status_code=200)
            location_response.text = pdf.as_uri()

            with patch.object(
                ZoteroClient,
                "_request",
                side_effect=[metadata_response, location_response],
            ):
                resolved, file_name, parent_key = ZoteroClient().resolve_pdf("PDFD1234")

            self.assertEqual(resolved.resolve(), pdf.resolve())
            self.assertEqual(file_name, "paper.pdf")
            self.assertEqual(parent_key, "ABCD1234")

    def test_connection_failure_has_actionable_message(self):
        session = Mock()
        session.get.side_effect = requests.ConnectionError("refused")
        with patch("zotero_client.requests.Session", return_value=session):
            with self.assertRaisesRegex(ZoteroUnavailableError, "启动 Zotero"):
                ZoteroClient().status()
        session.close.assert_called_once()

    def test_rejects_invalid_keys_and_non_file_urls(self):
        with self.assertRaisesRegex(ValueError, "标识无效"):
            normalize_item_key("../../bad")
        with self.assertRaisesRegex(ValueError, "本地 PDF 路径"):
            file_url_to_path("https://example.test/paper.pdf")


if __name__ == "__main__":
    unittest.main()

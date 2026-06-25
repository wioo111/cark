import tempfile
import unittest
from pathlib import Path

import gui_annotations

from gui_server import PaperRecord


class GuiAnnotationsTests(unittest.TestCase):
    def setUp(self):
        self.record = PaperRecord(
            paper_id="paper-1",
            title="Paper",
            task_id=None,
            root_dir=Path("paper"),
            auto_dir=Path("paper/auto"),
            updated_at=0,
            available_views=["linearized"],
            source_pdf=None,
            files={},
        )

    def test_placeholder_comments_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "不允许保存占位评论"):
            gui_annotations.normalize_annotation_comment(
                {
                    "authorType": "user",
                    "authorLabel": "我",
                    "content": "placeholder",
                    "status": "pending",
                }
            )

    def test_annotation_id_cannot_escape_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaisesRegex(FileNotFoundError, "标识非法"):
                gui_annotations.annotation_file_path(self.record, Path(temp_dir), "../../paper_profile")

    def test_create_and_load_annotation_roundtrip(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            annotation = gui_annotations.create_annotation(
                self.record,
                Path(temp_dir),
                {
                    "view": "linearized",
                    "quote": "Important sentence.",
                    "contextBefore": "Before",
                    "contextAfter": "After",
                    "anchorTop": 12,
                    "anchorHeight": 24,
                    "blockId": "block-1",
                    "initialComment": {
                        "authorType": "user",
                        "authorLabel": "我",
                        "content": "Need revisit.",
                    },
                },
            )

            loaded = gui_annotations.load_paper_annotations(self.record, Path(temp_dir))

        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded[0]["id"], annotation["id"])
        self.assertEqual(loaded[0]["locator"]["blockId"], "block-1")
        self.assertEqual(loaded[0]["comments"][0]["locator"]["commentId"], annotation["comments"][0]["id"])


if __name__ == "__main__":
    unittest.main()

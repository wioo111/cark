import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import gui_exports
import gui_memory


def fake_record():
    return SimpleNamespace(
        paper_id="paper-1",
        title="Paper One",
        updated_at=0,
    )


class GuiExportsTests(unittest.TestCase):
    def test_export_filename_preserves_safe_unicode_title(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            record = SimpleNamespace(
                paper_id="paper-cn",
                title="大模型 / 学术翻译",
                updated_at=0,
            )
            exported = gui_exports.export_paper_memory_markdown(record, Path(temp_dir))

        self.assertTrue(str(exported["fileName"]).startswith("大模型-学术翻译-memory-"))

    def test_paper_memory_markdown_export_preserves_sources(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            gui_memory.create_memory_item_from_annotation(
                record,
                root,
                {
                    "id": "annotation-1",
                    "view": "linearized",
                    "quote": "Important source sentence.",
                    "contextBefore": "Before",
                    "contextAfter": "After",
                    "anchorTop": 12,
                    "anchorHeight": 24,
                },
                {
                    "type": "insight",
                    "text": "This is the durable claim.",
                    "tags": ["method", "evidence"],
                },
            )

            exported = gui_exports.export_paper_memory_markdown(record, root)

            markdown = str(exported["markdown"])
            self.assertEqual(exported["format"], "markdown")
            self.assertEqual(exported["itemCount"], 1)
            self.assertIn("# Paper One", markdown)
            self.assertIn("This is the durable claim.", markdown)
            self.assertIn("Source annotation: `annotation-1`", markdown)
            self.assertIn("> Important source sentence.", markdown)
            self.assertTrue(Path(str(exported["filePath"])).exists())
            self.assertTrue(str(exported["filePath"]).endswith(str(exported["fileName"])))


if __name__ == "__main__":
    unittest.main()

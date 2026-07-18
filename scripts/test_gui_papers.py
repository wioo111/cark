import json
import re
import tempfile
import unittest
from pathlib import Path

import gui_papers

from gui_server import PaperRecord, decode_paper_id, encode_paper_id


class FakeStore:
    def __init__(self, papers):
        self._papers = papers

    def list_papers(self):
        return list(self._papers)


class GuiPapersTests(unittest.TestCase):
    def test_discovery_uses_metadata_title_with_stable_artifact_names(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "output"
            task_id = "task-20260719123456-abc123"
            auto_dir = output_dir / task_id / "paper" / "auto"
            auto_dir.mkdir(parents=True)
            (auto_dir / "paper_linearized.md").write_text("# Original", encoding="utf-8")
            (auto_dir / "paper_metadata.json").write_text(
                json.dumps({"title": "论文显示标题"}, ensure_ascii=False),
                encoding="utf-8",
            )

            records = gui_papers.discover_records(
                runtime_output_dir=output_dir,
                uuid_dir_re=re.compile(r"^task-\d{14}-[0-9a-f]{6}$"),
                encode_paper_id=encode_paper_id,
                record_factory=PaperRecord,
            )

        record = next(iter(records.values()))
        self.assertEqual(record.title, "论文显示标题")
        self.assertEqual(record.task_id, task_id)
        self.assertEqual(record.files["linearized"].name, "paper_linearized.md")

    def test_failed_translation_status_hides_stale_bilingual_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "output"
            auto_dir = output_dir / "task-20260719123456-abc123" / "paper" / "auto"
            auto_dir.mkdir(parents=True)
            (auto_dir / "paper_linearized.md").write_text("Original", encoding="utf-8")
            (auto_dir / "paper_linearized_bilingual.md").write_text("Stale", encoding="utf-8")
            (auto_dir / "paper_metadata.json").write_text(
                json.dumps({"title": "Paper", "translationStatus": "failed"}),
                encoding="utf-8",
            )

            records = gui_papers.discover_records(
                runtime_output_dir=output_dir,
                uuid_dir_re=re.compile(r"^task-\d{14}-[0-9a-f]{6}$"),
                encode_paper_id=encode_paper_id,
                record_factory=PaperRecord,
            )

        record = next(iter(records.values()))
        self.assertIsNone(record.files["bilingual"])
        self.assertNotIn("bilingual", record.available_views)

    def test_get_record_supports_encoded_lookup(self):
        record = PaperRecord(
            paper_id=encode_paper_id("task-1", "Paper"),
            title="Paper",
            task_id="task-1",
            root_dir=Path("paper"),
            auto_dir=Path("paper/auto"),
            updated_at=1.0,
            available_views=["linearized"],
            source_pdf=None,
            files={"linearized": Path(__file__)},
        )
        store = FakeStore([gui_papers.serialize_paper_record(record)])

        found = gui_papers.get_record(
            record.paper_id,
            indexed_records_func=lambda refresh=False: gui_papers.indexed_records(
                store=store,
                deserialize_record=lambda payload: gui_papers.deserialize_paper_record(
                    payload,
                    record_factory=PaperRecord,
                ),
                refresh=refresh,
                sync_paper_index=lambda: None,
            ),
            decode_paper_id=decode_paper_id,
        )

        self.assertEqual(found.paper_id, record.paper_id)

    def test_build_detail_includes_blocks_and_images(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root_dir = Path(temp_dir)
            auto_dir = root_dir / "auto"
            images_dir = auto_dir / "images"
            auto_dir.mkdir(parents=True)
            images_dir.mkdir(parents=True)
            linearized_path = auto_dir / "paper_linearized.md"
            bilingual_path = auto_dir / "paper_bilingual.md"
            content_list_path = auto_dir / "paper_content_list.json"
            image_path = images_dir / "figure-1.png"
            linearized_path.write_text("# Paper", encoding="utf-8")
            bilingual_path.write_text("# 论文", encoding="utf-8")
            image_path.write_bytes(b"fake")
            content_list_path.write_text(
                json.dumps(
                    [
                        {
                            "type": "text",
                            "text": "Important paragraph",
                            "page_idx": 1,
                            "text_level": 0,
                        },
                        {
                            "type": "image",
                            "img_path": "images/figure-1.png",
                            "img_caption": ["Figure caption"],
                        },
                    ]
                ),
                encoding="utf-8",
            )
            record = PaperRecord(
                paper_id="paper-1",
                title="Paper",
                task_id=None,
                root_dir=root_dir,
                auto_dir=auto_dir,
                updated_at=1.0,
                available_views=["linearized", "bilingual"],
                source_pdf=None,
                files={
                    "linearized": linearized_path,
                    "bilingual": bilingual_path,
                    "feishuReady": None,
                    "contentListJson": content_list_path,
                },
            )

            detail = gui_papers.build_detail(
                record,
                load_blocks=lambda current_record: gui_papers.load_blocks(
                    current_record,
                    normalize_text_value=lambda value: str(value or "").strip() if not isinstance(value, list) else " ".join(str(item) for item in value),
                    normalize_string_list=lambda value: [str(item).strip() for item in value] if isinstance(value, list) else [],
                ),
                load_markdown=gui_papers.load_markdown,
                build_images=lambda current_record: gui_papers.build_images(
                    current_record,
                    image_suffixes={".png"},
                ),
            )

        self.assertEqual(len(detail["blocks"]), 2)
        self.assertEqual(detail["stats"]["blockCount"], 2)
        self.assertEqual(len(detail["images"]), 1)


if __name__ == "__main__":
    unittest.main()

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import gui_memory
from gui_library import library_meta_path, load_library_meta, update_library_meta


def fake_record():
    return SimpleNamespace(
        paper_id="paper-1",
        title="Paper",
        updated_at=0,
    )


class GuiLibraryTests(unittest.TestCase):
    def test_defaults_to_reading_when_state_exists_and_no_explicit_status(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            meta = load_library_meta(
                fake_record(),
                Path(temp_dir),
                reading_state={"updatedAt": "2026-06-17T12:00:00"},
            )

            self.assertEqual(meta["readingStatus"], "reading")
            self.assertEqual(meta["lastReadAt"], "2026-06-17T12:00:00")
            self.assertFalse(meta["favorite"])
            self.assertEqual(meta["tags"], [])

    def test_update_library_meta_persists_clean_tags_and_status(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()

            meta = update_library_meta(
                record,
                root,
                {
                    "favorite": True,
                    "tags": [" HCI ", "HCI", " situated action "],
                    "readingStatus": "done",
                },
            )
            loaded = load_library_meta(record, root)

            self.assertTrue(meta["favorite"])
            self.assertEqual(meta["tags"], ["HCI", "situated action"])
            self.assertEqual(loaded["readingStatus"], "done")

    def test_invalid_status_falls_back_to_unread(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            meta = update_library_meta(
                fake_record(),
                Path(temp_dir),
                {"readingStatus": "finished"},
            )

            self.assertEqual(meta["readingStatus"], "unread")

    def test_library_meta_uses_schema_version_and_backup_fallback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            update_library_meta(record, root, {"favorite": True, "tags": ["HCI"]})
            path = library_meta_path(record, root)
            payload = gui_memory.read_json_file(path, default={})
            self.assertEqual(payload["schemaVersion"], 1)

            update_library_meta(record, root, {"favorite": False, "tags": ["theory"]})
            backup_payload = gui_memory.read_json_file(gui_memory.json_backup_path(path), default={})
            self.assertTrue(backup_payload["favorite"])

            path.write_text("{broken", encoding="utf-8")
            recovered = load_library_meta(record, root)
            self.assertTrue(recovered["favorite"])


if __name__ == "__main__":
    unittest.main()

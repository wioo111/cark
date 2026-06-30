import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from gui_memory import (
    build_memory_payload,
    create_memory_item,
    create_memory_item_from_annotation,
    create_memory_note,
    delete_memory_item,
    json_backup_path,
    load_memory_items,
    legacy_paper_memory_dir,
    memory_item_file_path,
    migrate_legacy_paper_memory,
    paper_memory_dir,
    paper_memory_key,
    paper_notes_dir,
    paper_profile_path,
    read_json_file,
    is_behavioral_memory_item,
    update_memory_item,
)


def fake_record():
    return SimpleNamespace(
        paper_id="paper-1",
        title="Paper One",
        updated_at=0,
    )


class GuiMemoryTests(unittest.TestCase):
    def test_create_memory_item_uses_stable_shape(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()

            item = create_memory_item(
                record,
                root,
                {
                    "type": "question",
                    "text": "What evidence is missing?",
                    "tags": ["evidence", "evidence", " risk "],
                },
            )

            self.assertTrue(item["id"].startswith("memory-"))
            self.assertEqual(item["paperId"], "paper-1")
            self.assertEqual(item["type"], "question")
            self.assertEqual(item["text"], "What evidence is missing?")
            self.assertEqual(item["content"], "What evidence is missing?")
            self.assertEqual(item["status"], "active")
            self.assertEqual(item["tags"], ["evidence", "risk"])
            self.assertEqual(item["memoryLayer"], "paper")
            self.assertEqual(item["activationStatus"], "active")
            self.assertEqual(item["source"]["kind"], "manual")
            self.assertGreaterEqual(item["confidence"], 0.9)
            self.assertEqual(item["revisionHistory"][0]["reason"], "created")

            payload = build_memory_payload(record, root)
            self.assertEqual(payload["noteCount"], 1)
            self.assertEqual(len(payload["questions"]), 1)
            self.assertEqual(payload["recentNotes"][0]["id"], item["id"])
            self.assertEqual(payload["activeCount"], 1)
            self.assertEqual(payload["candidateCount"], 0)

    def test_memory_files_use_schema_version_and_backup_fallback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            item = create_memory_item(record, root, {"type": "note", "text": "Initial judgment."})
            item_path = memory_item_file_path(record, root, item["id"])

            profile_payload = read_json_file(paper_profile_path(record, root), default={})
            item_payload = read_json_file(item_path, default={})
            self.assertEqual(profile_payload["schemaVersion"], 1)
            self.assertEqual(item_payload["schemaVersion"], 1)

            update_memory_item(record, root, item["id"], {"text": "Updated judgment."})
            backup_payload = read_json_file(json_backup_path(item_path), default={})
            self.assertEqual(backup_payload["text"], "Initial judgment.")

            item_path.write_text("{broken", encoding="utf-8")
            recovered = load_memory_items(record, root)
            self.assertEqual(recovered[0]["text"], "Initial judgment.")

    def test_legacy_note_is_loaded_as_note_item(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            note = create_memory_note(record, root, {"content": "Keep this judgment."})

            loaded = load_memory_items(record, root)

            self.assertEqual(loaded[0]["id"], note["id"])
            self.assertEqual(loaded[0]["type"], "note")
            self.assertEqual(loaded[0]["text"], "Keep this judgment.")

    def test_update_and_delete_memory_item(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            item = create_memory_item(record, root, {"type": "action", "text": "Check method."})

            updated = update_memory_item(
                record,
                root,
                item["id"],
                {"text": "Re-check method.", "status": "done", "tags": ["method"]},
            )

            self.assertEqual(updated["text"], "Re-check method.")
            self.assertEqual(updated["status"], "done")
            self.assertEqual(updated["tags"], ["method"])
            self.assertEqual(updated["revisionHistory"][0]["reason"], "update")
            self.assertEqual(updated["revisionHistory"][0]["text"], "Check method.")

            delete_memory_item(record, root, item["id"])
            self.assertEqual(load_memory_items(record, root), [])

    def test_create_memory_item_from_annotation_preserves_anchor(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            annotation = {
                "id": "annotation-1",
                "view": "linearized",
                "quote": "Important sentence.",
                "contextBefore": "Before",
                "contextAfter": "After",
                "blockId": "block-1",
                "anchorTop": 12,
                "anchorHeight": 20,
            }

            item = create_memory_item_from_annotation(
                record,
                root,
                annotation,
                {"type": "insight", "text": "This is the reusable idea."},
            )

            self.assertEqual(item["sourceAnnotationId"], "annotation-1")
            self.assertEqual(item["quote"], "Important sentence.")
            self.assertEqual(item["anchor"]["view"], "linearized")
            self.assertEqual(item["blockId"], "block-1")
            self.assertEqual(item["locator"]["blockId"], "block-1")
            self.assertEqual(item["source"]["annotationId"], "annotation-1")
            self.assertEqual(item["evidence"][0]["kind"], "annotation")
            self.assertEqual(item["evidence"][0]["blockId"], "block-1")

    def test_candidate_memory_is_separated_from_behavioral_items(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            candidate = create_memory_item(
                record,
                root,
                {
                    "type": "insight",
                    "text": "Tentative hypothesis.",
                    "activationStatus": "candidate",
                    "confidence": 0.41,
                },
            )
            active = create_memory_item(
                record,
                root,
                {
                    "type": "insight",
                    "text": "Durable conclusion.",
                },
            )

            payload = build_memory_payload(record, root)

            self.assertFalse(is_behavioral_memory_item(candidate))
            self.assertTrue(is_behavioral_memory_item(active))
            self.assertEqual(payload["candidateCount"], 1)
            self.assertEqual(payload["activeCount"], 1)
            self.assertEqual(payload["candidateItems"][0]["id"], candidate["id"])

    def test_duplicate_memory_item_is_merged_instead_of_created(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            first = create_memory_item(
                record,
                root,
                {
                    "type": "insight",
                    "text": "Reusable method judgment",
                    "tags": ["method"],
                },
            )
            merged = create_memory_item_from_annotation(
                record,
                root,
                {
                    "id": "annotation-1",
                    "view": "linearized",
                    "quote": "Reusable method judgment",
                    "contextBefore": "Before",
                    "contextAfter": "After",
                    "anchorTop": 12,
                    "anchorHeight": 20,
                },
                {
                    "type": "insight",
                    "text": "  Reusable   method judgment ",
                    "tags": ["evidence"],
                },
            )

            items = load_memory_items(record, root)

            self.assertEqual(len(items), 1)
            self.assertEqual(merged["id"], first["id"])
            self.assertEqual(merged["tags"], ["method", "evidence"])
            self.assertEqual(merged["sourceAnnotationId"], "annotation-1")
            self.assertEqual(merged["evidence"][0]["annotationId"], "annotation-1")
            self.assertEqual(merged["revisionHistory"][0]["reason"], "duplicate")

    def test_conflict_links_are_written_bidirectionally_on_create(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            left = create_memory_item(record, root, {"type": "question", "text": "Adopt method A?"})
            right = create_memory_item(
                record,
                root,
                {
                    "type": "question",
                    "text": "Adopt method B?",
                    "conflictsWith": [left["id"]],
                },
            )

            items = {item["id"]: item for item in load_memory_items(record, root)}

            self.assertEqual(right["conflictsWith"], [left["id"]])
            self.assertIn(right["id"], items[left["id"]]["conflictsWith"])
            self.assertEqual(items[left["id"]]["revisionHistory"][0]["reason"], "conflict-link")

    def test_memory_item_id_cannot_escape_notes_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            create_memory_item(record, root, {"type": "note", "text": "Safe"})

            with self.assertRaisesRegex(FileNotFoundError, "invalid"):
                update_memory_item(record, root, "../../paper_profile", {"text": "bad"})

            notes_dir = paper_notes_dir(record, root)
            self.assertEqual(len(list(notes_dir.glob("*.json"))), 1)

    def test_old_json_file_with_content_only_is_normalized(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record()
            notes_dir = paper_notes_dir(record, root)
            notes_dir.mkdir(parents=True)
            (notes_dir / "note-old.json").write_text(
                json.dumps(
                    {
                        "id": "note-old",
                        "paperId": "paper-1",
                        "content": "Legacy content",
                        "createdAt": "2026-06-17T00:00:00",
                        "updatedAt": "2026-06-17T00:00:00",
                    }
                ),
                encoding="utf-8",
            )

            loaded = load_memory_items(record, root)

            self.assertEqual(loaded[0]["type"], "note")
            self.assertEqual(loaded[0]["text"], "Legacy content")

    def test_long_paper_id_uses_short_safe_memory_directory_key(self):
        record = SimpleNamespace(
            paper_id="paper-" + ("x" * 260),
            title="Long",
            updated_at=0,
        )

        key = paper_memory_key(record)

        self.assertLess(len(key), 64)
        self.assertTrue(key.startswith("paper-"))

    def test_legacy_long_paper_memory_is_copied_to_short_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = SimpleNamespace(
                paper_id="p" * 121,
                title="Long",
                updated_at=0,
            )
            legacy_notes_dir = legacy_paper_memory_dir(record, root) / "notes"
            legacy_notes_dir.mkdir(parents=True)
            (legacy_notes_dir / "note-old.json").write_text(
                json.dumps(
                    {
                        "id": "note-old",
                        "paperId": record.paper_id,
                        "content": "Keep the old note.",
                        "createdAt": "2026-06-17T00:00:00",
                        "updatedAt": "2026-06-17T00:00:00",
                    }
                ),
                encoding="utf-8",
            )

            copied = migrate_legacy_paper_memory(record, root)

            self.assertEqual(copied, 1)
            self.assertTrue((paper_memory_dir(record, root) / "notes" / "note-old.json").exists())
            self.assertTrue((legacy_notes_dir / "note-old.json").exists())


if __name__ == "__main__":
    unittest.main()

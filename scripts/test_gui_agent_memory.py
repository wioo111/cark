from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import gui_agent_memory
import gui_memory


class GuiAgentMemoryTest(unittest.TestCase):
    def test_create_search_update_and_delete_agent_memory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            memory_root = Path(temp_dir)
            item = gui_agent_memory.create_agent_memory_item(
                memory_root,
                {
                    "type": "research_interest",
                    "text": "The user wants Hermes-style long-term agent memory.",
                    "tags": ["agent", "Hermes"],
                    "source": {"kind": "conversation", "note": "product direction"},
                    "confidence": 0.9,
                },
            )

            relevant = gui_agent_memory.select_relevant_agent_memory(memory_root, "Hermes agent", limit=4)
            self.assertEqual(relevant[0]["id"], item["id"])
            self.assertEqual(relevant[0]["confidence"], 0.9)
            self.assertEqual(item["memoryLayer"], "global")
            self.assertEqual(item["activationStatus"], "active")
            self.assertEqual(item["revisionHistory"][0]["reason"], "created")

            updated = gui_agent_memory.update_agent_memory_item(
                memory_root,
                str(item["id"]),
                {"status": "archived"},
            )
            self.assertEqual(updated["status"], "archived")
            self.assertEqual(updated["revisionHistory"][0]["reason"], "update")
            self.assertEqual(gui_agent_memory.select_relevant_agent_memory(memory_root, "Hermes"), [])

            gui_agent_memory.delete_agent_memory_item(memory_root, str(item["id"]))
            self.assertEqual(gui_agent_memory.load_agent_memory_items(memory_root, include_archived=True), [])

    def test_render_agent_memory_context_is_compact(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            memory_root = Path(temp_dir)
            gui_agent_memory.create_agent_memory_item(
                memory_root,
                {
                    "type": "preference",
                    "text": "Prefer direct product judgment over generic summaries.",
                    "tags": ["style"],
                },
            )

            context = gui_agent_memory.render_agent_memory_context(memory_root, "product judgment")

            self.assertIn("偏好", context)
            self.assertIn("direct product judgment", context)

    def test_candidate_agent_memory_does_not_enter_behavioral_retrieval(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            memory_root = Path(temp_dir)
            candidate = gui_agent_memory.create_agent_memory_item(
                memory_root,
                {
                    "type": "concept",
                    "text": "Tentative concept memory.",
                    "activationStatus": "candidate",
                    "confidence": 0.42,
                },
            )
            active = gui_agent_memory.create_agent_memory_item(
                memory_root,
                {
                    "type": "concept",
                    "text": "Durable concept memory.",
                    "confidence": 0.9,
                },
            )

            payload = gui_agent_memory.build_agent_memory_payload(memory_root, query="concept")
            relevant = gui_agent_memory.select_relevant_agent_memory(memory_root, "concept", limit=8)

            self.assertEqual(payload["candidateCount"], 1)
            self.assertEqual(payload["activeCount"], 1)
            self.assertEqual(payload["candidateItems"][0]["id"], candidate["id"])
            self.assertEqual(relevant[0]["id"], active["id"])
            self.assertNotIn(candidate["id"], [item["id"] for item in relevant])

    def test_agent_memory_file_uses_schema_version_and_backup_fallback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            memory_root = Path(temp_dir)
            item = gui_agent_memory.create_agent_memory_item(
                memory_root,
                {
                    "type": "project",
                    "text": "Keep durable product constraints.",
                },
            )
            path = gui_agent_memory.agent_memory_path(memory_root)
            payload = gui_memory.read_json_file(path, default={})
            self.assertEqual(payload["schemaVersion"], 1)

            gui_agent_memory.update_agent_memory_item(memory_root, str(item["id"]), {"status": "archived"})
            backup_payload = gui_memory.read_json_file(gui_memory.json_backup_path(path), default={})
            self.assertEqual(backup_payload["items"][0]["status"], "active")

            path.write_text("{broken", encoding="utf-8")
            recovered = gui_agent_memory.load_agent_memory_items(memory_root, include_archived=True)
            self.assertEqual(recovered[0]["id"], item["id"])


if __name__ == "__main__":
    unittest.main()

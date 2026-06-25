import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import gui_agent_memory
import gui_memory
import gui_memory_candidates


def fake_record(paper_id: str, title: str):
    return SimpleNamespace(
        paper_id=paper_id,
        title=title,
        updated_at=0,
    )


class GuiMemoryCandidateTests(unittest.TestCase):
    def test_lists_paper_and_global_candidates(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record("paper-1", "Paper One")
            paper_candidate = gui_memory.create_memory_item(
                record,
                root,
                {
                    "type": "insight",
                    "text": "Candidate paper insight.",
                    "activationStatus": "candidate",
                },
            )
            gui_memory.create_memory_item(
                record,
                root,
                {
                    "type": "insight",
                    "text": "Confirmed paper insight.",
                },
            )
            global_candidate = gui_agent_memory.create_agent_memory_item(
                root,
                {
                    "type": "project",
                    "text": "Candidate project context.",
                    "activationStatus": "candidate",
                },
            )

            payload = gui_memory_candidates.list_memory_candidates(root, [record])

            self.assertEqual(payload["count"], 2)
            item_ids = {item["id"] for item in payload["items"]}
            self.assertEqual(item_ids, {paper_candidate["id"], global_candidate["id"]})
            paper_items = [item for item in payload["items"] if item["layer"] == "paper"]
            self.assertEqual(paper_items[0]["paperTitle"], "Paper One")

    def test_activate_paper_candidate_writes_revision(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record("paper-1", "Paper One")
            candidate = gui_memory.create_memory_item(
                record,
                root,
                {
                    "type": "question",
                    "text": "Candidate question?",
                    "activationStatus": "candidate",
                },
            )

            activated = gui_memory_candidates.activate_memory_candidate(root, candidate["id"], [record])
            loaded = gui_memory.load_memory_items(record, root)[0]

            self.assertEqual(activated["activationStatus"], "active")
            self.assertEqual(activated["status"], "active")
            self.assertEqual(loaded["revisionHistory"][0]["reason"], "activate")
            self.assertTrue(gui_memory.is_behavioral_memory_item(loaded))

    def test_archive_global_candidate_removes_it_from_behavioral_memory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            candidate = gui_agent_memory.create_agent_memory_item(
                root,
                {
                    "type": "project",
                    "text": "Candidate project context.",
                    "activationStatus": "candidate",
                },
            )

            archived = gui_memory_candidates.archive_memory_candidate(root, candidate["id"], [])
            items = gui_agent_memory.load_agent_memory_items(root, include_archived=True)

            self.assertEqual(archived["activationStatus"], "archived")
            self.assertEqual(archived["status"], "archived")
            self.assertEqual(items[0]["revisionHistory"][0]["reason"], "archive")
            self.assertFalse(gui_agent_memory.is_behavioral_agent_memory(items[0]))

    def test_unknown_candidate_raises_not_found(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(FileNotFoundError):
                gui_memory_candidates.activate_memory_candidate(
                    Path(temp_dir),
                    "memory-missing",
                    [fake_record("paper-1", "Paper One")],
                )


if __name__ == "__main__":
    unittest.main()

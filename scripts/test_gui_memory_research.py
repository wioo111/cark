import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import gui_memory
import gui_memory_research


def fake_record(paper_id: str, title: str):
    return SimpleNamespace(
        paper_id=paper_id,
        title=title,
        updated_at=0,
    )


class GuiMemoryResearchTests(unittest.TestCase):
    def test_lists_active_recent_insights_and_open_questions(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record("paper-1", "Paper One")
            insight = gui_memory.create_memory_item(
                record,
                root,
                {
                    "type": "insight",
                    "text": "Confirmed insight.",
                    "activationStatus": "active",
                },
            )
            question = gui_memory.create_memory_item(
                record,
                root,
                {
                    "type": "question",
                    "text": "Open question?",
                    "activationStatus": "active",
                },
            )
            gui_memory.create_memory_item(
                record,
                root,
                {
                    "type": "insight",
                    "text": "Candidate insight.",
                    "activationStatus": "candidate",
                },
            )
            gui_memory.create_memory_item(
                record,
                root,
                {
                    "type": "question",
                    "text": "Done question?",
                    "status": "done",
                    "activationStatus": "active",
                },
            )

            payload = gui_memory_research.list_memory_research_state(root, [record])

            self.assertEqual(payload["insightCount"], 1)
            self.assertEqual(payload["openQuestionCount"], 1)
            self.assertEqual(payload["recentInsights"][0]["id"], insight["id"])
            self.assertEqual(payload["recentInsights"][0]["paperTitle"], "Paper One")
            self.assertEqual(payload["openQuestions"][0]["id"], question["id"])
            self.assertEqual(payload["openQuestions"][0]["paperId"], "paper-1")


if __name__ == "__main__":
    unittest.main()

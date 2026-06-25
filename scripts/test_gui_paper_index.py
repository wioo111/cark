import unittest
from types import SimpleNamespace
from pathlib import Path

import gui_paper_index


def fake_record(paper_id: str, title: str, updated_at: float):
    return SimpleNamespace(
        paper_id=paper_id,
        title=title,
        updated_at=updated_at,
        files={"linearized": Path(f"{paper_id}.md"), "bilingual": None},
    )


def serialize_record(record):
    return {
        "id": record.paper_id,
        "title": record.title,
        "taskId": None,
        "rootDir": f"D:/papers/{record.paper_id}",
        "autoDir": f"D:/papers/{record.paper_id}/auto",
        "updatedAt": record.updated_at,
        "availableViews": ["linearized"],
        "sourcePdf": None,
        "files": {"linearized": f"D:/papers/{record.paper_id}.md"},
    }


class FakeStore:
    def __init__(self, papers=None):
        self.papers = list(papers or [])
        self.upsert_calls = []
        self.sync_calls = []
        self.search_replace_calls = []

    def list_papers(self):
        return list(self.papers)

    def upsert_papers(self, papers, indexed_at):
        self.upsert_calls.append((papers, indexed_at))
        current = {paper["id"]: dict(paper) for paper in self.papers}
        for paper in papers:
            current[paper["id"]] = dict(paper)
        self.papers = list(current.values())

    def sync_papers(self, papers, indexed_at):
        self.sync_calls.append((papers, indexed_at))
        self.papers = list(papers)

    def replace_search_entries_for_papers(self, paper_ids, entries, indexed_at):
        self.search_replace_calls.append((list(paper_ids), list(entries), indexed_at))


class GuiPaperIndexTests(unittest.TestCase):
    def test_only_changed_paper_is_reindexed(self):
        unchanged = serialize_record(fake_record("paper-1", "Paper One", 1.0))
        changed_record = fake_record("paper-2", "Paper Two", 2.0)
        store = FakeStore(
            papers=[
                unchanged,
                {
                    **serialize_record(changed_record),
                    "updatedAt": 1.5,
                },
            ]
        )

        gui_paper_index.sync_paper_index(
            store,
            discover_records=lambda: {
                "paper-1": fake_record("paper-1", "Paper One", 1.0),
                "paper-2": changed_record,
            },
            serialize_record=serialize_record,
            memory_root=Path("."),
            load_markdown=lambda _path: "markdown",
            load_annotations=lambda _record: [],
            current_timestamp_iso=lambda: "2026-06-19T10:00:00",
        )

        self.assertEqual(len(store.upsert_calls), 1)
        self.assertEqual(store.upsert_calls[0][0][0]["id"], "paper-2")
        self.assertEqual(
            [paper_ids for paper_ids, _entries, _indexed_at in store.search_replace_calls],
            [["paper-2"]],
        )

    def test_removed_paper_triggers_sync_and_search_cleanup(self):
        store = FakeStore(
            papers=[
                serialize_record(fake_record("paper-1", "Paper One", 1.0)),
                serialize_record(fake_record("paper-2", "Paper Two", 2.0)),
            ]
        )

        gui_paper_index.sync_paper_index(
            store,
            discover_records=lambda: {
                "paper-1": fake_record("paper-1", "Paper One", 1.0),
            },
            serialize_record=serialize_record,
            memory_root=Path("."),
            load_markdown=lambda _path: "markdown",
            load_annotations=lambda _record: [],
            current_timestamp_iso=lambda: "2026-06-19T10:00:00",
        )

        self.assertEqual(len(store.sync_calls), 1)
        self.assertEqual(store.sync_calls[0][0][0]["id"], "paper-1")
        self.assertEqual(store.search_replace_calls[0][0], ["paper-2"])


if __name__ == "__main__":
    unittest.main()

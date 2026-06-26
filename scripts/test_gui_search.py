import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from gui_memory import create_memory_item
from gui_storage import WorkbenchStore
from gui_search import search_records


def fake_record(root: Path):
    markdown = root / "paper.md"
    markdown.write_text("This paper studies embodied interaction and situated action.", encoding="utf-8")
    return SimpleNamespace(
        paper_id="paper-1",
        title="Where the Action Is",
        updated_at=0,
        files={"linearized": markdown, "bilingual": None},
    )


class GuiSearchTests(unittest.TestCase):
    def test_searches_title_body_annotations_and_memory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            memory_root = root / "memory"
            record = fake_record(root)
            memory_item = create_memory_item(
                record,
                memory_root,
                {
                    "type": "insight",
                    "text": "Durable memory about interaction design.",
                    "tags": ["interaction"],
                    "sourceAnnotationId": "annotation-1",
                    "locator": {
                        "view": "linearized",
                        "annotationId": "annotation-1",
                        "quote": "Explicit locator quote",
                    },
                },
            )
            candidate_item = create_memory_item(
                record,
                memory_root,
                {
                    "type": "insight",
                    "text": "Candidate memory about interaction should not leak.",
                    "tags": ["interaction"],
                    "activationStatus": "candidate",
                },
            )
            create_memory_item(
                record,
                memory_root,
                {
                    "type": "insight",
                    "text": "Candidate-only memory about dormant concept.",
                    "activationStatus": "candidate",
                },
            )

            annotations = [
                {
                    "id": "annotation-1",
                    "view": "linearized",
                    "quote": "Situated action matters.",
                    "contextBefore": "Before",
                    "contextAfter": "After",
                    "comments": [
                        {
                            "content": "Annotation comment about interaction.",
                        }
                    ],
                }
            ]

            def load_annotations(_record):
                return annotations

            def load_markdown(path):
                return path.read_text(encoding="utf-8") if path else None

            results = search_records(
                [record],
                "interaction",
                memory_root=memory_root,
                load_markdown=load_markdown,
                load_annotations=load_annotations,
            )

            sources = {result["source"] for result in results}
            self.assertIn("body", sources)
            self.assertIn("annotation", sources)
            self.assertIn("memory", sources)
            self.assertTrue(any("interaction" in str(result["snippet"]).casefold() for result in results))
            body_result = next(result for result in results if result["source"] == "body")
            self.assertIn("interaction", str(body_result.get("matchQuote", "")).casefold())
            self.assertFalse(any("dormant concept" in str(result["snippet"]).casefold() for result in results))

    def test_empty_or_one_character_query_returns_no_results(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = fake_record(root)

            results = search_records(
                [record],
                "a",
                memory_root=root / "memory",
                load_markdown=lambda path: path.read_text(encoding="utf-8") if path else None,
                load_annotations=lambda _record: [],
            )

            self.assertEqual(results, [])

    def test_search_records_prefers_persistent_fts_index(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            memory_root = root / "memory"
            record = fake_record(root)
            store = WorkbenchStore(root / "cark.sqlite3")
            memory_item = create_memory_item(
                record,
                memory_root,
                {
                    "type": "insight",
                    "text": "Durable memory about interaction design.",
                    "tags": ["interaction"],
                    "sourceAnnotationId": "annotation-1",
                    "locator": {
                        "view": "linearized",
                        "annotationId": "annotation-1",
                        "quote": "Explicit locator quote",
                    },
                },
            )
            candidate_item = create_memory_item(
                record,
                memory_root,
                {
                    "type": "insight",
                    "text": "Candidate memory about interaction should not leak.",
                    "tags": ["interaction"],
                    "activationStatus": "candidate",
                },
            )
            store.replace_search_entries(
                [
                    {
                        "id": "paper-1:body:linearized",
                        "paperId": "paper-1",
                        "paperTitle": "Where the Action Is",
                        "source": "body",
                        "sourceLabel": "正文",
                        "view": "linearized",
                        "annotationId": None,
                        "memoryItemId": None,
                        "text": "This paper studies embodied interaction and situated action.",
                        "haystack": "where the action is this paper studies embodied interaction and situated action",
                    },
                    {
                        "id": f"paper-1:memory:{memory_item['id']}",
                        "paperId": "paper-1",
                        "paperTitle": "Where the Action Is",
                        "source": "memory",
                        "sourceLabel": "记忆",
                        "view": "linearized",
                        "annotationId": None,
                        "memoryItemId": memory_item["id"],
                        "text": "Durable memory about interaction design.",
                        "haystack": "where the action is durable memory about interaction design",
                    },
                    {
                        "id": f"paper-1:memory:{candidate_item['id']}",
                        "paperId": "paper-1",
                        "paperTitle": "Where the Action Is",
                        "source": "memory",
                        "sourceLabel": "璁板繂",
                        "view": "linearized",
                        "annotationId": None,
                        "memoryItemId": candidate_item["id"],
                        "text": "Candidate memory about interaction should not leak.",
                        "haystack": "where the action is candidate memory about interaction should not leak",
                    },
                ],
                "2026-06-18T00:00:00",
            )

            results = search_records(
                [record],
                "interaction",
                memory_root=memory_root,
                load_markdown=lambda path: path.read_text(encoding="utf-8") if path else None,
                load_annotations=lambda _record: [],
                search_store=store,
            )

            self.assertEqual({result["source"] for result in results}, {"body", "memory"})
            self.assertEqual(results[0]["source"], "memory")
            self.assertEqual(results[0]["memoryItemId"], memory_item["id"])
            self.assertEqual(results[0]["annotationId"], "annotation-1")
            self.assertEqual(results[0]["locator"]["memoryItemId"], memory_item["id"])
            self.assertFalse(any(result.get("memoryItemId") == candidate_item["id"] for result in results))


if __name__ == "__main__":
    unittest.main()

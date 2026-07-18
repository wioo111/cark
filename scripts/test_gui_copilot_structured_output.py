from __future__ import annotations

import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

import gui_copilot
import gui_memory


@dataclass
class FakeRecord:
    paper_id: str = "paper-1"
    title: str = "Paper"


def make_settings() -> dict[str, object]:
    return {
        "copilot": {
            "agents": [
                {
                    "id": "agent-a",
                    "name": "Agent A",
                    "rolePrompt": "Focus on methods.",
                    "apiKey": "key",
                    "baseUrl": "https://example.test",
                    "model": "model-a",
                    "enabled": True,
                }
            ]
        }
    }


def make_annotation() -> dict[str, object]:
    return {
        "id": "annotation-1",
        "paperId": "paper-1",
        "view": "linearized",
        "quote": "The method relies on retrieval.",
        "contextBefore": "Before",
        "contextAfter": "After",
        "anchorTop": 10,
        "anchorHeight": 24,
        "blockId": "block-1",
        "comments": [],
    }


def make_context_cache() -> dict[str, object]:
    return {
        "overview": "Paper overview",
        "chunks": [
            {
                "id": "chunk-1",
                "heading": "Method",
                "text": "Before The method relies on retrieval. After",
                "normalized": "before the method relies on retrieval after",
            }
        ],
    }


class GuiCopilotStructuredOutputTest(unittest.TestCase):
    def test_build_agent_messages_includes_confirmed_paper_memory_only(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            record = FakeRecord()
            memory_root = Path(temp_dir)
            annotation = make_annotation()
            agent = {
                "id": "agent-a",
                "name": "Agent A",
                "rolePrompt": "Focus on methods.",
            }

            gui_memory.create_memory_item(
                record,
                memory_root,
                {
                    "type": "insight",
                    "text": "Confirmed retrieval memory marker.",
                    "activationStatus": "active",
                    "quote": "The method relies on retrieval.",
                },
            )
            gui_memory.create_memory_item(
                record,
                memory_root,
                {
                    "type": "insight",
                    "text": "Candidate retrieval leak marker.",
                    "activationStatus": "candidate",
                    "quote": "The method relies on retrieval.",
                },
            )
            gui_memory.create_memory_item(
                record,
                memory_root,
                {
                    "type": "insight",
                    "text": "Archived retrieval leak marker.",
                    "activationStatus": "archived",
                    "status": "archived",
                    "quote": "The method relies on retrieval.",
                },
            )

            messages = gui_copilot.build_agent_messages(
                record,
                annotation,
                agent,
                memory_root=memory_root,
                load_copilot_context_cache_func=lambda _record, _view: make_context_cache(),
                run_mode="explain",
            )

            content = "\n\n".join(message["content"] for message in messages)
            self.assertIn("Confirmed retrieval memory marker.", content)
            self.assertNotIn("Candidate retrieval leak marker.", content)
            self.assertNotIn("Archived retrieval leak marker.", content)

    def test_structured_output_creates_candidate_memory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            record = FakeRecord()
            memory_root = Path(temp_dir)
            annotation = make_annotation()

            def append_comment(_record, annotation_id, payload):
                self.assertEqual(annotation_id, "annotation-1")
                return {
                    "id": "comment-1",
                    **payload,
                }

            model_output = """
            {
              "comment": "这句把方法依赖压缩到了检索假设上。",
              "memoryCandidates": [
                {
                  "type": "insight",
                  "text": "该论文的方法有效性依赖检索证据质量。",
                  "tags": ["method", "retrieval"],
                  "confidence": 0.82,
                  "evidenceQuote": "The method relies on retrieval."
                }
              ],
              "openQuestions": ["检索质量下降时结果是否稳定？"]
            }
            """

            with patch("gui_copilot.request_copilot_completion", return_value=model_output):
                comment = gui_copilot.invoke_annotation_agent(
                    record,
                    {
                        "agentId": "agent-a",
                        "annotationId": "annotation-1",
                        "runId": "run-1",
                        "runMode": "memory_candidate",
                    },
                    memory_root=memory_root,
                    load_settings=make_settings,
                    load_annotation_func=lambda _record, _annotation_id: (Path("annotation.json"), annotation),
                    create_annotation_func=lambda _record, _payload: None,
                    append_annotation_comment_func=append_comment,
                    load_copilot_context_cache_func=lambda _record, _view: make_context_cache(),
                )

            self.assertTrue(comment["structuredOutput"])
            self.assertEqual(comment["runMode"], "memory_candidate")
            self.assertEqual(comment["memoryCandidateCount"], 1)
            self.assertIn("这句把方法依赖", comment["content"])
            self.assertIn("待验证问题", comment["content"])

            memory_items = gui_memory.load_memory_items(record, memory_root)
            self.assertEqual(len(memory_items), 1)
            item = memory_items[0]
            self.assertEqual(item["activationStatus"], "candidate")
            self.assertEqual(item["source"]["kind"], "agent_comment")
            self.assertEqual(item["source"]["commentId"], "comment-1")
            self.assertEqual(item["source"]["runId"], "run-1")
            self.assertEqual(item["locator"]["annotationId"], "annotation-1")
            self.assertEqual(item["locator"]["commentId"], "comment-1")
            self.assertEqual(item["evidence"][0]["quote"], "The method relies on retrieval.")
            self.assertEqual(gui_memory.build_memory_payload(record, memory_root)["activeCount"], 0)

    def test_plain_output_falls_back_to_comment_without_candidates(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            record = FakeRecord()
            memory_root = Path(temp_dir)
            annotation = make_annotation()

            with patch("gui_copilot.request_copilot_completion", return_value="普通评论，不是 JSON"):
                comment = gui_copilot.invoke_annotation_agent(
                    record,
                    {
                        "agentId": "agent-a",
                        "annotationId": "annotation-1",
                        "runMode": "explain",
                    },
                    memory_root=memory_root,
                    load_settings=make_settings,
                    load_annotation_func=lambda _record, _annotation_id: (Path("annotation.json"), annotation),
                    create_annotation_func=lambda _record, _payload: None,
                    append_annotation_comment_func=lambda _record, _annotation_id, payload: {"id": "comment-1", **payload},
                    load_copilot_context_cache_func=lambda _record, _view: make_context_cache(),
                )

            self.assertFalse(comment["structuredOutput"])
            self.assertEqual(comment["structuredOutputError"], "not_json")
            self.assertEqual(comment["memoryCandidateCount"], 0)
            self.assertEqual(comment["content"], "普通评论，不是 JSON")
            self.assertEqual(gui_memory.load_memory_items(record, memory_root), [])

    def test_invalid_json_falls_back_without_candidates(self):
        parsed = gui_copilot.parse_copilot_structured_output('{"comment": "ok",}')

        self.assertFalse(parsed["structuredOutput"])
        self.assertEqual(parsed["memoryCandidates"], [])
        self.assertIn("invalid_json", str(parsed["parseError"]))


if __name__ == "__main__":
    unittest.main()

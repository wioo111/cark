import json
import tempfile
import unittest
from http import HTTPStatus
from pathlib import Path
from unittest.mock import Mock, patch

import gui_copilot_runs
import gui_agent_memory
import gui_memory

from gui_server import (
    GuiRequestHandler,
    PaperRecord,
    annotation_file_path,
    build_agent_messages,
    build_task_command,
    ensure_upload_ready,
    import_zotero_paper,
    list_zotero_papers,
    load_paper_annotations,
    normalize_annotation_comment,
    prepare_gui_server,
    resume_active_copilot_runs,
    sanitize_gui_settings,
)


class FakeLock:
    def __init__(self, acquire_result=True):
        self.acquire_result = acquire_result
        self.acquired = False
        self.released = False

    def acquire(self):
        self.acquired = True
        return self.acquire_result

    def release(self):
        self.released = True


class FakeStore:
    def __init__(self, events=None):
        self.interrupted_calls = []
        self.events = events

    def mark_orphaned_active_tasks_interrupted(self, owner_id, updated_at):
        if self.events is not None:
            self.events.append("mark")
        self.interrupted_calls.append((owner_id, updated_at))
        return 0

    def sync_papers(self, _papers, _indexed_at):
        if self.events is not None:
            self.events.append("sync")


class FakeServer:
    def __init__(self):
        self.closed = False

    def server_close(self):
        self.closed = True


class GuiServerStartupTests(unittest.TestCase):
    def test_lock_failure_does_not_bind_or_mark_tasks(self):
        lock = FakeLock(acquire_result=False)
        store = FakeStore()
        server_factory = Mock()

        with self.assertRaisesRegex(RuntimeError, "已经在运行"):
            prepare_gui_server(
                "127.0.0.1",
                8765,
                store=store,
                owner_id="owner-new",
                instance_lock=lock,
                server_factory=server_factory,
            )

        server_factory.assert_not_called()
        self.assertEqual(store.interrupted_calls, [])
        self.assertFalse(lock.released)

    def test_bind_failure_does_not_mark_tasks_interrupted(self):
        lock = FakeLock()
        store = FakeStore()

        def fail_bind(_address, _handler):
            raise OSError("address already in use")

        with self.assertRaises(OSError):
            prepare_gui_server(
                "127.0.0.1",
                8765,
                store=store,
                owner_id="owner-new",
                instance_lock=lock,
                server_factory=fail_bind,
            )

        self.assertTrue(lock.acquired)
        self.assertTrue(lock.released)
        self.assertEqual(store.interrupted_calls, [])

    def test_tasks_are_marked_only_after_successful_bind(self):
        events = []
        lock = FakeLock()
        store = FakeStore(events)
        server = FakeServer()

        def bind(_address, _handler):
            events.append("bind")
            return server

        with (
            patch("gui_server.discover_records", return_value={}),
            patch("gui_server.resume_active_copilot_runs", return_value={"resumed": 0, "expired": 0}),
        ):
            prepared, prepared_lock, interrupted, copilot_recovery = prepare_gui_server(
                    "127.0.0.1",
                    8765,
                    store=store,
                    owner_id="owner-new",
                    instance_lock=lock,
                    server_factory=bind,
                )

        self.assertIs(prepared, server)
        self.assertIs(prepared_lock, lock)
        self.assertEqual(interrupted, 0)
        self.assertEqual(copilot_recovery, {"resumed": 0, "expired": 0})
        self.assertEqual(events, ["bind", "mark", "sync"])
        prepared.server_close()
        prepared_lock.release()

    def test_active_copilot_runs_are_resumed_on_startup(self):
        record = PaperRecord(
            paper_id="paper-1",
            title="Paper",
            task_id=None,
            root_dir=Path("paper"),
            auto_dir=Path("paper/auto"),
            updated_at=0,
            available_views=["linearized"],
            source_pdf=None,
            files={},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            memory_root = Path(temp_dir)
            run = gui_copilot_runs.create_run(
                record,
                memory_root,
                {"annotationId": "annotation-1"},
                [{"id": "agent-a", "name": "Agent A"}],
            )
            gui_copilot_runs.mark_agent_running(record, memory_root, str(run["runId"]), "agent-a")

            with (
                patch("gui_server.MEMORY_ROOT_DIR", memory_root),
                patch("gui_server.indexed_records", return_value={record.paper_id: record}),
                patch("gui_server.spawn_copilot_run_worker") as spawn_worker,
            ):
                recovery = resume_active_copilot_runs()

            self.assertEqual(recovery, {"resumed": 1, "expired": 0})
            spawn_worker.assert_called_once_with(record.paper_id, str(run["runId"]))

    def test_upload_readiness_rejects_missing_capabilities(self):
        with patch(
            "gui_server.detect_capabilities",
            return_value={
                "ready": False,
                "issues": [
                    {
                        "message": "云端解析缺少访问凭据。",
                        "action": "填写 Token。",
                    }
                ],
            },
        ):
            with self.assertRaisesRegex(ValueError, "填写 Token"):
                ensure_upload_ready({})

    def test_translation_model_is_sanitized(self):
        settings = sanitize_gui_settings(
            {
                "translation": {
                    "enabled": True,
                    "apiKey": "key",
                    "baseUrl": "https://example.test/v1",
                    "model": "custom-model",
                    "failRatioLimit": 0.2,
                }
            }
        )
        self.assertEqual(settings["translation"]["model"], "custom-model")

    def test_zero_translation_failure_limit_is_preserved(self):
        settings = sanitize_gui_settings(
            {
                "translation": {
                    "enabled": True,
                    "apiKey": "key",
                    "failRatioLimit": 0,
                },
                "publish": {"prepareOnly": True},
            }
        )
        _, env, _ = build_task_command(Path("paper.pdf"), settings)
        self.assertEqual(env["TRANSLATE_FAIL_RATIO_LIMIT"], "0.0")

    def test_placeholder_agent_comments_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "不允许保存占位评论"):
            normalize_annotation_comment(
                {
                    "authorType": "agent",
                    "authorLabel": "Agent",
                    "content": "placeholder",
                    "status": "pending",
                }
            )

    def test_agent_messages_include_relevant_global_agent_memory(self):
        record = PaperRecord(
            paper_id="paper-1",
            title="Hermes Paper",
            task_id=None,
            root_dir=Path("paper"),
            auto_dir=Path("paper/auto"),
            updated_at=0,
            available_views=["linearized"],
            source_pdf=None,
            files={},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            memory_root = Path(temp_dir)
            gui_agent_memory.create_agent_memory_item(
                memory_root,
                {
                    "type": "research_interest",
                    "text": "User cares about Hermes-style self-evolving global agent memory.",
                    "tags": ["Hermes", "agent-memory"],
                },
            )

            with patch("gui_server.MEMORY_ROOT_DIR", memory_root):
                messages = build_agent_messages(
                    record,
                    {
                        "view": "linearized",
                        "quote": "Hermes-like memory",
                        "contextBefore": "",
                        "contextAfter": "",
                        "comments": [],
                    },
                    {
                        "id": "agent-a",
                        "rolePrompt": "Read carefully.",
                    },
                    context_cache={"overview": "Overview"},
                    relevant_chunks=[],
                )

        shared_context = messages[1]["content"]
        self.assertIn("长期全局记忆", shared_context)
        self.assertIn("self-evolving global agent memory", shared_context)
        with self.assertRaisesRegex(ValueError, "不允许保存占位评论"):
            normalize_annotation_comment(
                {
                    "authorType": "user",
                    "authorLabel": "我",
                    "content": "placeholder",
                    "status": "pending",
                }
            )

    def test_annotation_id_cannot_escape_annotation_directory(self):
        record = PaperRecord(
            paper_id="paper-1",
            title="Paper",
            task_id=None,
            root_dir=Path("paper"),
            auto_dir=Path("paper/auto"),
            updated_at=0,
            available_views=["linearized"],
            source_pdf=None,
            files={},
        )
        with self.assertRaisesRegex(FileNotFoundError, "标识非法"):
            annotation_file_path(record, "../../paper_profile")

    def test_legacy_long_paper_annotations_are_restored_after_hash_migration(self):
        record = PaperRecord(
            paper_id="p" * 121,
            title="Paper",
            task_id=None,
            root_dir=Path("paper"),
            auto_dir=Path("paper/auto"),
            updated_at=0,
            available_views=["linearized"],
            source_pdf=None,
            files={},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            memory_root = Path(temp_dir)
            legacy_annotations_dir = memory_root / "papers" / record.paper_id / "annotations"
            legacy_annotations_dir.mkdir(parents=True)
            (legacy_annotations_dir / "annotation-old.json").write_text(
                json.dumps(
                    {
                        "id": "annotation-old",
                        "paperId": record.paper_id,
                        "view": "linearized",
                        "quote": "Important sentence.",
                        "anchorTop": 10,
                        "anchorHeight": 24,
                        "createdAt": "2026-06-17T00:00:00",
                        "updatedAt": "2026-06-17T00:00:00",
                        "archived": False,
                        "comments": [
                            {
                                "id": "comment-old",
                                "authorType": "user",
                                "authorLabel": "me",
                                "content": "This old comment must stay visible.",
                                "createdAt": "2026-06-17T00:00:00",
                                "updatedAt": "2026-06-17T00:00:00",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with patch("gui_server.MEMORY_ROOT_DIR", memory_root):
                annotations = load_paper_annotations(record)

            self.assertEqual(len(annotations), 1)
            self.assertEqual(annotations[0]["comments"][0]["content"], "This old comment must stay visible.")
            migrated_path = (
                memory_root
                / "papers"
                / gui_memory.paper_memory_key(record)
                / "annotations"
                / "annotation-old.json"
            )
            self.assertTrue(migrated_path.exists())

    def test_upload_rejection_happens_before_reading_request_body(self):
        handler = object.__new__(GuiRequestHandler)
        handler.path = "/api/tasks/upload"
        handler.headers = {"X-File-Name": "paper.pdf"}
        handler.read_binary_body = Mock()
        handler.write_json = Mock()

        with patch(
            "gui_server.ensure_upload_ready",
            side_effect=ValueError("当前环境还不能上传"),
        ):
            handler.do_POST()

        handler.read_binary_body.assert_not_called()
        handler.write_json.assert_called_once_with(
            {"error": "当前环境还不能上传"},
            status=HTTPStatus.BAD_REQUEST,
        )

    def test_zotero_items_are_enriched_with_local_import_state(self):
        client = Mock()
        client.list_papers.return_value = [
            {
                "itemKey": "ABCD1234",
                "attachmentKey": "PDFD1234",
                "title": "Paper",
                "creators": [],
                "year": None,
                "fileName": "paper.pdf",
            }
        ]
        store = Mock()
        store.list_zotero_imports.return_value = [
            {
                "attachmentKey": "PDFD1234",
                "itemKey": "ABCD1234",
                "taskId": "task-1",
                "importedAt": "2026-06-14T16:30:00",
            }
        ]

        papers = list_zotero_papers(client=client, store=store)

        self.assertTrue(papers[0]["imported"])
        self.assertEqual(papers[0]["taskId"], "task-1")

    def test_duplicate_zotero_import_returns_existing_task(self):
        store = Mock()
        store.get_zotero_import.return_value = {
            "attachmentKey": "PDFD1234",
            "taskId": "task-existing",
        }
        store.get_task.return_value = {
            "id": "task-existing",
            "fileName": "paper.pdf",
        }
        client = Mock()

        task = import_zotero_paper("PDFD1234", client=client, store=store)

        self.assertEqual(task["id"], "task-existing")
        client.resolve_pdf.assert_not_called()

    def test_first_zotero_import_records_task_mapping(self):
        client = Mock()
        client.resolve_pdf.return_value = (
            Path("D:/Zotero/storage/PDFD1234/paper.pdf"),
            "paper.pdf",
            "ABCD1234",
        )
        store = Mock()
        store.get_zotero_import.return_value = None
        created_task = {
            "id": "task-new",
            "fileName": "paper.pdf",
        }

        with patch(
            "gui_server.create_upload_task_from_path",
            return_value=created_task,
        ):
            task = import_zotero_paper("PDFD1234", client=client, store=store)

        self.assertEqual(task, created_task)
        store.record_zotero_import.assert_called_once()
        self.assertEqual(
            store.record_zotero_import.call_args.args[:3],
            ("PDFD1234", "ABCD1234", "task-new"),
        )


if __name__ == "__main__":
    unittest.main()

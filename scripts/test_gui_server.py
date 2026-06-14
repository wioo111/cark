import unittest
from http import HTTPStatus
from pathlib import Path
from unittest.mock import Mock, patch

from gui_server import (
    GuiRequestHandler,
    PaperRecord,
    annotation_file_path,
    build_task_command,
    ensure_upload_ready,
    import_zotero_paper,
    list_zotero_papers,
    normalize_annotation_comment,
    prepare_gui_server,
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

        with patch("gui_server.discover_records", return_value={}):
            prepared, prepared_lock, interrupted = prepare_gui_server(
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
        self.assertEqual(events, ["bind", "mark", "sync"])
        prepared.server_close()
        prepared_lock.release()

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
        with self.assertRaisesRegex(ValueError, "只允许保存用户评论"):
            normalize_annotation_comment(
                {
                    "authorType": "agent",
                    "authorLabel": "Agent",
                    "content": "placeholder",
                    "status": "pending",
                }
            )
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

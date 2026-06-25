import tempfile
import unittest
from http import HTTPStatus
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from unittest.mock import Mock

import gui_routes_app


class FakeHandler:
    def __init__(self):
        self.headers = {}
        self.json_calls = []

    def write_json(self, payload, status=HTTPStatus.OK):
        self.json_calls.append((payload, status))


class ZoteroUnavailableError(RuntimeError):
    pass


class GuiRoutesAppTests(unittest.TestCase):
    def test_handle_get_search_parses_limit(self):
        handler = FakeHandler()
        search_records = Mock(return_value=[{"id": "result-1"}])

        handled = gui_routes_app.handle_get(
            handler,
            urlparse("/api/search?q=memory&limit=12"),
            load_settings=Mock(),
            detect_capabilities=Mock(),
            list_tasks=Mock(),
            build_agent_memory_payload=Mock(),
            zotero_status=Mock(),
            list_zotero_papers=Mock(),
            list_papers=Mock(),
            search_records=search_records,
        )

        self.assertTrue(handled)
        search_records.assert_called_once_with("memory", 12)
        self.assertEqual(handler.json_calls, [([{"id": "result-1"}], HTTPStatus.OK)])

    def test_handle_get_zotero_unavailable_returns_service_unavailable(self):
        handler = FakeHandler()

        handled = gui_routes_app.handle_get(
            handler,
            urlparse("/api/zotero/items?q=test"),
            load_settings=Mock(),
            detect_capabilities=Mock(),
            list_tasks=Mock(),
            build_agent_memory_payload=Mock(),
            zotero_status=Mock(),
            list_zotero_papers=Mock(side_effect=ZoteroUnavailableError("offline")),
            list_papers=Mock(),
            search_records=Mock(),
        )

        self.assertTrue(handled)
        self.assertEqual(handler.json_calls, [({"error": "offline"}, HTTPStatus.SERVICE_UNAVAILABLE)])

    def test_handle_post_upload_rejects_before_reading_binary_body(self):
        handler = FakeHandler()
        handler.headers = {"X-File-Name": "paper.pdf"}
        read_binary_body = Mock()

        handled = gui_routes_app.handle_post(
            handler,
            urlparse("/api/tasks/upload"),
            read_json_body=Mock(),
            read_binary_body=read_binary_body,
            save_settings=Mock(),
            create_agent_memory_item=Mock(),
            run_connection_test=Mock(),
            ensure_upload_ready=Mock(side_effect=ValueError("当前环境还不能上传")),
            create_upload_task=Mock(),
            import_zotero_paper=Mock(),
            retry_upload_task=Mock(),
            get_record=Mock(),
            resolve_open_target=Mock(),
            open_in_explorer=Mock(),
            runtime_output_dir=Path("."),
        )

        self.assertTrue(handled)
        read_binary_body.assert_not_called()
        self.assertEqual(handler.json_calls, [({"error": "当前环境还不能上传"}, HTTPStatus.BAD_REQUEST)])

    def test_handle_post_open_runtime_creates_directory(self):
        handler = FakeHandler()
        open_in_explorer = Mock()

        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_output_dir = Path(temp_dir) / "output"
            handled = gui_routes_app.handle_post(
                handler,
                urlparse("/api/actions/open-runtime"),
                read_json_body=Mock(),
                read_binary_body=Mock(),
                save_settings=Mock(),
                create_agent_memory_item=Mock(),
                run_connection_test=Mock(),
                ensure_upload_ready=Mock(),
                create_upload_task=Mock(),
                import_zotero_paper=Mock(),
                retry_upload_task=Mock(),
                get_record=Mock(),
                resolve_open_target=Mock(),
                open_in_explorer=open_in_explorer,
                runtime_output_dir=runtime_output_dir,
            )
            self.assertTrue(runtime_output_dir.exists())

        self.assertTrue(handled)
        open_in_explorer.assert_called_once_with(runtime_output_dir)
        self.assertEqual(handler.json_calls, [({"ok": True}, HTTPStatus.OK)])

    def test_handle_patch_agent_memory_updates_item(self):
        handler = FakeHandler()
        update_agent_memory_item = Mock(return_value={"id": "memory-1"})

        handled = gui_routes_app.handle_patch(
            handler,
            urlparse("/api/agent-memory/memory-1"),
            read_json_body=Mock(return_value={"text": "updated"}),
            update_agent_memory_item=update_agent_memory_item,
        )

        self.assertTrue(handled)
        update_agent_memory_item.assert_called_once_with("memory-1", {"text": "updated"})
        self.assertEqual(handler.json_calls, [({"id": "memory-1"}, HTTPStatus.OK)])

    def test_handle_patch_agent_memory_decodes_item_id(self):
        handler = FakeHandler()
        update_agent_memory_item = Mock(return_value={"id": "memory 1"})

        handled = gui_routes_app.handle_patch(
            handler,
            urlparse("/api/agent-memory/memory%201"),
            read_json_body=Mock(return_value={"text": "updated"}),
            update_agent_memory_item=update_agent_memory_item,
        )

        self.assertTrue(handled)
        update_agent_memory_item.assert_called_once_with("memory 1", {"text": "updated"})
        self.assertEqual(handler.json_calls, [({"id": "memory 1"}, HTTPStatus.OK)])

    def test_handle_delete_agent_memory_returns_payload(self):
        handler = FakeHandler()
        delete_agent_memory_item = Mock()
        build_agent_memory_payload = Mock(return_value={"items": []})

        handled = gui_routes_app.handle_delete(
            handler,
            urlparse("/api/agent-memory/memory-1"),
            delete_agent_memory_item=delete_agent_memory_item,
            build_agent_memory_payload=build_agent_memory_payload,
        )

        self.assertTrue(handled)
        delete_agent_memory_item.assert_called_once_with("memory-1")
        build_agent_memory_payload.assert_called_once_with("")
        self.assertEqual(handler.json_calls, [({"items": []}, HTTPStatus.OK)])

    def test_handle_delete_agent_memory_decodes_item_id(self):
        handler = FakeHandler()
        delete_agent_memory_item = Mock()
        build_agent_memory_payload = Mock(return_value={"items": []})

        handled = gui_routes_app.handle_delete(
            handler,
            urlparse("/api/agent-memory/memory%201"),
            delete_agent_memory_item=delete_agent_memory_item,
            build_agent_memory_payload=build_agent_memory_payload,
        )

        self.assertTrue(handled)
        delete_agent_memory_item.assert_called_once_with("memory 1")
        build_agent_memory_payload.assert_called_once_with("")
        self.assertEqual(handler.json_calls, [({"items": []}, HTTPStatus.OK)])


if __name__ == "__main__":
    unittest.main()

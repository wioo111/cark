import unittest
from http import HTTPStatus
from types import SimpleNamespace
from urllib.parse import urlparse
from unittest.mock import Mock

import gui_routes_papers


class FakeHandler:
    def __init__(self):
        self.json_calls = []
        self.file_calls = []

    def write_json(self, payload, status=HTTPStatus.OK):
        self.json_calls.append((payload, status))

    def serve_file(self, target):
        self.file_calls.append(target)


class GuiRoutesPapersTests(unittest.TestCase):
    def test_parse_paper_api_path(self):
        self.assertEqual(
            gui_routes_papers.parse_paper_api_path("/api/papers/paper-1/annotations"),
            ("paper-1", "/annotations"),
        )
        self.assertEqual(
            gui_routes_papers.parse_paper_api_path("/api/papers/paper-1"),
            ("paper-1", ""),
        )
        self.assertIsNone(gui_routes_papers.parse_paper_api_path("/api/search"))

    def test_parse_paper_api_path_decodes_encoded_id_and_trailing_slash(self):
        self.assertEqual(
            gui_routes_papers.parse_paper_api_path("/api/papers/paper%201/annotations/"),
            ("paper 1", "/annotations"),
        )

    def test_handle_get_returns_default_reading_state(self):
        handler = FakeHandler()
        record = SimpleNamespace(paper_id="paper-1")

        handled = gui_routes_papers.handle_get(
            handler,
            urlparse("/api/papers/paper-1/reading-state"),
            get_record=lambda _paper_id: record,
            build_detail=lambda _record: {},
            load_annotations=lambda _record: [],
            get_reading_state=lambda _paper_id: None,
            build_default_reading_state=lambda _record: {"paperId": "paper-1", "view": "linearized"},
            build_memory_payload=lambda _record: {},
            list_copilot_runs=lambda _record, _annotation_filter: [],
            resolve_media_path=lambda _record, _relative_path: None,
        )

        self.assertTrue(handled)
        self.assertEqual(
            handler.json_calls,
            [({"paperId": "paper-1", "view": "linearized"}, HTTPStatus.OK)],
        )

    def test_handle_get_media_requires_path_query(self):
        handler = FakeHandler()

        handled = gui_routes_papers.handle_get(
            handler,
            urlparse("/api/media/paper-1"),
            get_record=lambda _paper_id: None,
            build_detail=lambda _record: {},
            load_annotations=lambda _record: [],
            get_reading_state=lambda _paper_id: None,
            build_default_reading_state=lambda _record: {},
            build_memory_payload=lambda _record: {},
            list_copilot_runs=lambda _record, _annotation_filter: [],
            resolve_media_path=lambda _record, _relative_path: None,
        )

        self.assertTrue(handled)
        self.assertEqual(handler.json_calls, [({"error": "缺少 path 参数"}, HTTPStatus.BAD_REQUEST)])

    def test_handle_get_unknown_paper_subroute_returns_not_found(self):
        handler = FakeHandler()
        record = SimpleNamespace(paper_id="paper-1")

        handled = gui_routes_papers.handle_get(
            handler,
            urlparse("/api/papers/paper-1/unknown"),
            get_record=lambda _paper_id: record,
            build_detail=lambda _record: {},
            load_annotations=lambda _record: [],
            get_reading_state=lambda _paper_id: None,
            build_default_reading_state=lambda _record: {},
            build_memory_payload=lambda _record: {},
            list_copilot_runs=lambda _record, _annotation_filter: [],
            resolve_media_path=lambda _record, _relative_path: None,
        )

        self.assertTrue(handled)
        self.assertEqual(handler.json_calls, [({"error": "未知接口"}, HTTPStatus.NOT_FOUND)])

    def test_handle_post_annotation_refreshes_index(self):
        handler = FakeHandler()
        record = SimpleNamespace(paper_id="paper-1")
        create_annotation = Mock()
        refresh_index = Mock()
        load_annotations = Mock(return_value=[{"id": "annotation-1"}])

        handled = gui_routes_papers.handle_post(
            handler,
            urlparse("/api/papers/paper-1/annotations"),
            {"quote": "hello"},
            get_record=lambda _paper_id: record,
            create_annotation=create_annotation,
            invoke_annotation_agent=Mock(),
            create_copilot_run=Mock(),
            cancel_copilot_run=Mock(),
            retry_copilot_run=Mock(),
            export_markdown=Mock(),
            load_annotation=Mock(),
            create_memory_from_annotation=Mock(),
            append_annotation_comment=Mock(),
            create_memory_item=Mock(),
            create_memory_note=Mock(),
            load_annotations=load_annotations,
            build_memory_payload=Mock(),
            refresh_index=refresh_index,
        )

        self.assertTrue(handled)
        create_annotation.assert_called_once_with(record, {"quote": "hello"})
        refresh_index.assert_called_once_with(record)
        self.assertEqual(handler.json_calls, [([{"id": "annotation-1"}], HTTPStatus.OK)])

    def test_handle_post_annotation_comment_decodes_annotation_id(self):
        handler = FakeHandler()
        record = SimpleNamespace(paper_id="paper-1")
        append_annotation_comment = Mock()
        refresh_index = Mock()
        load_annotations = Mock(return_value=[{"id": "annotation 1"}])

        handled = gui_routes_papers.handle_post(
            handler,
            urlparse("/api/papers/paper-1/annotations/annotation%201/comments"),
            {"content": "hello"},
            get_record=lambda _paper_id: record,
            create_annotation=Mock(),
            invoke_annotation_agent=Mock(),
            create_copilot_run=Mock(),
            cancel_copilot_run=Mock(),
            retry_copilot_run=Mock(),
            export_markdown=Mock(),
            load_annotation=Mock(),
            create_memory_from_annotation=Mock(),
            append_annotation_comment=append_annotation_comment,
            create_memory_item=Mock(),
            create_memory_note=Mock(),
            load_annotations=load_annotations,
            build_memory_payload=Mock(),
            refresh_index=refresh_index,
        )

        self.assertTrue(handled)
        append_annotation_comment.assert_called_once_with(record, "annotation 1", {"content": "hello"})
        refresh_index.assert_called_once_with(record)
        self.assertEqual(handler.json_calls, [([{"id": "annotation 1"}], HTTPStatus.OK)])

    def test_handle_delete_memory_refreshes_index(self):
        handler = FakeHandler()
        record = SimpleNamespace(paper_id="paper-1")
        delete_memory_item = Mock()
        refresh_index = Mock()

        handled = gui_routes_papers.handle_delete(
            handler,
            urlparse("/api/papers/paper-1/memory/items/item-1"),
            get_record=lambda _paper_id: record,
            delete_memory_item=delete_memory_item,
            delete_annotation=Mock(),
            build_memory_payload=lambda _record: {"items": []},
            load_annotations=Mock(),
            refresh_index=refresh_index,
        )

        self.assertTrue(handled)
        delete_memory_item.assert_called_once_with(record, "item-1")
        refresh_index.assert_called_once_with(record)
        self.assertEqual(handler.json_calls, [({"items": []}, HTTPStatus.OK)])

    def test_handle_delete_annotation_decodes_annotation_id(self):
        handler = FakeHandler()
        record = SimpleNamespace(paper_id="paper-1")
        delete_annotation = Mock()
        refresh_index = Mock()
        load_annotations = Mock(return_value=[])

        handled = gui_routes_papers.handle_delete(
            handler,
            urlparse("/api/papers/paper-1/annotations/annotation%201"),
            get_record=lambda _paper_id: record,
            delete_memory_item=Mock(),
            delete_annotation=delete_annotation,
            build_memory_payload=lambda _record: {"items": []},
            load_annotations=load_annotations,
            refresh_index=refresh_index,
        )

        self.assertTrue(handled)
        delete_annotation.assert_called_once_with(record, "annotation 1")
        refresh_index.assert_called_once_with(record)
        self.assertEqual(handler.json_calls, [([], HTTPStatus.OK)])

    def test_handle_patch_annotation_comment_decodes_ids(self):
        handler = FakeHandler()
        record = SimpleNamespace(paper_id="paper-1")
        update_annotation_comment = Mock()
        refresh_index = Mock()
        load_annotations = Mock(return_value=[{"id": "annotation 1"}])

        handled = gui_routes_papers.handle_patch(
            handler,
            urlparse("/api/papers/paper-1/annotations/annotation%201/comments/comment%202"),
            {"content": "updated"},
            get_record=lambda _paper_id: record,
            update_library=Mock(),
            build_paper_summary=Mock(),
            update_memory_item=Mock(),
            update_annotation_comment=update_annotation_comment,
            update_annotation=Mock(),
            build_memory_payload=Mock(),
            load_annotations=load_annotations,
            refresh_index=refresh_index,
        )

        self.assertTrue(handled)
        update_annotation_comment.assert_called_once_with(record, "annotation 1", "comment 2", {"content": "updated"})
        refresh_index.assert_called_once_with(record)
        self.assertEqual(handler.json_calls, [([{"id": "annotation 1"}], HTTPStatus.OK)])


if __name__ == "__main__":
    unittest.main()

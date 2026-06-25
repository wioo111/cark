from __future__ import annotations

from typing import Any, Callable

import gui_paper_index
import gui_papers
import gui_upload_tasks


class PaperRecordsFacade:
    def __init__(
        self,
        *,
        store_getter: Callable[[], Any],
        memory_root_getter: Callable[[], Any],
        current_timestamp_iso_getter: Callable[[], Callable[[], str]],
        discover_records_getter: Callable[[], Callable[..., dict[str, Any]]],
        serialize_record_getter: Callable[[], Callable[[Any], dict[str, object]]],
        deserialize_record_getter: Callable[[], Callable[[dict[str, object]], Any]],
        indexed_records_getter: Callable[[], Callable[..., dict[str, Any]]],
        decode_paper_id_getter: Callable[[], Callable[[str], tuple[str | None, str | None]]],
        load_markdown_getter: Callable[[], Callable[[Any], Any]],
        load_annotations_getter: Callable[[], Callable[[Any], list[dict[str, object]]]],
        normalize_text_value_getter: Callable[[], Callable[[Any], str]],
        normalize_string_list_getter: Callable[[], Callable[[Any], list[str]]],
    ) -> None:
        self._store_getter = store_getter
        self._memory_root_getter = memory_root_getter
        self._current_timestamp_iso_getter = current_timestamp_iso_getter
        self._discover_records_getter = discover_records_getter
        self._serialize_record_getter = serialize_record_getter
        self._deserialize_record_getter = deserialize_record_getter
        self._indexed_records_getter = indexed_records_getter
        self._decode_paper_id_getter = decode_paper_id_getter
        self._load_markdown_getter = load_markdown_getter
        self._load_annotations_getter = load_annotations_getter
        self._normalize_text_value_getter = normalize_text_value_getter
        self._normalize_string_list_getter = normalize_string_list_getter

    def find_record_for_output(self, payload: dict[str, object]) -> Any | None:
        return gui_upload_tasks.find_record_for_output(
            payload,
            indexed_records_func=self._indexed_records_getter(),
        )

    def sync_paper_index(self, store: Any | None = None) -> None:
        gui_paper_index.sync_paper_index(
            store or self._store_getter(),
            discover_records=self._discover_records_getter(),
            serialize_record=self._serialize_record_getter(),
            memory_root=self._memory_root_getter(),
            load_markdown=self._load_markdown_getter(),
            load_annotations=self._load_annotations_getter(),
            current_timestamp_iso=self._current_timestamp_iso_getter(),
        )

    def refresh_record_search_index(self, record: Any) -> None:
        gui_paper_index.refresh_record_search_index(
            self._store_getter(),
            record,
            memory_root=self._memory_root_getter(),
            load_markdown=self._load_markdown_getter(),
            load_annotations=self._load_annotations_getter(),
            current_timestamp_iso=self._current_timestamp_iso_getter(),
        )

    def indexed_records(self, *, refresh: bool = False) -> dict[str, Any]:
        return gui_papers.indexed_records(
            store=self._store_getter(),
            deserialize_record=self._deserialize_record_getter(),
            refresh=refresh,
            sync_paper_index=self.sync_paper_index,
        )

    def get_record(self, paper_id: str) -> Any:
        return gui_papers.get_record(
            paper_id,
            indexed_records_func=self._indexed_records_getter(),
            decode_paper_id=self._decode_paper_id_getter(),
        )

    def load_blocks(self, record: Any) -> list[dict[str, object]]:
        return gui_papers.load_blocks(
            record,
            normalize_text_value=self._normalize_text_value_getter(),
            normalize_string_list=self._normalize_string_list_getter(),
        )

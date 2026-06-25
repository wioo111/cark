from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import gui_search


PaperDiscoverer = Callable[[], dict[str, Any]]
PaperSerializer = Callable[[Any], dict[str, object]]
TimestampFactory = Callable[[], str]
MarkdownLoader = gui_search.SearchMarkdownLoader
AnnotationLoader = gui_search.SearchAnnotationLoader

PAPER_INDEX_KEYS = (
    "id",
    "title",
    "taskId",
    "rootDir",
    "autoDir",
    "updatedAt",
    "availableViews",
    "sourcePdf",
    "files",
)


def sync_paper_index(
    store: Any,
    *,
    discover_records: PaperDiscoverer,
    serialize_record: PaperSerializer,
    memory_root: Path,
    load_markdown: MarkdownLoader,
    load_annotations: AnnotationLoader,
    current_timestamp_iso: TimestampFactory,
) -> dict[str, Any]:
    discovered = discover_records()
    indexed_at = current_timestamp_iso()
    serialized_records = {
        paper_id: serialize_record(record)
        for paper_id, record in discovered.items()
    }
    existing_records = {
        str(payload.get("id") or ""): normalize_paper_payload(payload)
        for payload in store.list_papers()
        if isinstance(payload, dict) and str(payload.get("id") or "")
    }
    changed_records = [
        record
        for paper_id, record in discovered.items()
        if normalize_paper_payload(serialized_records[paper_id]) != existing_records.get(paper_id)
    ]
    removed_paper_ids = sorted(existing_records.keys() - serialized_records.keys())

    if removed_paper_ids:
        store.sync_papers(list(serialized_records.values()), indexed_at)
    elif changed_records:
        store.upsert_papers(
            [serialized_records[record.paper_id] for record in changed_records],
            indexed_at,
        )

    if hasattr(store, "replace_search_entries_for_papers"):
        if removed_paper_ids:
            store.replace_search_entries_for_papers(removed_paper_ids, [], indexed_at)
        for record in changed_records:
            store.replace_search_entries_for_papers(
                [record.paper_id],
                build_record_search_entries(
                    record,
                    memory_root=memory_root,
                    load_markdown=load_markdown,
                    load_annotations=load_annotations,
                ),
                indexed_at,
            )
    elif changed_records or removed_paper_ids:
        store.replace_search_entries(
            gui_search.build_search_index(
                discovered.values(),
                memory_root=memory_root,
                load_markdown=load_markdown,
                load_annotations=load_annotations,
            ),
            indexed_at,
        )

    return discovered


def refresh_record_search_index(
    store: Any,
    record: Any,
    *,
    memory_root: Path,
    load_markdown: MarkdownLoader,
    load_annotations: AnnotationLoader,
    current_timestamp_iso: TimestampFactory,
) -> None:
    if not hasattr(store, "replace_search_entries_for_papers"):
        return
    store.replace_search_entries_for_papers(
        [str(record.paper_id)],
        build_record_search_entries(
            record,
            memory_root=memory_root,
            load_markdown=load_markdown,
            load_annotations=load_annotations,
        ),
        current_timestamp_iso(),
    )


def build_record_search_entries(
    record: Any,
    *,
    memory_root: Path,
    load_markdown: MarkdownLoader,
    load_annotations: AnnotationLoader,
) -> list[dict[str, object]]:
    return gui_search.build_record_search_index(
        record,
        memory_root=memory_root,
        load_markdown=load_markdown,
        load_annotations=load_annotations,
    )


def normalize_paper_payload(payload: dict[str, object]) -> dict[str, object]:
    normalized: dict[str, object] = {}
    for key in PAPER_INDEX_KEYS:
        value = payload.get(key)
        if key == "availableViews" and isinstance(value, list):
            normalized[key] = [str(item) for item in value]
        elif key == "files" and isinstance(value, dict):
            normalized[key] = {str(name): value.get(name) for name in sorted(value.keys())}
        else:
            normalized[key] = value
    return normalized

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

import gui_agent_memory
import gui_memory


def list_memory_candidates(memory_root: Path, records: Iterable[Any]) -> dict[str, object]:
    items: list[dict[str, object]] = []
    for item in gui_agent_memory.load_agent_memory_items(memory_root, include_archived=True):
        if item.get("activationStatus") == "candidate":
            items.append(decorate_global_candidate(item))
    for record in records:
        for item in gui_memory.load_memory_items(record, memory_root):
            if item.get("activationStatus") == "candidate":
                items.append(decorate_paper_candidate(record, item))
    items.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
    return {
        "items": items,
        "count": len(items),
    }


def activate_memory_candidate(memory_root: Path, item_id: str, records: Iterable[Any]) -> dict[str, object]:
    if item_id.startswith("agent-memory-"):
        item = gui_agent_memory.update_agent_memory_item(
            memory_root,
            item_id,
            {"activationStatus": "active", "status": "active"},
            revision_reason="activate",
        )
        return decorate_global_candidate(item)
    record = find_record_for_memory_item(memory_root, records, item_id)
    item = gui_memory.update_memory_item(
        record,
        memory_root,
        item_id,
        {"activationStatus": "active", "status": "active"},
        revision_reason="activate",
    )
    return decorate_paper_candidate(record, item)


def archive_memory_candidate(memory_root: Path, item_id: str, records: Iterable[Any]) -> dict[str, object]:
    if item_id.startswith("agent-memory-"):
        item = gui_agent_memory.update_agent_memory_item(
            memory_root,
            item_id,
            {"activationStatus": "archived", "status": "archived"},
            revision_reason="archive",
        )
        return decorate_global_candidate(item)
    record = find_record_for_memory_item(memory_root, records, item_id)
    item = gui_memory.update_memory_item(
        record,
        memory_root,
        item_id,
        {"activationStatus": "archived", "status": "archived"},
        revision_reason="archive",
    )
    return decorate_paper_candidate(record, item)


def find_record_for_memory_item(memory_root: Path, records: Iterable[Any], item_id: str) -> Any:
    for record in records:
        if gui_memory.memory_item_file_path(record, memory_root, item_id).exists():
            return record
    raise FileNotFoundError("memory candidate not found")


def decorate_paper_candidate(record: Any, item: dict[str, object]) -> dict[str, object]:
    return {
        **item,
        "layer": "paper",
        "paperId": str(record.paper_id),
        "paperTitle": str(record.title),
    }


def decorate_global_candidate(item: dict[str, object]) -> dict[str, object]:
    return {
        **item,
        "layer": "global",
        "paperId": None,
        "paperTitle": None,
    }

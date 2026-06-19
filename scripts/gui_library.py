from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import gui_memory


READING_STATUSES = {"unread", "reading", "done"}


def current_timestamp_iso() -> str:
    return datetime.now().isoformat()


def library_meta_path(record: Any, memory_root: Path) -> Path:
    gui_memory.migrate_legacy_paper_memory(record, memory_root)
    return gui_memory.paper_memory_dir(record, memory_root) / "library_meta.json"


def load_library_meta(record: Any, memory_root: Path, *, reading_state: dict[str, object] | None = None) -> dict[str, object]:
    path = library_meta_path(record, memory_root)
    payload: dict[str, object] = {}
    if path.exists():
        loaded = gui_memory.read_json_file(path, default={})
        if isinstance(loaded, dict):
            payload = loaded

    has_explicit_status = "readingStatus" in payload
    reading_status = normalize_reading_status(payload.get("readingStatus"))
    if not has_explicit_status and reading_state:
        reading_status = "reading"

    return {
        "favorite": bool(payload.get("favorite")),
        "tags": normalize_tags(payload.get("tags")),
        "readingStatus": reading_status,
        "libraryUpdatedAt": payload.get("updatedAt") if isinstance(payload.get("updatedAt"), str) else None,
        "lastReadAt": reading_state.get("updatedAt") if reading_state and isinstance(reading_state.get("updatedAt"), str) else None,
    }


def update_library_meta(record: Any, memory_root: Path, payload: dict[str, object]) -> dict[str, object]:
    current = load_library_meta(record, memory_root)
    next_payload = dict(current)
    if "favorite" in payload:
        next_payload["favorite"] = bool(payload.get("favorite"))
    if "tags" in payload:
        next_payload["tags"] = normalize_tags(payload.get("tags"))
    if "readingStatus" in payload:
        next_payload["readingStatus"] = normalize_reading_status(payload.get("readingStatus"))
    next_payload["updatedAt"] = current_timestamp_iso()

    path = library_meta_path(record, memory_root)
    gui_memory.write_json_file(
        path,
        {
            "favorite": next_payload["favorite"],
            "tags": next_payload["tags"],
            "readingStatus": next_payload["readingStatus"],
            "updatedAt": next_payload["updatedAt"],
        },
    )
    return load_library_meta(record, memory_root)


def normalize_reading_status(value: object) -> str:
    return str(value) if value in READING_STATUSES else "unread"


def normalize_tags(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    tags: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        tag = " ".join(item.strip().split())
        if tag and tag not in tags:
            tags.append(tag)
        if len(tags) >= 12:
            break
    return tags

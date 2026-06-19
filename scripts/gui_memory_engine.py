from __future__ import annotations

from datetime import datetime
from typing import Any


MEMORY_LAYERS = {"working", "paper", "global"}
MEMORY_ACTIVATION_STATUSES = {"candidate", "active", "archived"}


def current_timestamp_iso() -> str:
    return datetime.now().isoformat()


def optional_string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def normalize_string_list(value: object, *, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            normalized = " ".join(item.strip().split())
            if normalized not in items:
                items.append(normalized)
        if len(items) >= limit:
            break
    return items


def normalize_confidence(value: object, *, default: float = 0.75) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(0.0, min(number, 1.0))


def normalize_activation_status(value: object, *, default: str = "active") -> str:
    status = str(value or default).strip().lower()
    if status not in MEMORY_ACTIVATION_STATUSES:
        return default
    return status


def normalize_source(value: object, *, default: dict[str, object] | None = None) -> dict[str, object] | None:
    source: dict[str, object] = {}
    raw = value if isinstance(value, dict) else default if isinstance(default, dict) else {}
    if not isinstance(raw, dict):
        return None
    for key in ("kind", "paperId", "annotationId", "commentId", "runId", "memoryId", "note", "userAction"):
        normalized = optional_string(raw.get(key))
        if normalized:
            source[key] = normalized
    return source or None


def normalize_evidence(value: object, *, limit: int = 8) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    items: list[dict[str, object]] = []
    seen: set[tuple[tuple[str, object], ...]] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        normalized: dict[str, object] = {}
        for key in ("kind", "quote", "contextBefore", "contextAfter", "blockId", "annotationId", "commentId", "view"):
            text = optional_string(item.get(key))
            if text:
                normalized[key] = text
        if not normalized:
            continue
        signature = tuple(sorted(normalized.items()))
        if signature in seen:
            continue
        seen.add(signature)
        items.append(normalized)
        if len(items) >= limit:
            break
    return items


def normalize_reference_ids(value: object, *, limit: int = 12) -> list[str]:
    return normalize_string_list(value, limit=limit)


def normalize_revision_history(value: object, *, limit: int = 24) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    history: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        updated_at = optional_string(item.get("updatedAt")) or current_timestamp_iso()
        snapshot = {
            "updatedAt": updated_at,
            "reason": optional_string(item.get("reason")) or "snapshot",
            "text": optional_string(item.get("text")) or "",
            "status": optional_string(item.get("status")) or "",
            "activationStatus": normalize_activation_status(item.get("activationStatus"), default="active"),
            "confidence": normalize_confidence(item.get("confidence"), default=0.75),
        }
        history.append(snapshot)
        if len(history) >= limit:
            break
    return history


def build_revision_snapshot(item: dict[str, object], *, reason: str) -> dict[str, object]:
    return {
        "updatedAt": optional_string(item.get("updatedAt")) or current_timestamp_iso(),
        "reason": reason,
        "text": optional_string(item.get("text")) or "",
        "status": optional_string(item.get("status")) or "",
        "activationStatus": normalize_activation_status(item.get("activationStatus"), default="active"),
        "confidence": normalize_confidence(item.get("confidence"), default=0.75),
    }


def append_revision_snapshot(
    history: list[dict[str, object]],
    snapshot: dict[str, object],
    *,
    limit: int = 24,
) -> list[dict[str, object]]:
    next_history = [snapshot, *history]
    return next_history[:limit]

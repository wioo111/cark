from __future__ import annotations

import json
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import gui_memory
import gui_memory_engine


AGENT_MEMORY_TYPES = {"profile", "preference", "research_interest", "instruction", "project", "concept"}
AGENT_MEMORY_STATUSES = {"active", "archived"}
AGENT_MEMORY_ID_RE = re.compile(r"^agent-memory-[A-Za-z0-9_-]+$")
_AGENT_MEMORY_LOCK = threading.RLock()


def current_timestamp_iso() -> str:
    return datetime.now().isoformat()


def agent_memory_path(memory_root: Path) -> Path:
    return memory_root / "agent" / "memory.json"


def load_agent_memory_items(memory_root: Path, *, include_archived: bool = False) -> list[dict[str, object]]:
    path = agent_memory_path(memory_root)
    if not path.exists():
        return []
    payload = gui_memory.read_json_file(path, default={})
    raw_items = payload.get("items") if isinstance(payload, dict) else payload
    if not isinstance(raw_items, list):
        return []
    items: list[dict[str, object]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        try:
            normalized = normalize_agent_memory_item(item)
        except ValueError:
            continue
        if include_archived or normalized.get("status") == "active":
            items.append(normalized)
    return sorted(items, key=lambda item: str(item.get("updatedAt") or ""), reverse=True)


def build_agent_memory_payload(memory_root: Path, *, query: str = "") -> dict[str, object]:
    items = load_agent_memory_items(memory_root, include_archived=True)
    active_items = [item for item in items if is_behavioral_agent_memory(item)]
    candidate_items = [item for item in items if item.get("activationStatus") == "candidate"]
    relevant_items = select_relevant_agent_memory(memory_root, query, limit=12) if query.strip() else active_items[:12]
    return {
        "items": items,
        "activeItems": active_items,
        "candidateItems": candidate_items,
        "relevantItems": relevant_items,
        "itemCount": len(items),
        "activeCount": len(active_items),
        "candidateCount": len(candidate_items),
        "lastUpdated": items[0]["updatedAt"] if items else None,
    }


def find_duplicate_agent_memory_item(
    items: list[dict[str, object]],
    candidate: dict[str, object],
    *,
    exclude_id: str | None = None,
) -> dict[str, object] | None:
    candidate_text = gui_memory_engine.canonical_memory_text(candidate.get("text"))
    candidate_type = str(candidate.get("type") or "")
    if not candidate_text or not candidate_type:
        return None
    for item in items:
        if exclude_id and str(item.get("id")) == exclude_id:
            continue
        if str(item.get("type") or "") != candidate_type:
            continue
        if gui_memory_engine.canonical_memory_text(item.get("text")) == candidate_text:
            return item
    return None


def merge_duplicate_agent_memory_item(
    existing: dict[str, object],
    incoming: dict[str, object],
) -> dict[str, object]:
    normalized_existing = normalize_agent_memory_item(existing)
    existing_status = str(existing.get("status") or "active")
    incoming_status = str(incoming.get("status") or existing_status)
    merged = {
        **existing,
        "updatedAt": incoming.get("updatedAt") or current_timestamp_iso(),
        "status": incoming_status if existing_status == "archived" and incoming_status != "archived" else existing_status,
        "activationStatus": gui_memory_engine.prefer_activation_status(
            existing.get("activationStatus"),
            incoming.get("activationStatus"),
            default="active",
        ),
        "confidence": max(
            gui_memory_engine.normalize_confidence(existing.get("confidence"), default=0.0),
            gui_memory_engine.normalize_confidence(incoming.get("confidence"), default=0.0),
        ),
        "tags": gui_memory_engine.merge_unique_strings(existing.get("tags"), incoming.get("tags"), limit=12),
        "source": gui_memory_engine.merge_sources(existing.get("source"), incoming.get("source")),
        "evidence": gui_memory_engine.merge_evidence_lists(existing.get("evidence"), incoming.get("evidence"), limit=8),
        "derivedFrom": gui_memory_engine.merge_reference_ids(existing.get("derivedFrom"), incoming.get("derivedFrom"), limit=12),
        "conflictsWith": gui_memory_engine.merge_reference_ids(
            existing.get("conflictsWith"),
            incoming.get("conflictsWith"),
            limit=12,
        ),
    }
    item = normalize_agent_memory_item(merged)
    if has_material_agent_memory_change(normalized_existing, item):
        item["revisionHistory"] = gui_memory_engine.append_revision_snapshot(
            item.get("revisionHistory") if isinstance(item.get("revisionHistory"), list) else [],
            gui_memory_engine.build_revision_snapshot(normalized_existing, reason="duplicate"),
        )
    return item


def build_agent_conflict_link_updates(
    items: list[dict[str, object]],
    item: dict[str, object],
) -> list[dict[str, object]]:
    item_id = str(item.get("id") or "")
    if not item_id:
        return []
    conflict_ids = set(gui_memory_engine.normalize_reference_ids(item.get("conflictsWith"), limit=12))
    if not conflict_ids:
        return []
    updates: list[dict[str, object]] = []
    for existing in items:
        existing_id = str(existing.get("id") or "")
        if not existing_id or existing_id == item_id or existing_id not in conflict_ids:
            continue
        normalized_existing = normalize_agent_memory_item(existing)
        merged = {
            **existing,
            "updatedAt": item.get("updatedAt") or current_timestamp_iso(),
            "conflictsWith": gui_memory_engine.merge_reference_ids(existing.get("conflictsWith"), [item_id], limit=12),
        }
        updated = normalize_agent_memory_item(merged)
        if has_material_agent_memory_change(normalized_existing, updated):
            updated["revisionHistory"] = gui_memory_engine.append_revision_snapshot(
                updated.get("revisionHistory") if isinstance(updated.get("revisionHistory"), list) else [],
                gui_memory_engine.build_revision_snapshot(normalized_existing, reason="conflict-link"),
            )
        updates.append(updated)
    return updates


def create_agent_memory_item(memory_root: Path, payload: dict[str, object]) -> dict[str, object]:
    timestamp = current_timestamp_iso()
    item_id = f"agent-memory-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    item = normalize_agent_memory_item(
        {
            **payload,
            "id": item_id,
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
    )
    with _AGENT_MEMORY_LOCK:
        items = load_agent_memory_items(memory_root, include_archived=True)
        duplicate = find_duplicate_agent_memory_item(items, item, exclude_id=str(item["id"]))
        if duplicate is not None:
            item = merge_duplicate_agent_memory_item(duplicate, item)
        related_updates = build_agent_conflict_link_updates(items, item)
        replaced_ids = {str(item.get("id") or "")} | {str(updated.get("id") or "") for updated in related_updates}
        items = [item, *related_updates, *[existing for existing in items if str(existing.get("id") or "") not in replaced_ids]]
        write_items(memory_root, items)
    return item


def update_agent_memory_item(memory_root: Path, item_id: str, payload: dict[str, object]) -> dict[str, object]:
    validate_agent_memory_id(item_id)
    with _AGENT_MEMORY_LOCK:
        items = load_agent_memory_items(memory_root, include_archived=True)
        for index, existing in enumerate(items):
            if existing.get("id") != item_id:
                continue
            normalized_existing = normalize_agent_memory_item(existing)
            merged = dict(existing)
            for key in ("type", "text", "tags", "source", "confidence", "status", "activationStatus", "evidence", "derivedFrom", "conflictsWith"):
                if key in payload:
                    merged[key] = payload[key]
            merged["id"] = item_id
            merged["createdAt"] = existing.get("createdAt") or current_timestamp_iso()
            merged["updatedAt"] = current_timestamp_iso()
            item = normalize_agent_memory_item(merged)
            if has_material_agent_memory_change(normalized_existing, item):
                item["revisionHistory"] = gui_memory_engine.append_revision_snapshot(
                    item.get("revisionHistory") if isinstance(item.get("revisionHistory"), list) else [],
                    gui_memory_engine.build_revision_snapshot(normalized_existing, reason="update"),
                )
            items[index] = item
            write_items(memory_root, items)
            return item
    raise FileNotFoundError("未找到指定智能体记忆")


def delete_agent_memory_item(memory_root: Path, item_id: str) -> None:
    validate_agent_memory_id(item_id)
    with _AGENT_MEMORY_LOCK:
        items = load_agent_memory_items(memory_root, include_archived=True)
        next_items = [item for item in items if item.get("id") != item_id]
        if len(next_items) == len(items):
            raise FileNotFoundError("未找到指定智能体记忆")
        write_items(memory_root, next_items)


def select_relevant_agent_memory(memory_root: Path, query: str, *, limit: int = 8) -> list[dict[str, object]]:
    terms = parse_terms(query)
    active_items = [item for item in load_agent_memory_items(memory_root) if is_behavioral_agent_memory(item)]
    if not active_items:
        return []
    if not terms:
        return active_items[:limit]
    scored: list[tuple[int, dict[str, object]]] = []
    for item in active_items:
        haystack = normalize_for_search(
            " ".join(
                part
                for part in [
                    str(item.get("type") or ""),
                    str(item.get("text") or ""),
                    " ".join(str(tag) for tag in item.get("tags", []) if isinstance(tag, str)),
                    source_to_text(item.get("source")),
                ]
                if part
            )
        )
        score = sum(haystack.count(term) for term in terms)
        if score > 0:
            scored.append((score, item))
    scored.sort(key=lambda pair: (-pair[0], str(pair[1].get("updatedAt") or "")), reverse=False)
    return [item for _score, item in scored[: max(1, min(limit, 24))]]


def render_agent_memory_context(memory_root: Path, query: str, *, limit: int = 8) -> str:
    items = select_relevant_agent_memory(memory_root, query, limit=limit)
    if not items:
        return ""
    lines: list[str] = []
    for index, item in enumerate(items, start=1):
        tags = item.get("tags") if isinstance(item.get("tags"), list) else []
        tag_text = f" 标签：{', '.join(str(tag) for tag in tags)}" if tags else ""
        confidence = item.get("confidence")
        confidence_text = f" 置信度：{confidence:.2f}" if isinstance(confidence, float) else ""
        lines.append(
            f"{index}. [{agent_memory_type_label(str(item.get('type') or 'profile'))}] "
            f"{str(item.get('text') or '').strip()}{tag_text}{confidence_text}"
        )
    return "\n".join(lines)


def normalize_agent_memory_item(payload: dict[str, object]) -> dict[str, object]:
    item_id = payload.get("id")
    if not isinstance(item_id, str) or AGENT_MEMORY_ID_RE.fullmatch(item_id) is None:
        raise ValueError("agent memory id is invalid")

    item_type = payload.get("type")
    if item_type not in AGENT_MEMORY_TYPES:
        raise ValueError("agent memory type is invalid")

    text = payload.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("agent memory text cannot be empty")
    text = text.strip()

    status = payload.get("status") or "active"
    if status not in AGENT_MEMORY_STATUSES:
        raise ValueError("agent memory status is invalid")

    created_at = payload.get("createdAt") if isinstance(payload.get("createdAt"), str) else current_timestamp_iso()
    updated_at = payload.get("updatedAt") if isinstance(payload.get("updatedAt"), str) else created_at
    activation_status = gui_memory_engine.normalize_activation_status(payload.get("activationStatus"), default="active")
    default_confidence = 0.68 if activation_status == "candidate" else 0.88

    item = {
        "id": item_id,
        "memoryLayer": "global",
        "type": item_type,
        "text": text,
        "tags": normalize_string_list(payload.get("tags"), limit=12),
        "source": normalize_source(
            payload.get("source"),
            default={"kind": "manual"},
        ),
        "evidence": gui_memory_engine.normalize_evidence(payload.get("evidence")),
        "confidence": gui_memory_engine.normalize_confidence(payload.get("confidence"), default=default_confidence),
        "status": status,
        "activationStatus": activation_status,
        "derivedFrom": gui_memory_engine.normalize_reference_ids(payload.get("derivedFrom"), limit=12),
        "conflictsWith": gui_memory_engine.normalize_reference_ids(payload.get("conflictsWith"), limit=12),
        "createdAt": created_at,
        "updatedAt": updated_at,
    }
    revision_history = gui_memory_engine.normalize_revision_history(payload.get("revisionHistory"))
    item["revisionHistory"] = revision_history or [gui_memory_engine.build_revision_snapshot(item, reason="created")]
    return item


def normalize_source(value: object, *, default: dict[str, object] | None = None) -> dict[str, object] | None:
    return gui_memory_engine.normalize_source(value, default=default)


def normalize_confidence(value: object) -> float:
    return gui_memory_engine.normalize_confidence(value, default=0.65)


def normalize_string_list(value: object, *, limit: int) -> list[str]:
    return gui_memory_engine.normalize_string_list(value, limit=limit)


def validate_agent_memory_id(item_id: str) -> None:
    if AGENT_MEMORY_ID_RE.fullmatch(str(item_id).strip()) is None:
        raise FileNotFoundError("智能体记忆标识非法")


def write_items(memory_root: Path, items: list[dict[str, object]]) -> None:
    path = agent_memory_path(memory_root)
    gui_memory.write_json_file(path, {"items": items})


def parse_terms(query: str) -> list[str]:
    return [
        term
        for term in re.split(r"\s+", normalize_for_search(query))
        if len(term) >= 2
    ][:12]


def normalize_for_search(value: str) -> str:
    return re.sub(r"\s+", " ", value.casefold()).strip()


def source_to_text(source: object) -> str:
    if not isinstance(source, dict):
        return ""
    return " ".join(str(value) for value in source.values() if isinstance(value, str))


def agent_memory_type_label(item_type: str) -> str:
    labels = {
        "profile": "用户画像",
        "preference": "偏好",
        "research_interest": "研究兴趣",
        "instruction": "长期指令",
        "project": "项目上下文",
        "concept": "概念记忆",
    }
    return labels.get(item_type, item_type)


def is_behavioral_agent_memory(item: dict[str, object]) -> bool:
    return str(item.get("status") or "active") == "active" and str(item.get("activationStatus") or "active") == "active"


def has_material_agent_memory_change(left: dict[str, object], right: dict[str, object]) -> bool:
    tracked_keys = (
        "type",
        "text",
        "tags",
        "source",
        "evidence",
        "confidence",
        "status",
        "activationStatus",
        "derivedFrom",
        "conflictsWith",
    )
    return any(left.get(key) != right.get(key) for key in tracked_keys)

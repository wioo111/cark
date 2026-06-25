from __future__ import annotations

import json
import hashlib
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import gui_locator
import gui_memory_engine


MEMORY_ITEM_TYPES = {"note", "question", "action", "insight"}
MEMORY_ITEM_STATUSES = {"active", "done", "archived"}
MEMORY_ITEM_ID_RE = re.compile(r"^(?:memory|note)-[A-Za-z0-9_-]+$")
SAFE_MEMORY_KEY_RE = re.compile(r"^[A-Za-z0-9_-]+$")
JSON_SCHEMA_VERSION = 1


def current_timestamp_iso() -> str:
    return datetime.now().isoformat()


def paper_memory_dir(record: Any, memory_root: Path) -> Path:
    return memory_root / "papers" / paper_memory_key(record)


def legacy_paper_memory_dir(record: Any, memory_root: Path) -> Path:
    return memory_root / "papers" / str(record.paper_id)


def migrate_legacy_paper_memory(record: Any, memory_root: Path) -> int:
    current = paper_memory_dir(record, memory_root)
    legacy = legacy_paper_memory_dir(record, memory_root)
    if legacy == current or not legacy.exists():
        return 0

    copied = 0
    current.mkdir(parents=True, exist_ok=True)
    for source in legacy.rglob("*"):
        relative_path = source.relative_to(legacy)
        target = current / relative_path
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        if not source.is_file() or target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied += 1
    return copied


def paper_memory_key(record: Any) -> str:
    paper_id = str(record.paper_id)
    if len(paper_id) <= 120 and SAFE_MEMORY_KEY_RE.fullmatch(paper_id):
        return paper_id
    digest = hashlib.sha256(paper_id.encode("utf-8")).hexdigest()[:24]
    return f"paper-{digest}"


def paper_profile_path(record: Any, memory_root: Path) -> Path:
    return paper_memory_dir(record, memory_root) / "paper_profile.json"


def paper_notes_dir(record: Any, memory_root: Path) -> Path:
    return paper_memory_dir(record, memory_root) / "notes"


def default_memory_profile(record: Any) -> dict[str, object]:
    return {
        "paperId": str(record.paper_id),
        "title": str(record.title),
        "summary": "This paper memory card is waiting for durable judgments.",
        "anchors": [],
        "openQuestions": [
            "What is the most reusable method in this paper?",
            "Where does this paper connect to the current research map?",
        ],
        "recommendedActions": [
            "Save one important judgment from the current reading.",
            "Turn one unresolved doubt into a question item.",
            "Mark one reusable method, concept, or evidence point.",
        ],
    }


def ensure_paper_memory(record: Any, memory_root: Path) -> None:
    migrate_legacy_paper_memory(record, memory_root)
    paper_memory_dir(record, memory_root).mkdir(parents=True, exist_ok=True)
    paper_notes_dir(record, memory_root).mkdir(parents=True, exist_ok=True)
    if not paper_profile_path(record, memory_root).exists():
        write_json_file(paper_profile_path(record, memory_root), default_memory_profile(record))


def load_memory_profile(record: Any, memory_root: Path) -> dict[str, object]:
    ensure_paper_memory(record, memory_root)
    default_profile = default_memory_profile(record)
    payload = read_json_file(paper_profile_path(record, memory_root), default={})
    if not isinstance(payload, dict):
        payload = {}
    merged = {**default_profile, **payload}
    merged["paperId"] = str(record.paper_id)
    merged["title"] = str(record.title)
    return merged


def load_memory_items(record: Any, memory_root: Path) -> list[dict[str, object]]:
    ensure_paper_memory(record, memory_root)
    items: list[dict[str, object]] = []
    for path in sorted(
        paper_notes_dir(record, memory_root).glob("*.json"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    ):
        payload = read_json_file(path)
        if not isinstance(payload, dict):
            continue
        try:
            items.append(normalize_memory_item(record, payload, fallback_id=path.stem))
        except ValueError:
            continue
    return sorted(items, key=lambda item: str(item.get("updatedAt") or ""), reverse=True)


def build_memory_payload(record: Any, memory_root: Path) -> dict[str, object]:
    profile = load_memory_profile(record, memory_root)
    items = load_memory_items(record, memory_root)
    last_updated = items[0]["updatedAt"] if items else datetime.fromtimestamp(float(record.updated_at)).isoformat()
    active_items = [item for item in items if is_behavioral_memory_item(item)]
    candidate_items = [item for item in items if item.get("activationStatus") == "candidate"]
    notes = [item for item in items if item.get("type") == "note"]
    questions = [item for item in items if item.get("type") == "question"]
    actions = [item for item in items if item.get("type") == "action"]
    insights = [item for item in items if item.get("type") == "insight"]
    return {
        "paperId": str(record.paper_id),
        "title": str(record.title),
        "summary": str(profile.get("summary") or default_memory_profile(record)["summary"]),
        "anchors": normalize_string_list(profile.get("anchors"), limit=4),
        "openQuestions": normalize_string_list(profile.get("openQuestions"), limit=5),
        "recommendedActions": normalize_string_list(profile.get("recommendedActions"), limit=5),
        "noteCount": len(items),
        "lastUpdated": last_updated,
        "items": items,
        "activeItems": active_items,
        "candidateItems": candidate_items,
        "activeCount": len(active_items),
        "candidateCount": len(candidate_items),
        "notes": notes,
        "questions": questions,
        "actions": actions,
        "insights": insights,
        "recentNotes": items[:8],
    }


def find_duplicate_memory_item(
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


def merge_duplicate_memory_item(
    record: Any,
    existing: dict[str, object],
    incoming: dict[str, object],
) -> dict[str, object]:
    normalized_existing = normalize_memory_item(record, existing, fallback_id=str(existing.get("id") or ""))
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
        "tags": gui_memory_engine.merge_unique_strings(existing.get("tags"), incoming.get("tags"), limit=6),
        "source": gui_memory_engine.merge_sources(existing.get("source"), incoming.get("source")),
        "evidence": gui_memory_engine.merge_evidence_lists(existing.get("evidence"), incoming.get("evidence"), limit=8),
        "derivedFrom": gui_memory_engine.merge_reference_ids(existing.get("derivedFrom"), incoming.get("derivedFrom"), limit=12),
        "conflictsWith": gui_memory_engine.merge_reference_ids(
            existing.get("conflictsWith"),
            incoming.get("conflictsWith"),
            limit=12,
        ),
    }
    for key in ("sourceAnnotationId", "quote", "anchor", "blockId", "blockPreview", "locator"):
        if merged.get(key) is None and incoming.get(key) is not None:
            merged[key] = incoming.get(key)
    item = normalize_memory_item(record, merged, fallback_id=str(existing.get("id") or ""))
    if has_material_memory_change(normalized_existing, item):
        item["revisionHistory"] = gui_memory_engine.append_revision_snapshot(
            item.get("revisionHistory") if isinstance(item.get("revisionHistory"), list) else [],
            gui_memory_engine.build_revision_snapshot(normalized_existing, reason="duplicate"),
        )
    return item


def build_conflict_link_updates(
    record: Any,
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
        normalized_existing = normalize_memory_item(record, existing, fallback_id=existing_id)
        merged = {
            **existing,
            "updatedAt": item.get("updatedAt") or current_timestamp_iso(),
            "conflictsWith": gui_memory_engine.merge_reference_ids(existing.get("conflictsWith"), [item_id], limit=12),
        }
        updated = normalize_memory_item(record, merged, fallback_id=existing_id)
        if has_material_memory_change(normalized_existing, updated):
            updated["revisionHistory"] = gui_memory_engine.append_revision_snapshot(
                updated.get("revisionHistory") if isinstance(updated.get("revisionHistory"), list) else [],
                gui_memory_engine.build_revision_snapshot(normalized_existing, reason="conflict-link"),
            )
        updates.append(updated)
    return updates


def create_memory_note(record: Any, memory_root: Path, payload: dict[str, object]) -> dict[str, object]:
    return create_memory_item(record, memory_root, {**payload, "type": payload.get("type") or "note"})


def create_memory_item(record: Any, memory_root: Path, payload: dict[str, object]) -> dict[str, object]:
    ensure_paper_memory(record, memory_root)
    timestamp = current_timestamp_iso()
    item_id = f"memory-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    item = normalize_memory_item(
        record,
        {
            **payload,
            "id": item_id,
            "createdAt": timestamp,
            "updatedAt": timestamp,
        },
    )
    existing_items = load_memory_items(record, memory_root)
    duplicate = find_duplicate_memory_item(existing_items, item, exclude_id=str(item["id"]))
    if duplicate is not None:
        item = merge_duplicate_memory_item(record, duplicate, item)
    related_updates = build_conflict_link_updates(record, existing_items, item)
    write_json_file(memory_item_file_path(record, memory_root, str(item["id"])), item)
    for updated in related_updates:
        write_json_file(memory_item_file_path(record, memory_root, str(updated["id"])), updated)
    return item


def create_memory_item_from_annotation(
    record: Any,
    memory_root: Path,
    annotation: dict[str, object],
    payload: dict[str, object],
) -> dict[str, object]:
    annotation_id = str(annotation.get("id") or "").strip()
    if not annotation_id:
        raise ValueError("annotation is missing an id")
    anchor = {
        "view": annotation.get("view"),
        "quote": annotation.get("quote"),
        "contextBefore": annotation.get("contextBefore"),
        "contextAfter": annotation.get("contextAfter"),
        "anchorTop": annotation.get("anchorTop"),
        "anchorHeight": annotation.get("anchorHeight"),
    }
    return create_memory_item(
        record,
        memory_root,
        {
            **payload,
            "sourceAnnotationId": annotation_id,
            "quote": payload.get("quote") or annotation.get("quote"),
            "anchor": payload.get("anchor") if isinstance(payload.get("anchor"), dict) else anchor,
            "source": payload.get("source") if isinstance(payload.get("source"), dict) else {
                "kind": "annotation",
                "paperId": str(record.paper_id),
                "annotationId": annotation_id,
            },
            "locator": payload.get("locator") if isinstance(payload.get("locator"), dict) else gui_locator.build_locator(
                view=annotation.get("view"),
                annotation_id=annotation_id,
                block_id=payload.get("blockId"),
                quote=payload.get("quote") or annotation.get("quote"),
                context_before=payload.get("contextBefore") or annotation.get("contextBefore"),
                context_after=payload.get("contextAfter") or annotation.get("contextAfter"),
            ),
            "evidence": payload.get("evidence") if isinstance(payload.get("evidence"), list) else [
                {
                    "kind": "annotation",
                    "annotationId": annotation_id,
                    "view": annotation.get("view"),
                    "quote": annotation.get("quote"),
                    "contextBefore": annotation.get("contextBefore"),
                    "contextAfter": annotation.get("contextAfter"),
                }
            ],
        },
    )


def update_memory_item(
    record: Any,
    memory_root: Path,
    item_id: str,
    payload: dict[str, object],
    *,
    revision_reason: str = "update",
) -> dict[str, object]:
    path = memory_item_file_path(record, memory_root, item_id)
    if not path.exists():
        raise FileNotFoundError("memory item not found")
    existing = read_json_file(path)
    if not isinstance(existing, dict):
        raise ValueError("memory item is corrupted")
    normalized_existing = normalize_memory_item(record, existing, fallback_id=item_id)

    merged = {**existing}
    for key in (
        "type",
        "text",
        "content",
        "sourceAnnotationId",
        "quote",
        "anchor",
        "blockId",
        "blockPreview",
        "tags",
        "status",
        "activationStatus",
        "confidence",
        "source",
        "evidence",
        "derivedFrom",
        "conflictsWith",
        "locator",
    ):
        if key in payload:
            merged[key] = payload[key]
    merged["id"] = item_id
    merged["createdAt"] = existing.get("createdAt") or current_timestamp_iso()
    merged["updatedAt"] = current_timestamp_iso()
    item = normalize_memory_item(record, merged, fallback_id=item_id)
    if has_material_memory_change(normalized_existing, item):
        item["revisionHistory"] = gui_memory_engine.append_revision_snapshot(
            item.get("revisionHistory") if isinstance(item.get("revisionHistory"), list) else [],
            gui_memory_engine.build_revision_snapshot(normalized_existing, reason=revision_reason),
        )
    write_json_file(path, item)
    return item


def delete_memory_item(record: Any, memory_root: Path, item_id: str) -> None:
    path = memory_item_file_path(record, memory_root, item_id)
    if not path.exists():
        raise FileNotFoundError("memory item not found")
    path.unlink()


def memory_item_file_path(record: Any, memory_root: Path, item_id: str) -> Path:
    item_id = item_id.strip()
    if MEMORY_ITEM_ID_RE.fullmatch(item_id) is None:
        raise FileNotFoundError("memory item id is invalid")
    return paper_notes_dir(record, memory_root) / f"{item_id}.json"


def normalize_memory_item(
    record: Any,
    payload: dict[str, object],
    *,
    fallback_id: str | None = None,
) -> dict[str, object]:
    item_id = payload.get("id") if isinstance(payload.get("id"), str) else fallback_id
    if not isinstance(item_id, str) or MEMORY_ITEM_ID_RE.fullmatch(item_id) is None:
        raise ValueError("memory item id is invalid")

    item_type = payload.get("type")
    if item_type is None and str(item_id).startswith("note-"):
        item_type = "note"
    if item_type not in MEMORY_ITEM_TYPES:
        raise ValueError("memory item type is invalid")

    text = payload.get("text")
    if not isinstance(text, str):
        text = payload.get("content")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("memory item text cannot be empty")
    text = text.strip()

    status = payload.get("status") or "active"
    if status not in MEMORY_ITEM_STATUSES:
        raise ValueError("memory item status is invalid")

    created_at = payload.get("createdAt") if isinstance(payload.get("createdAt"), str) else current_timestamp_iso()
    updated_at = payload.get("updatedAt") if isinstance(payload.get("updatedAt"), str) else created_at
    activation_status = gui_memory_engine.normalize_activation_status(payload.get("activationStatus"), default="active")
    default_confidence = 0.72 if activation_status == "candidate" else 0.92
    source_annotation_id = optional_string(payload.get("sourceAnnotationId"))
    quote = optional_string(payload.get("quote"))
    anchor = payload.get("anchor") if isinstance(payload.get("anchor"), dict) else None
    source = gui_memory_engine.normalize_source(
        payload.get("source"),
        default={
            "kind": "annotation" if source_annotation_id else "manual",
            "paperId": str(record.paper_id),
            "annotationId": source_annotation_id,
        },
    )
    evidence = gui_memory_engine.normalize_evidence(payload.get("evidence"))
    if not evidence and (quote or source_annotation_id):
        evidence = gui_memory_engine.normalize_evidence(
            [
                {
                    "kind": "annotation" if source_annotation_id else "quote",
                    "annotationId": source_annotation_id,
                    "view": payload.get("anchor", {}).get("view") if isinstance(payload.get("anchor"), dict) else None,
                    "quote": quote,
                    "contextBefore": payload.get("anchor", {}).get("contextBefore") if isinstance(payload.get("anchor"), dict) else None,
                    "contextAfter": payload.get("anchor", {}).get("contextAfter") if isinstance(payload.get("anchor"), dict) else None,
                }
            ]
        )

    item = {
        "id": item_id,
        "paperId": str(record.paper_id),
        "memoryLayer": "paper",
        "type": item_type,
        "text": text,
        "content": text,
        "sourceAnnotationId": source_annotation_id,
        "quote": quote,
        "anchor": anchor,
        "blockId": optional_string(payload.get("blockId")),
        "blockPreview": optional_string(payload.get("blockPreview")),
        "locator": gui_locator.normalize_locator(
            payload.get("locator"),
            default=gui_locator.build_locator(
                view=anchor.get("view") if isinstance(anchor, dict) else None,
                annotation_id=source_annotation_id,
                memory_item_id=item_id,
                block_id=payload.get("blockId"),
                quote=quote or (anchor.get("quote") if isinstance(anchor, dict) else None),
                context_before=anchor.get("contextBefore") if isinstance(anchor, dict) else None,
                context_after=anchor.get("contextAfter") if isinstance(anchor, dict) else None,
            ),
        ),
        "tags": normalize_string_list(payload.get("tags"), limit=6),
        "status": status,
        "activationStatus": activation_status,
        "confidence": gui_memory_engine.normalize_confidence(payload.get("confidence"), default=default_confidence),
        "source": source,
        "evidence": evidence,
        "derivedFrom": gui_memory_engine.normalize_reference_ids(payload.get("derivedFrom"), limit=12),
        "conflictsWith": gui_memory_engine.normalize_reference_ids(payload.get("conflictsWith"), limit=12),
        "createdAt": created_at,
        "updatedAt": updated_at,
    }
    revision_history = gui_memory_engine.normalize_revision_history(payload.get("revisionHistory"))
    item["revisionHistory"] = revision_history or [gui_memory_engine.build_revision_snapshot(item, reason="created")]
    return item


def optional_string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def normalize_string_list(value: object, *, limit: int) -> list[str]:
    return gui_memory_engine.normalize_string_list(value, limit=limit)


def is_behavioral_memory_item(item: dict[str, object]) -> bool:
    return str(item.get("status") or "") != "archived" and str(item.get("activationStatus") or "active") == "active"


def has_material_memory_change(left: dict[str, object], right: dict[str, object]) -> bool:
    tracked_keys = (
        "type",
        "text",
        "status",
        "activationStatus",
        "confidence",
        "sourceAnnotationId",
        "quote",
        "anchor",
        "blockId",
        "blockPreview",
        "tags",
        "source",
        "evidence",
        "derivedFrom",
        "conflictsWith",
        "locator",
    )
    return any(left.get(key) != right.get(key) for key in tracked_keys)


def write_json_file(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    prepared = _with_schema_version(payload)
    temp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(json.dumps(prepared, ensure_ascii=False, indent=2))
            handle.flush()
            os.fsync(handle.fileno())
            temp_path = handle.name
        if path.exists():
            shutil.copy2(path, json_backup_path(path))
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path:
            try:
                Path(temp_path).unlink()
            except FileNotFoundError:
                pass


def read_json_file(path: Path, *, default: object = None) -> object:
    for candidate in (path, json_backup_path(path)):
        if not candidate.exists():
            continue
        try:
            return json.loads(candidate.read_text(encoding="utf-8"))
        except Exception:
            continue
    return default


def json_backup_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.bak")


def _with_schema_version(payload: object) -> object:
    if not isinstance(payload, dict):
        return payload
    return {
        **payload,
        "schemaVersion": JSON_SCHEMA_VERSION,
    }

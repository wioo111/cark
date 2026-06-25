from __future__ import annotations

import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import gui_locator
import gui_memory


def paper_annotations_dir(record: Any, memory_root: Path) -> Path:
    return gui_memory.paper_memory_dir(record, memory_root) / "annotations"


def ensure_annotations_dir(record: Any, memory_root: Path) -> None:
    gui_memory.ensure_paper_memory(record, memory_root)
    paper_annotations_dir(record, memory_root).mkdir(parents=True, exist_ok=True)


def annotation_preview(content: str, *, limit: int = 72) -> str:
    cleaned = " ".join(content.split())
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[:limit].rstrip()}..."


def normalize_annotation_comment(
    payload: dict[str, object],
    *,
    locator: dict[str, object] | None = None,
) -> dict[str, object]:
    author_type = payload.get("authorType")
    if author_type not in {"user", "agent"}:
        raise ValueError("评论作者类型非法")
    author_label = payload.get("authorLabel")
    if not isinstance(author_label, str) or not author_label.strip():
        raise ValueError("评论作者名称不能为空")
    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("评论内容不能为空")
    if payload.get("status", "ready") != "ready":
        raise ValueError("当前阶段不允许保存占位评论")
    timestamp = gui_memory.current_timestamp_iso()
    return {
        "id": f"comment-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}",
        "authorType": author_type,
        "authorLabel": author_label.strip(),
        "agentId": str(payload.get("agentId") or "").strip() if author_type == "agent" else None,
        "replyToCommentId": str(payload.get("replyToCommentId") or "").strip() or None,
        "replyToAgentId": str(payload.get("replyToAgentId") or "").strip() or None,
        "contextChunkIds": gui_memory.normalize_string_list(payload.get("contextChunkIds"), limit=8)
        if author_type == "agent"
        else [],
        "locator": gui_locator.normalize_locator(locator),
        "content": content.strip(),
        "preview": annotation_preview(content.strip()),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "status": "ready",
    }


def normalize_annotation_thread(payload: dict[str, object]) -> dict[str, object]:
    annotation = dict(payload)
    annotation_locator = gui_locator.normalize_locator(
        annotation.get("locator"),
        default=gui_locator.build_annotation_locator(annotation),
    )
    annotation["locator"] = annotation_locator
    comments = annotation.get("comments")
    if isinstance(comments, list):
        normalized_comments: list[dict[str, object]] = []
        for comment in comments:
            if not isinstance(comment, dict):
                continue
            comment_payload = dict(comment)
            comment_id = str(comment_payload.get("id") or "").strip() or None
            comment_payload["locator"] = gui_locator.normalize_locator(
                comment_payload.get("locator"),
                default=gui_locator.build_annotation_locator(annotation, comment_id=comment_id),
            )
            normalized_comments.append(comment_payload)
        annotation["comments"] = normalized_comments
    else:
        annotation["comments"] = []
    return annotation


def load_paper_annotations(record: Any, memory_root: Path) -> list[dict[str, object]]:
    ensure_annotations_dir(record, memory_root)
    items: list[dict[str, object]] = []
    for path in sorted(paper_annotations_dir(record, memory_root).glob("*.json"), key=lambda item: item.stat().st_mtime):
        payload = gui_memory.read_json_file(path, default={})
        if isinstance(payload, dict):
            items.append(normalize_annotation_thread(payload))
    items.sort(key=lambda item: (float(item.get("anchorTop") or 0), str(item.get("createdAt") or "")))
    return items


def annotation_file_path(record: Any, memory_root: Path, annotation_id: str) -> Path:
    if re.fullmatch(r"annotation-[A-Za-z0-9_-]+", annotation_id) is None:
        raise FileNotFoundError("批注线程标识非法")
    return paper_annotations_dir(record, memory_root) / f"{annotation_id}.json"


def load_annotation(record: Any, memory_root: Path, annotation_id: str) -> tuple[Path, dict[str, object]]:
    ensure_annotations_dir(record, memory_root)
    file_path = annotation_file_path(record, memory_root, annotation_id)
    if not file_path.exists():
        raise FileNotFoundError("未找到指定批注线程")
    payload = gui_memory.read_json_file(file_path, default={})
    if not isinstance(payload, dict):
        raise FileNotFoundError("批注线程损坏")
    return file_path, normalize_annotation_thread(payload)


def create_annotation(record: Any, memory_root: Path, payload: dict[str, object]) -> dict[str, object]:
    quote = payload.get("quote")
    view = payload.get("view")
    anchor_top = payload.get("anchorTop")
    anchor_height = payload.get("anchorHeight")
    initial_comment = payload.get("initialComment")
    if not isinstance(quote, str) or not quote.strip():
        raise ValueError("批注选区不能为空")
    if view not in {"linearized", "bilingual"}:
        raise ValueError("批注视图非法")
    if not isinstance(anchor_top, (int, float)) or not isinstance(anchor_height, (int, float)):
        raise ValueError("批注位置参数非法")
    if not isinstance(initial_comment, dict):
        raise ValueError("缺少初始评论")

    ensure_annotations_dir(record, memory_root)
    timestamp = gui_memory.current_timestamp_iso()
    annotation_id = f"annotation-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    annotation_locator = gui_locator.build_locator(
        view=view,
        annotation_id=annotation_id,
        block_id=payload.get("blockId"),
        quote=quote.strip()[:600],
        context_before=payload.get("contextBefore"),
        context_after=payload.get("contextAfter"),
    )
    annotation = {
        "id": annotation_id,
        "paperId": record.paper_id,
        "view": view,
        "quote": quote.strip()[:600],
        "contextBefore": payload.get("contextBefore") if isinstance(payload.get("contextBefore"), str) else None,
        "contextAfter": payload.get("contextAfter") if isinstance(payload.get("contextAfter"), str) else None,
        "anchorTop": max(float(anchor_top), 0.0),
        "anchorHeight": max(float(anchor_height), 24.0),
        "blockId": str(payload.get("blockId") or "").strip() or None,
        "locator": annotation_locator,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "archived": False,
        "archivedAt": None,
        "comments": [normalize_annotation_comment(initial_comment, locator=annotation_locator)],
    }
    annotation["comments"][0]["locator"] = gui_locator.build_annotation_locator(annotation, comment_id=annotation["comments"][0]["id"])
    gui_memory.write_json_file(annotation_file_path(record, memory_root, annotation_id), annotation)
    return normalize_annotation_thread(annotation)


def append_annotation_comment(record: Any, memory_root: Path, annotation_id: str, payload: dict[str, object]) -> dict[str, object]:
    file_path, annotation = load_annotation(record, memory_root, annotation_id)
    comments = annotation.get("comments")
    if not isinstance(comments, list):
        comments = []
    comment = normalize_annotation_comment(payload, locator=gui_locator.build_annotation_locator(annotation))
    comment["locator"] = gui_locator.build_annotation_locator(annotation, comment_id=comment["id"])
    comments.append(comment)
    annotation["comments"] = comments
    annotation["updatedAt"] = gui_memory.current_timestamp_iso()
    annotation["archived"] = False
    annotation["archivedAt"] = None
    annotation["locator"] = gui_locator.normalize_locator(
        annotation.get("locator"),
        default=gui_locator.build_annotation_locator(annotation),
    )
    gui_memory.write_json_file(file_path, annotation)
    return comment


def update_annotation_comment(record: Any, memory_root: Path, annotation_id: str, comment_id: str, payload: dict[str, object]) -> None:
    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("评论内容不能为空")
    file_path, annotation = load_annotation(record, memory_root, annotation_id)
    comments = annotation.get("comments")
    if not isinstance(comments, list):
        raise FileNotFoundError("批注线程损坏")
    found = False
    for comment in comments:
        if isinstance(comment, dict) and comment.get("id") == comment_id:
            comment["content"] = content.strip()
            comment["preview"] = annotation_preview(content.strip())
            comment["updatedAt"] = gui_memory.current_timestamp_iso()
            comment["locator"] = gui_locator.normalize_locator(
                comment.get("locator"),
                default=gui_locator.build_annotation_locator(annotation, comment_id=comment_id),
            )
            found = True
            break
    if not found:
        raise FileNotFoundError("未找到指定评论")
    annotation["updatedAt"] = gui_memory.current_timestamp_iso()
    annotation["locator"] = gui_locator.normalize_locator(
        annotation.get("locator"),
        default=gui_locator.build_annotation_locator(annotation),
    )
    gui_memory.write_json_file(file_path, annotation)


def update_annotation(record: Any, memory_root: Path, annotation_id: str, payload: dict[str, object]) -> None:
    file_path, annotation = load_annotation(record, memory_root, annotation_id)
    if "archived" in payload:
        archived = payload.get("archived")
        if not isinstance(archived, bool):
            raise ValueError("归档状态非法")
        annotation["archived"] = archived
        annotation["archivedAt"] = gui_memory.current_timestamp_iso() if archived else None
        annotation["updatedAt"] = gui_memory.current_timestamp_iso()
    annotation["locator"] = gui_locator.normalize_locator(
        annotation.get("locator"),
        default=gui_locator.build_annotation_locator(annotation),
    )
    comments = annotation.get("comments")
    if isinstance(comments, list):
        for comment in comments:
            if isinstance(comment, dict):
                comment_id = str(comment.get("id") or "").strip() or None
                comment["locator"] = gui_locator.normalize_locator(
                    comment.get("locator"),
                    default=gui_locator.build_annotation_locator(annotation, comment_id=comment_id),
                )
    gui_memory.write_json_file(file_path, annotation)


def delete_annotation(record: Any, memory_root: Path, annotation_id: str) -> None:
    file_path, _annotation = load_annotation(record, memory_root, annotation_id)
    file_path.unlink()

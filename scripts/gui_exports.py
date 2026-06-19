from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

import gui_memory


def current_timestamp_iso() -> str:
    return datetime.now().isoformat()


def paper_exports_dir(record: Any, memory_root: Path) -> Path:
    return gui_memory.paper_memory_dir(record, memory_root) / "exports"


def export_paper_memory_markdown(record: Any, memory_root: Path) -> dict[str, object]:
    created_at = current_timestamp_iso()
    markdown = build_paper_memory_markdown(record, memory_root, created_at=created_at)
    file_name = f"{safe_slug(str(record.title)) or 'paper'}-memory-{datetime.now().strftime('%Y%m%d%H%M%S')}.md"
    export_dir = paper_exports_dir(record, memory_root)
    export_dir.mkdir(parents=True, exist_ok=True)
    export_path = export_dir / file_name
    export_path.write_text(markdown, encoding="utf-8")
    payload = gui_memory.build_memory_payload(record, memory_root)
    return {
        "paperId": str(record.paper_id),
        "title": str(record.title),
        "format": "markdown",
        "fileName": file_name,
        "filePath": str(export_path),
        "markdown": markdown,
        "createdAt": created_at,
        "itemCount": int(payload.get("noteCount") or 0),
    }


def build_paper_memory_markdown(record: Any, memory_root: Path, *, created_at: str | None = None) -> str:
    payload = gui_memory.build_memory_payload(record, memory_root)
    created_at = created_at or current_timestamp_iso()
    title = str(payload.get("title") or record.title)
    lines = [
        f"# {title}",
        "",
        "## Export",
        "",
        f"- Paper ID: `{payload.get('paperId')}`",
        f"- Exported at: {created_at}",
        f"- Memory items: {payload.get('noteCount') or 0}",
        "",
        "## Summary",
        "",
        str(payload.get("summary") or "").strip() or "No summary yet.",
        "",
    ]

    lines.extend(render_string_list_section("Anchors", payload.get("anchors")))
    lines.extend(render_string_list_section("Open Questions", payload.get("openQuestions")))
    lines.extend(render_string_list_section("Recommended Actions", payload.get("recommendedActions")))

    grouped_items = [
        ("Key Insights", payload.get("insights")),
        ("Notes", payload.get("notes")),
        ("Questions", payload.get("questions")),
        ("Actions", payload.get("actions")),
    ]
    has_items = any(isinstance(items, list) and items for _title, items in grouped_items)
    if not has_items:
        lines.extend(["## Memory Items", "", "No memory items yet.", ""])
    else:
        for section_title, items in grouped_items:
            lines.extend(render_memory_items_section(section_title, items))

    return "\n".join(lines).rstrip() + "\n"


def render_string_list_section(title: str, value: object) -> list[str]:
    if not isinstance(value, list) or not value:
        return []
    lines = [f"## {title}", ""]
    for item in value:
        if isinstance(item, str) and item.strip():
            lines.append(f"- {item.strip()}")
    if len(lines) == 2:
        return []
    lines.append("")
    return lines


def render_memory_items_section(title: str, value: object) -> list[str]:
    if not isinstance(value, list) or not value:
        return []
    lines = [f"## {title}", ""]
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            continue
        lines.extend(render_memory_item(index, item))
    return lines


def render_memory_item(index: int, item: dict[str, object]) -> list[str]:
    text = optional_string(item.get("text")) or optional_string(item.get("content")) or ""
    title = first_line(text) or optional_string(item.get("id")) or f"Memory {index}"
    lines = [
        f"### {index}. {title}",
        "",
        f"- Type: `{item.get('type') or 'note'}`",
        f"- Status: `{item.get('status') or 'active'}`",
    ]
    if optional_string(item.get("updatedAt")):
        lines.append(f"- Updated: {item['updatedAt']}")
    if optional_string(item.get("sourceAnnotationId")):
        lines.append(f"- Source annotation: `{item['sourceAnnotationId']}`")
    tags = [tag for tag in item.get("tags", []) if isinstance(tag, str) and tag.strip()] if isinstance(item.get("tags"), list) else []
    if tags:
        lines.append(f"- Tags: {', '.join(tags)}")

    anchor = item.get("anchor")
    if isinstance(anchor, dict) and optional_string(anchor.get("view")):
        lines.append(f"- View: `{anchor['view']}`")

    lines.extend(["", text, ""])
    quote = optional_string(item.get("quote"))
    if quote:
        lines.extend(["Source quote:", "", *blockquote(quote), ""])
    return lines


def blockquote(value: str) -> list[str]:
    return [f"> {line}" if line else ">" for line in value.strip().splitlines()]


def first_line(value: str) -> str:
    return next((line.strip() for line in value.splitlines() if line.strip()), "")[:96]


def optional_string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def safe_slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-._")
    return slug[:80]

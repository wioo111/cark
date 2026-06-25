from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote


def strip_known_suffix(name: str) -> str:
    suffixes = [
        "_linearized_feishu_docx_ready",
        "_feishu_docx_ready",
        "_linearized_feishu_ready",
        "_feishu_ready",
        "_linearized_bilingual",
        "_linearized",
        "_bilingual",
        "_feishu_docx_ready",
        "_feishu_ready",
    ]
    current = name
    changed = True
    while changed:
        changed = False
        for suffix in suffixes:
            if current.endswith(suffix):
                current = current[: -len(suffix)]
                changed = True
    return current


def find_primary_file(auto_dir: Path, title: str, suffixes: list[str]) -> Path | None:
    for suffix in suffixes:
        candidate = auto_dir / f"{title}{suffix}"
        if candidate.exists():
            return candidate

    for suffix in suffixes:
        matches = sorted(auto_dir.glob(f"*{suffix}"), key=lambda item: item.stat().st_mtime, reverse=True)
        if matches:
            return matches[0]
    return None


def detect_source_pdf(root_dir: Path, auto_dir: Path, runtime_output_dir: Path) -> str | None:
    candidates: list[Path] = []
    candidates.extend(sorted((root_dir / "uploads").glob("*.pdf")))
    if root_dir.parent != runtime_output_dir:
        candidates.extend(sorted((root_dir.parent / "uploads").glob("*.pdf")))
    candidates.extend(sorted(auto_dir.glob("*_origin.pdf")))
    candidates.extend(sorted(auto_dir.glob("*.pdf")))
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def detect_content_list(auto_dir: Path) -> Path | None:
    matches = sorted(auto_dir.glob("*_content_list.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    return matches[0] if matches else None


def discover_records(
    *,
    runtime_output_dir: Path,
    uuid_dir_re: Any,
    encode_paper_id: Callable[[str | None, str], str],
    record_factory: Callable[..., Any],
) -> dict[str, Any]:
    records: dict[str, Any] = {}
    for linearized_path in runtime_output_dir.glob("**/*_linearized.md"):
        auto_dir = linearized_path.parent
        if auto_dir.name != "auto":
            continue

        title = strip_known_suffix(linearized_path.stem)
        root_dir = auto_dir.parent
        task_id: str | None = None
        if root_dir.parent.parent == runtime_output_dir and uuid_dir_re.match(root_dir.parent.name):
            task_id = root_dir.parent.name

        paper_id = encode_paper_id(task_id, title)
        content_list = detect_content_list(auto_dir)
        bilingual = find_primary_file(auto_dir, title, ["_linearized_bilingual.md", "_bilingual.md"])
        feishu_ready = find_primary_file(
            auto_dir,
            title,
            [
                "_linearized_feishu_docx_ready.md",
                "_feishu_docx_ready.md",
                "_linearized_feishu_ready.md",
                "_feishu_ready.md",
            ],
        )
        files = {
            "linearized": linearized_path,
            "bilingual": bilingual,
            "feishuReady": feishu_ready,
            "contentListJson": content_list,
        }
        available_views = ["linearized"]
        if bilingual and bilingual.exists():
            available_views.append("bilingual")

        updated_at = max(path.stat().st_mtime for path in files.values() if path and path.exists())
        record = record_factory(
            paper_id=paper_id,
            title=title,
            task_id=task_id,
            root_dir=root_dir,
            auto_dir=auto_dir,
            updated_at=updated_at,
            available_views=available_views,
            source_pdf=detect_source_pdf(root_dir, auto_dir, runtime_output_dir),
            files=files,
        )

        existing = records.get(paper_id)
        if existing is None or existing.updated_at < record.updated_at:
            records[paper_id] = record
    return records


def serialize_paper_record(record: Any) -> dict[str, object]:
    return {
        "id": record.paper_id,
        "title": record.title,
        "taskId": record.task_id,
        "rootDir": str(record.root_dir),
        "autoDir": str(record.auto_dir),
        "updatedAt": record.updated_at,
        "availableViews": record.available_views,
        "sourcePdf": record.source_pdf,
        "files": {
            key: str(value) if value else None
            for key, value in record.files.items()
        },
    }


def deserialize_paper_record(payload: dict[str, object], *, record_factory: Callable[..., Any]) -> Any | None:
    files_payload = payload.get("files")
    if not isinstance(files_payload, dict):
        return None
    linearized_value = files_payload.get("linearized")
    if not isinstance(linearized_value, str) or not Path(linearized_value).exists():
        return None
    available_views = payload.get("availableViews")
    if not isinstance(available_views, list):
        available_views = ["linearized"]
    return record_factory(
        paper_id=str(payload["id"]),
        title=str(payload["title"]),
        task_id=str(payload["taskId"]) if payload.get("taskId") else None,
        root_dir=Path(str(payload["rootDir"])),
        auto_dir=Path(str(payload["autoDir"])),
        updated_at=float(payload["updatedAt"]),
        available_views=[str(item) for item in available_views],
        source_pdf=str(payload["sourcePdf"]) if payload.get("sourcePdf") else None,
        files={
            key: Path(str(value)) if value else None
            for key, value in files_payload.items()
        },
    )


def indexed_records(
    *,
    store: Any,
    deserialize_record: Callable[[dict[str, object]], Any | None],
    refresh: bool = False,
    sync_paper_index: Callable[[], None] | None = None,
) -> dict[str, Any]:
    if refresh and sync_paper_index is not None:
        sync_paper_index()
    records: dict[str, Any] = {}
    for payload in store.list_papers():
        record = deserialize_record(payload)
        if record:
            records[record.paper_id] = record
    return records


def get_record(
    paper_id: str,
    *,
    indexed_records_func: Callable[..., dict[str, Any]],
    decode_paper_id: Callable[[str], tuple[str | None, str | None]],
) -> Any:
    records = indexed_records_func(refresh=False)
    normalized = unquote(paper_id).strip().rstrip("/")
    direct = records.get(normalized)
    if direct:
        return direct

    task_part, title_part = decode_paper_id(normalized)
    if title_part:
        for record in records.values():
            if record.title != title_part:
                continue
            if record.task_id == task_part:
                return record
            if record.task_id is None and task_part == title_part:
                return record

    records = indexed_records_func(refresh=True)
    direct = records.get(normalized)
    if direct:
        return direct
    if title_part:
        for record in records.values():
            if record.title == title_part and (
                record.task_id == task_part
                or (record.task_id is None and task_part == title_part)
            ):
                return record

    raise FileNotFoundError("未找到指定论文")


def load_markdown(path: Path | None) -> str | None:
    if not path or not path.exists():
        return None
    return path.read_text(encoding="utf-8", errors="ignore")


def ensure_within_root(record: Any, relative_path: str) -> Path:
    target = (record.root_dir / relative_path).resolve()
    root = record.root_dir.resolve()
    if os.path.commonpath([str(root), str(target)]) != str(root):
        raise PermissionError("非法路径")
    return target


def build_images(record: Any, *, image_suffixes: set[str]) -> list[dict[str, str]]:
    images_dir = record.auto_dir / "images"
    items: list[dict[str, str]] = []
    if not images_dir.exists():
        return items

    for path in sorted(images_dir.glob("**/*"), key=lambda item: item.name.lower()):
        if not path.is_file() or path.suffix.lower() not in image_suffixes:
            continue
        relative = path.relative_to(record.root_dir).as_posix()
        items.append(
            {
                "name": path.name,
                "url": f"/api/media/{record.paper_id}?path={relative}",
                "filePath": str(path),
            }
        )
    return items


def load_blocks(
    record: Any,
    *,
    normalize_text_value: Callable[[Any], str],
    normalize_string_list: Callable[[Any], list[str]],
) -> list[dict[str, object]]:
    content_list_path = record.files.get("contentListJson")
    if not content_list_path or not content_list_path.exists():
        return []

    try:
        payload = json.loads(content_list_path.read_text(encoding="utf-8"))
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    blocks: list[dict[str, object]] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            continue

        block_type = str(item.get("type") or "unknown")
        text_value = normalize_text_value(item.get("text"))
        captions = normalize_string_list(item.get("img_caption"))
        footnotes = normalize_string_list(item.get("img_footnote"))
        image_path = item.get("img_path") if isinstance(item.get("img_path"), str) else None
        preview = next(
            (
                value
                for value in [
                    text_value,
                    captions[0] if captions else "",
                    footnotes[0] if footnotes else "",
                    image_path or "",
                    block_type,
                ]
                if value
            ),
            block_type,
        )[:220]
        match_text = (text_value or preview)[:400]
        image_url = None
        if image_path:
            cleaned = image_path.lstrip("./")
            relative = f"auto/{cleaned}" if not cleaned.startswith("auto/") else cleaned
            image_url = f"/api/media/{record.paper_id}?path={relative}"

        blocks.append(
            {
                "id": f"block-{index}",
                "index": index,
                "type": block_type,
                "pageIdx": item.get("page_idx") if isinstance(item.get("page_idx"), int) else None,
                "textLevel": item.get("text_level") if isinstance(item.get("text_level"), int) else None,
                "preview": preview,
                "matchText": match_text or None,
                "imagePath": image_path,
                "imageUrl": image_url,
                "imageCaption": captions,
                "imageFootnote": footnotes,
                "bbox": item.get("bbox") if isinstance(item.get("bbox"), list) else None,
            }
        )
    return blocks


def build_stats(blocks: list[dict[str, object]]) -> dict[str, int]:
    heading_count = 0
    image_count = 0
    table_count = 0
    formula_count = 0
    paragraph_count = 0
    for block in blocks:
        block_type = str(block.get("type") or "")
        if "image" in block_type:
            image_count += 1
        elif "table" in block_type:
            table_count += 1
        elif "equation" in block_type or "formula" in block_type:
            formula_count += 1
        elif "title" in block_type or block.get("textLevel"):
            heading_count += 1
        else:
            paragraph_count += 1
    return {
        "headingCount": heading_count,
        "imageCount": image_count,
        "tableCount": table_count,
        "formulaCount": formula_count,
        "paragraphCount": paragraph_count,
        "blockCount": len(blocks),
    }


def build_paper_summary(
    record: Any,
    *,
    get_reading_state: Callable[[str], dict[str, object] | None],
    load_library_meta: Callable[[Any, dict[str, object] | None], dict[str, object]],
    load_annotations: Callable[[Any], list[dict[str, object]]],
    load_memory_items: Callable[[Any], list[dict[str, object]]],
) -> dict[str, object]:
    has_images = (record.auto_dir / "images").exists()
    reading_state = get_reading_state(record.paper_id)
    library_meta = load_library_meta(record, reading_state)
    annotations = load_annotations(record)
    memory_items = load_memory_items(record)
    return {
        "id": record.paper_id,
        "title": record.title,
        "taskId": record.task_id,
        "updatedAt": datetime.fromtimestamp(record.updated_at).isoformat(),
        "availableViews": record.available_views,
        "hasImages": has_images,
        "sourcePdf": record.source_pdf,
        "favorite": library_meta["favorite"],
        "tags": library_meta["tags"],
        "readingStatus": library_meta["readingStatus"],
        "annotationCount": len(annotations),
        "memoryCount": len(memory_items),
        "lastReadAt": library_meta["lastReadAt"],
        "libraryUpdatedAt": library_meta["libraryUpdatedAt"],
    }


def list_papers(
    *,
    indexed_records_func: Callable[..., dict[str, Any]],
    build_paper_summary: Callable[[Any], dict[str, object]],
) -> list[dict[str, object]]:
    return [
        build_paper_summary(record)
        for record in sorted(indexed_records_func(refresh=True).values(), key=lambda item: item.updated_at, reverse=True)
    ]


def build_detail(
    record: Any,
    *,
    load_blocks: Callable[[Any], list[dict[str, object]]],
    load_markdown: Callable[[Path | None], str | None],
    build_images: Callable[[Any], list[dict[str, str]]],
) -> dict[str, object]:
    blocks = load_blocks(record)
    return {
        "id": record.paper_id,
        "title": record.title,
        "taskId": record.task_id,
        "updatedAt": datetime.fromtimestamp(record.updated_at).isoformat(),
        "availableViews": record.available_views,
        "hasImages": bool((record.auto_dir / "images").exists()),
        "sourcePdf": record.source_pdf,
        "rootDir": str(record.root_dir),
        "files": {
            "contentListJson": str(record.files["contentListJson"]) if record.files.get("contentListJson") else None,
            "linearized": str(record.files["linearized"]) if record.files.get("linearized") else None,
            "bilingual": str(record.files["bilingual"]) if record.files.get("bilingual") else None,
            "feishuReady": str(record.files["feishuReady"]) if record.files.get("feishuReady") else None,
        },
        "markdown": {
            "linearized": load_markdown(record.files.get("linearized")),
            "bilingual": load_markdown(record.files.get("bilingual")),
        },
        "images": build_images(record),
        "stats": build_stats(blocks),
        "blocks": blocks,
    }

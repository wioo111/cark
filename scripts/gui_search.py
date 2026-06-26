from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable, Iterable

import gui_locator
import gui_memory


SearchMarkdownLoader = Callable[[Path | None], str | None]
SearchAnnotationLoader = Callable[[Any], list[dict[str, object]]]

SOURCE_LABELS = {
    "title": "标题",
    "body": "正文",
    "annotation": "批注",
    "memory": "记忆",
}


def search_records(
    records: Iterable[Any],
    query: str,
    *,
    memory_root: Path,
    load_markdown: SearchMarkdownLoader,
    load_annotations: SearchAnnotationLoader,
    search_store: Any | None = None,
    limit: int = 80,
) -> list[dict[str, object]]:
    terms = parse_query_terms(query)
    if not terms:
        return []
    records_list = list(records)

    if search_store is not None:
        stored_results = search_store.search_search_entries(terms, limit=max(1, min(limit, 200)))
        if stored_results is not None:
            stored_results = hydrate_stored_memory_results(
                stored_results,
                records_list,
                memory_root=memory_root,
                terms=terms,
            )
            stored_results.sort(
                key=lambda item: (-score_text(str(item.get("haystack") or ""), terms, str(item.get("source") or "")), str(item.get("paperTitle") or "").lower())
            )
            return [strip_internal_fields(result, terms) for result in stored_results[: max(1, min(limit, 200))]]

    entries = build_search_index(
        records_list,
        memory_root=memory_root,
        load_markdown=load_markdown,
        load_annotations=load_annotations,
    )
    results = [entry for entry in entries if entry_matches(entry["haystack"], terms)]
    results.sort(key=lambda item: (-score_text(item["haystack"], terms, item["source"]), str(item["paperTitle"]).lower()))
    return [strip_internal_fields(result, terms) for result in results[: max(1, min(limit, 200))]]


def hydrate_stored_memory_results(
    stored_results: list[dict[str, object]],
    records: list[Any],
    *,
    memory_root: Path,
    terms: list[str],
) -> list[dict[str, object]]:
    record_by_id = {str(record.paper_id): record for record in records if hasattr(record, "paper_id")}
    memory_cache: dict[str, dict[str, dict[str, object]]] = {}
    hydrated: list[dict[str, object]] = []
    for result in stored_results:
        if str(result.get("source") or "") != "memory":
            hydrated.append(result)
            continue
        paper_id = optional_string(result.get("paperId"))
        memory_item_id = optional_string(result.get("memoryItemId"))
        if not paper_id or not memory_item_id:
            continue
        record = record_by_id.get(paper_id)
        if record is None:
            continue
        if paper_id not in memory_cache:
            memory_cache[paper_id] = {
                str(item.get("id")): item
                for item in gui_memory.load_memory_items(record, memory_root)
                if isinstance(item.get("id"), str)
            }
        item = memory_cache[paper_id].get(memory_item_id)
        if item is None or not gui_memory.is_behavioral_memory_item(item):
            continue
        text = build_memory_search_text(item)
        haystack = normalize_for_search(f"{record.title} {text}")
        if not entry_matches(haystack, terms):
            continue
        hydrated.append(
            {
                **result,
                "paperTitle": str(record.title),
                "view": result.get("view") or extract_memory_view(item),
                "annotationId": result.get("annotationId") or optional_string(item.get("sourceAnnotationId")),
                "text": text,
                "haystack": haystack,
                "locator": gui_locator.build_memory_locator(item),
            }
        )
    return hydrated


def build_search_index(
    records: Iterable[Any],
    *,
    memory_root: Path,
    load_markdown: SearchMarkdownLoader,
    load_annotations: SearchAnnotationLoader,
) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for record in records:
        entries.extend(
            build_record_search_index(
                record,
                memory_root=memory_root,
                load_markdown=load_markdown,
                load_annotations=load_annotations,
            )
        )
    return entries


def build_record_search_index(
    record: Any,
    *,
    memory_root: Path,
    load_markdown: SearchMarkdownLoader,
    load_annotations: SearchAnnotationLoader,
) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = [
        make_entry(
            record,
            source="title",
            source_id="title",
            text=str(record.title),
            view=None,
        )
    ]

    files = getattr(record, "files", {}) or {}
    for view in ("linearized", "bilingual"):
        markdown = load_markdown(files.get(view))
        if markdown:
            entries.append(
                make_entry(
                    record,
                    source="body",
                    source_id=view,
                    text=markdown,
                    view=view,
                    locator=gui_locator.build_locator(view=view),
                )
            )

    for annotation in load_annotations(record):
        annotation_id = optional_string(annotation.get("id"))
        comments = annotation.get("comments")
        comment_text = ""
        if isinstance(comments, list):
            comment_text = " ".join(
                str(comment.get("content") or "")
                for comment in comments
                if isinstance(comment, dict)
            )
        text = " ".join(
            part
            for part in [
                optional_string(annotation.get("quote")),
                optional_string(annotation.get("contextBefore")),
                optional_string(annotation.get("contextAfter")),
                comment_text,
            ]
            if part
        )
        if text:
            entries.append(
                make_entry(
                    record,
                    source="annotation",
                    source_id=annotation_id or "annotation",
                    text=text,
                    view=optional_string(annotation.get("view")),
                    annotation_id=annotation_id,
                    locator=gui_locator.normalize_locator(
                        annotation.get("locator"),
                        default=gui_locator.build_annotation_locator(annotation),
                    ),
                )
            )

    for item in gui_memory.load_memory_items(record, memory_root):
        if not gui_memory.is_behavioral_memory_item(item):
            continue
        item_id = optional_string(item.get("id"))
        text = build_memory_search_text(item)
        if text:
            entries.append(
                make_entry(
                    record,
                    source="memory",
                    source_id=item_id or "memory",
                    text=text,
                    view=extract_memory_view(item),
                    annotation_id=optional_string(item.get("sourceAnnotationId")),
                    memory_item_id=item_id,
                    locator=gui_locator.build_memory_locator(item),
                )
            )
    return entries


def build_memory_search_text(item: dict[str, object]) -> str:
    return " ".join(
        part
        for part in [
            optional_string(item.get("text")),
            optional_string(item.get("quote")),
            " ".join(str(tag) for tag in item.get("tags", []) if isinstance(tag, str)),
            optional_string(item.get("type")),
        ]
        if part
    )


def make_entry(
    record: Any,
    *,
    source: str,
    source_id: str,
    text: str,
    view: str | None,
    annotation_id: str | None = None,
    memory_item_id: str | None = None,
    locator: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "id": f"{record.paper_id}:{source}:{source_id}",
        "paperId": str(record.paper_id),
        "paperTitle": str(record.title),
        "source": source,
        "sourceLabel": SOURCE_LABELS.get(source, source),
        "view": view,
        "annotationId": annotation_id,
        "memoryItemId": memory_item_id,
        "locator": gui_locator.normalize_locator(locator),
        "text": text,
        "haystack": normalize_for_search(f"{record.title} {text}"),
    }


def strip_internal_fields(entry: dict[str, object], terms: list[str]) -> dict[str, object]:
    source = str(entry.get("source") or "")
    text = display_text_for_source(source, str(entry.get("text") or ""))
    result = {
        "id": entry["id"],
        "paperId": entry["paperId"],
        "paperTitle": entry["paperTitle"],
        "source": source,
        "sourceLabel": entry["sourceLabel"],
        "snippet": build_snippet(text, terms),
        "view": entry.get("view"),
        "annotationId": entry.get("annotationId"),
        "memoryItemId": entry.get("memoryItemId"),
        "locator": gui_locator.normalize_locator(entry.get("locator")),
        "score": score_text(str(entry.get("haystack") or ""), terms, source),
    }
    if source == "body":
        result.update(build_body_match_payload(text, terms, view=entry.get("view")))
    return result


def parse_query_terms(query: str) -> list[str]:
    return [
        term
        for term in re.split(r"\s+", normalize_for_search(query))
        if len(term) >= 2
    ][:8]


def normalize_for_search(value: str) -> str:
    return re.sub(r"\s+", " ", value.casefold()).strip()


def entry_matches(haystack: object, terms: list[str]) -> bool:
    value = str(haystack)
    return all(term in value for term in terms)


def score_text(haystack: str, terms: list[str], source: str) -> int:
    score = sum(max(haystack.count(term), 1) for term in terms)
    if source == "title":
        score += 8
    elif source == "memory":
        score += 5
    elif source == "annotation":
        score += 4
    return score


def build_snippet(text: str, terms: list[str], *, radius: int = 90) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return ""
    folded = cleaned.casefold()
    first_index = min(
        (folded.find(term) for term in terms if folded.find(term) >= 0),
        default=0,
    )
    start = max(first_index - radius, 0)
    end = min(first_index + radius, len(cleaned))
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(cleaned) else ""
    return f"{prefix}{cleaned[start:end].strip()}{suffix}"


def build_body_match_payload(text: str, terms: list[str], *, view: object = None) -> dict[str, object]:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return {}
    folded = cleaned.casefold()
    first_index = min(
        (folded.find(term) for term in terms if folded.find(term) >= 0),
        default=-1,
    )
    if first_index < 0:
        return {}
    quote_radius = 72
    context_radius = 36
    quote_start = max(first_index - quote_radius, 0)
    quote_end = min(first_index + quote_radius, len(cleaned))
    quote = cleaned[quote_start:quote_end].strip(" .,;:!?\n\t")
    if not quote:
        return {}
    locator = gui_locator.build_locator(
        view=view,
        quote=quote,
        context_before=cleaned[max(quote_start - context_radius, 0):quote_start].strip() or None,
        context_after=cleaned[quote_end:min(quote_end + context_radius, len(cleaned))].strip() or None,
    )
    return {
        "matchQuote": quote,
        "matchContextBefore": locator.get("contextBefore") if isinstance(locator, dict) else None,
        "matchContextAfter": locator.get("contextAfter") if isinstance(locator, dict) else None,
        "locator": locator,
    }


def display_text_for_source(source: str, text: str) -> str:
    if source != "body":
        return text
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"`{1,3}", "", text)
    text = re.sub(r"^[>#-]+\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*{1,2}|_{1,2}|~{1,2}", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def optional_string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def extract_memory_view(item: dict[str, object]) -> str | None:
    anchor = item.get("anchor")
    if isinstance(anchor, dict):
        return optional_string(anchor.get("view"))
    return None

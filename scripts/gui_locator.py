from __future__ import annotations

def optional_string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def build_locator(
    *,
    view: object = None,
    annotation_id: object = None,
    comment_id: object = None,
    memory_item_id: object = None,
    block_id: object = None,
    quote: object = None,
    context_before: object = None,
    context_after: object = None,
) -> dict[str, object] | None:
    locator: dict[str, object] = {}
    normalized_view = optional_string(view)
    if normalized_view:
      locator["view"] = normalized_view
    normalized_annotation_id = optional_string(annotation_id)
    if normalized_annotation_id:
      locator["annotationId"] = normalized_annotation_id
    normalized_comment_id = optional_string(comment_id)
    if normalized_comment_id:
      locator["commentId"] = normalized_comment_id
    normalized_memory_item_id = optional_string(memory_item_id)
    if normalized_memory_item_id:
      locator["memoryItemId"] = normalized_memory_item_id
    normalized_block_id = optional_string(block_id)
    if normalized_block_id:
      locator["blockId"] = normalized_block_id
    normalized_quote = optional_string(quote)
    if normalized_quote:
      locator["quote"] = normalized_quote
    normalized_context_before = optional_string(context_before)
    if normalized_context_before:
      locator["contextBefore"] = normalized_context_before
    normalized_context_after = optional_string(context_after)
    if normalized_context_after:
      locator["contextAfter"] = normalized_context_after
    return locator or None


def normalize_locator(value: object, *, default: dict[str, object] | None = None) -> dict[str, object] | None:
    raw = value if isinstance(value, dict) else default if isinstance(default, dict) else None
    if not isinstance(raw, dict):
        return None
    return build_locator(
        view=raw.get("view"),
        annotation_id=raw.get("annotationId"),
        comment_id=raw.get("commentId"),
        memory_item_id=raw.get("memoryItemId"),
        block_id=raw.get("blockId"),
        quote=raw.get("quote"),
        context_before=raw.get("contextBefore"),
        context_after=raw.get("contextAfter"),
    )


def build_annotation_locator(annotation: dict[str, object], *, comment_id: str | None = None) -> dict[str, object] | None:
    return build_locator(
        view=annotation.get("view"),
        annotation_id=annotation.get("id"),
        comment_id=comment_id,
        block_id=annotation.get("blockId"),
        quote=annotation.get("quote"),
        context_before=annotation.get("contextBefore"),
        context_after=annotation.get("contextAfter"),
    )


def build_memory_locator(item: dict[str, object]) -> dict[str, object] | None:
    locator = normalize_locator(item.get("locator"))
    anchor = item.get("anchor") if isinstance(item.get("anchor"), dict) else {}
    fallback = build_locator(
        view=anchor.get("view"),
        annotation_id=item.get("sourceAnnotationId"),
        memory_item_id=item.get("id"),
        block_id=item.get("blockId"),
        quote=item.get("quote") or anchor.get("quote"),
        context_before=anchor.get("contextBefore"),
        context_after=anchor.get("contextAfter"),
    )
    if locator:
        merged = {**(fallback or {}), **locator}
        if "memoryItemId" not in merged:
            memory_item_id = optional_string(item.get("id"))
            if memory_item_id:
                merged["memoryItemId"] = memory_item_id
        return normalize_locator(merged)
    return fallback

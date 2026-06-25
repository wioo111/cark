from __future__ import annotations

from threading import Lock
from typing import Any, Callable

from zotero_client import (
    ZoteroApiDisabledError,
    ZoteroClient,
    ZoteroUnavailableError,
    normalize_item_key,
)


def zotero_status(client: ZoteroClient | None = None) -> dict[str, object]:
    try:
        return (client or ZoteroClient()).status()
    except (ZoteroUnavailableError, ZoteroApiDisabledError, RuntimeError) as error:
        return {
            "available": False,
            "version": None,
            "message": str(error),
        }


def list_zotero_papers(
    query: str = "",
    *,
    client: ZoteroClient | None = None,
    store: Any,
) -> list[dict[str, object]]:
    papers = (client or ZoteroClient()).list_papers(query=query)
    imports = {
        str(item["attachmentKey"]): item
        for item in store.list_zotero_imports()
    }
    for paper in papers:
        imported = imports.get(str(paper["attachmentKey"]))
        paper["imported"] = imported is not None
        paper["taskId"] = imported.get("taskId") if imported else None
    return papers


def import_zotero_paper(
    attachment_key: str,
    *,
    client: ZoteroClient | None = None,
    store: Any,
    import_lock: Lock,
    create_upload_task_from_path: Callable[[Any, str | None], dict[str, object]],
    current_timestamp_iso: Callable[[], str],
) -> dict[str, object]:
    normalized_key = normalize_item_key(attachment_key)
    with import_lock:
        existing = store.get_zotero_import(normalized_key)
        if existing:
            task = store.get_task(str(existing["taskId"]))
            if task:
                return task
            raise ValueError("这篇 Zotero 论文已导入")

        file_path, file_name, item_key = (client or ZoteroClient()).resolve_pdf(normalized_key)
        task = create_upload_task_from_path(file_path, file_name)
        store.record_zotero_import(
            normalized_key,
            item_key,
            str(task["id"]),
            current_timestamp_iso(),
        )
        return task

from __future__ import annotations

from http import HTTPStatus
from typing import Any, Callable
from urllib.parse import parse_qs, unquote


def parse_paper_api_path(path: str) -> tuple[str, str] | None:
    if not path.startswith("/api/papers/"):
        return None
    suffix = path.removeprefix("/api/papers/")
    paper_part, separator, remainder = suffix.partition("/")
    if not paper_part:
        return None
    return unquote(paper_part), f"/{remainder.rstrip('/')}" if separator and remainder else ""


def handle_get(
    handler: Any,
    parsed: Any,
    *,
    get_record: Callable[[str], Any],
    build_detail: Callable[[Any], dict[str, object]],
    load_annotations: Callable[[Any], list[dict[str, object]]],
    get_reading_state: Callable[[str], dict[str, object] | None],
    build_default_reading_state: Callable[[Any], dict[str, object]],
    build_memory_payload: Callable[[Any], dict[str, object]],
    list_copilot_runs: Callable[[Any, str | None], list[dict[str, object]]],
    resolve_media_path: Callable[[Any, str], Any],
) -> bool:
    paper_route = parse_paper_api_path(parsed.path)
    if paper_route:
        paper_id, remainder = paper_route
        try:
            record = get_record(paper_id)
        except FileNotFoundError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
            return True

        if remainder == "":
            handler.write_json(build_detail(record))
            return True
        if remainder == "/annotations":
            handler.write_json(load_annotations(record))
            return True
        if remainder == "/reading-state":
            state = get_reading_state(record.paper_id)
            handler.write_json(state if state is not None else build_default_reading_state(record))
            return True
        if remainder == "/memory":
            handler.write_json(build_memory_payload(record))
            return True
        if remainder == "/copilot-runs":
            annotation_filter = parse_qs(parsed.query).get("annotationId", [None])[0]
            handler.write_json(list_copilot_runs(record, annotation_filter))
            return True
        handler.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)
        return True

    if parsed.path.startswith("/api/media/"):
        paper_id = unquote(parsed.path.removeprefix("/api/media/"))
        relative_path = parse_qs(parsed.query).get("path", [None])[0]
        if not relative_path:
            handler.write_json({"error": "缺少 path 参数"}, status=HTTPStatus.BAD_REQUEST)
            return True
        try:
            record = get_record(paper_id)
            target = resolve_media_path(record, relative_path)
        except (FileNotFoundError, PermissionError) as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
            return True
        handler.serve_file(target)
        return True

    return False


def handle_post(
    handler: Any,
    parsed: Any,
    payload: dict[str, object],
    *,
    get_record: Callable[[str], Any],
    create_annotation: Callable[[Any, dict[str, object]], Any],
    invoke_annotation_agent: Callable[[Any, dict[str, object]], Any],
    create_copilot_run: Callable[[Any, dict[str, object]], dict[str, object]],
    cancel_copilot_run: Callable[[Any, str], dict[str, object]],
    retry_copilot_run: Callable[[Any, str, str | None], dict[str, object]],
    export_markdown: Callable[[Any], dict[str, object]],
    load_annotation: Callable[[Any, str], tuple[Any, dict[str, object]]],
    create_memory_from_annotation: Callable[[Any, dict[str, object], dict[str, object]], Any],
    append_annotation_comment: Callable[[Any, str, dict[str, object]], Any],
    create_memory_item: Callable[[Any, dict[str, object]], Any],
    create_memory_note: Callable[[Any, dict[str, object]], Any],
    load_annotations: Callable[[Any], list[dict[str, object]]],
    build_memory_payload: Callable[[Any], dict[str, object]],
    refresh_index: Callable[[Any], None],
) -> bool:
    paper_route = parse_paper_api_path(parsed.path)
    if not paper_route:
        return False

    paper_id, remainder = paper_route
    try:
        record = get_record(paper_id)
    except FileNotFoundError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
        return True

    try:
        if remainder == "/annotations":
            create_annotation(record, payload)
            refresh_index(record)
            handler.write_json(load_annotations(record))
            return True
        if remainder == "/annotations/agent-comment":
            invoke_annotation_agent(record, payload)
            refresh_index(record)
            handler.write_json(load_annotations(record))
            return True
        if remainder == "/copilot-runs":
            handler.write_json(create_copilot_run(record, payload), status=HTTPStatus.ACCEPTED)
            return True
        if remainder.startswith("/copilot-runs/") and remainder.endswith("/cancel"):
            run_id = unquote(remainder.removeprefix("/copilot-runs/").removesuffix("/cancel").strip("/"))
            handler.write_json(cancel_copilot_run(record, run_id))
            return True
        if remainder.startswith("/copilot-runs/") and remainder.endswith("/retry"):
            run_id = unquote(remainder.removeprefix("/copilot-runs/").removesuffix("/retry").strip("/"))
            agent_id = payload.get("agentId") if isinstance(payload.get("agentId"), str) else None
            handler.write_json(retry_copilot_run(record, run_id, agent_id), status=HTTPStatus.ACCEPTED)
            return True
        if remainder == "/exports/markdown":
            handler.write_json(export_markdown(record), status=HTTPStatus.CREATED)
            return True
        if remainder.startswith("/annotations/") and remainder.endswith("/memory"):
            annotation_id = unquote(remainder.removeprefix("/annotations/").removesuffix("/memory").strip("/"))
            _annotation_path, annotation = load_annotation(record, annotation_id)
            create_memory_from_annotation(record, annotation, payload)
            refresh_index(record)
            handler.write_json(build_memory_payload(record))
            return True
        if remainder.startswith("/annotations/") and remainder.endswith("/comments"):
            annotation_id = unquote(remainder.removeprefix("/annotations/").removesuffix("/comments").strip("/"))
            append_annotation_comment(record, annotation_id, payload)
            refresh_index(record)
            handler.write_json(load_annotations(record))
            return True
        if remainder == "/memory/items":
            create_memory_item(record, payload)
            refresh_index(record)
            handler.write_json(build_memory_payload(record))
            return True
        if remainder == "/notes":
            create_memory_note(record, payload)
            refresh_index(record)
            handler.write_json(build_memory_payload(record))
            return True
    except (ValueError, FileNotFoundError) as error:
        status = HTTPStatus.BAD_REQUEST if isinstance(error, ValueError) else HTTPStatus.NOT_FOUND
        handler.write_json({"error": str(error)}, status=status)
        return True

    handler.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)
    return True


def handle_put(
    handler: Any,
    parsed: Any,
    payload: dict[str, object],
    *,
    get_record: Callable[[str], Any],
    save_reading_state: Callable[[Any, dict[str, object]], dict[str, object]],
) -> bool:
    paper_route = parse_paper_api_path(parsed.path)
    if not paper_route:
        return False

    paper_id, remainder = paper_route
    try:
        record = get_record(paper_id)
        if remainder == "/reading-state":
            handler.write_json(save_reading_state(record, payload))
            return True
    except ValueError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        return True
    except FileNotFoundError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
        return True

    handler.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)
    return True


def handle_patch(
    handler: Any,
    parsed: Any,
    payload: dict[str, object],
    *,
    get_record: Callable[[str], Any],
    update_library: Callable[[Any, dict[str, object]], Any],
    build_paper_summary: Callable[[Any], dict[str, object]],
    update_memory_item: Callable[[Any, str, dict[str, object]], Any],
    update_annotation_comment: Callable[[Any, str, str, dict[str, object]], Any],
    update_annotation: Callable[[Any, str, dict[str, object]], Any],
    build_memory_payload: Callable[[Any], dict[str, object]],
    load_annotations: Callable[[Any], list[dict[str, object]]],
    refresh_index: Callable[[Any], None],
) -> bool:
    paper_route = parse_paper_api_path(parsed.path)
    if not paper_route:
        return False

    paper_id, remainder = paper_route
    try:
        record = get_record(paper_id)
        if remainder == "/library":
            update_library(record, payload)
            handler.write_json(build_paper_summary(record))
            return True
        if remainder.startswith("/memory/items/"):
            item_id = unquote(remainder.removeprefix("/memory/items/").strip("/"))
            update_memory_item(record, item_id, payload)
            refresh_index(record)
            handler.write_json(build_memory_payload(record))
            return True
        if remainder.startswith("/annotations/") and "/comments/" in remainder:
            annotation_suffix = remainder.removeprefix("/annotations/")
            annotation_id, comment_id = annotation_suffix.split("/comments/", 1)
            update_annotation_comment(record, unquote(annotation_id.strip("/")), unquote(comment_id.strip("/")), payload)
            refresh_index(record)
            handler.write_json(load_annotations(record))
            return True
        if remainder.startswith("/annotations/"):
            annotation_id = unquote(remainder.removeprefix("/annotations/").strip("/"))
            update_annotation(record, annotation_id, payload)
            refresh_index(record)
            handler.write_json(load_annotations(record))
            return True
    except ValueError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        return True
    except FileNotFoundError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
        return True

    handler.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)
    return True


def handle_delete(
    handler: Any,
    parsed: Any,
    *,
    get_record: Callable[[str], Any],
    delete_memory_item: Callable[[Any, str], Any],
    delete_annotation: Callable[[Any, str], Any],
    build_memory_payload: Callable[[Any], dict[str, object]],
    load_annotations: Callable[[Any], list[dict[str, object]]],
    refresh_index: Callable[[Any], None],
) -> bool:
    paper_route = parse_paper_api_path(parsed.path)
    if not paper_route:
        return False

    paper_id, remainder = paper_route
    try:
        record = get_record(paper_id)
        if remainder.startswith("/memory/items/"):
            item_id = unquote(remainder.removeprefix("/memory/items/").strip("/"))
            delete_memory_item(record, item_id)
            refresh_index(record)
            handler.write_json(build_memory_payload(record))
            return True
        if remainder.startswith("/annotations/"):
            delete_annotation(record, unquote(remainder.removeprefix("/annotations/").strip("/")))
            refresh_index(record)
            handler.write_json(load_annotations(record))
            return True
    except ValueError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        return True
    except FileNotFoundError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
        return True

    handler.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)
    return True

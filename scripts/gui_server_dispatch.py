from __future__ import annotations

from http import HTTPStatus
from pathlib import Path
from typing import Any

import gui_routes_app
import gui_routes_papers


def handle_get(
    handler: Any,
    parsed: Any,
    *,
    gui_dist_dir: Path,
    app_bindings: dict[str, object],
    papers_bindings: dict[str, object],
    handle_assets_get,
) -> None:
    if gui_routes_app.handle_get(
        handler,
        parsed,
        **app_bindings,
    ):
        return

    if parsed.path in {"/favicon.ico", "/favicon.svg"}:
        handler.send_response(HTTPStatus.NO_CONTENT)
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        return

    if gui_routes_papers.handle_get(
        handler,
        parsed,
        **papers_bindings,
    ):
        return

    if parsed.path.startswith("/assets/"):
        handle_assets_get()
        return

    if parsed.path != "/" and (gui_dist_dir / parsed.path.lstrip("/")).exists():
        handle_assets_get()
        return

    handler.path = "/index.html"
    handle_assets_get()


def handle_post(
    handler: Any,
    parsed: Any,
    *,
    read_json_body,
    app_bindings: dict[str, object],
    papers_bindings: dict[str, object],
) -> None:
    if gui_routes_app.handle_post(
        handler,
        parsed,
        read_json_body=read_json_body,
        read_binary_body=handler.read_binary_body,
        **app_bindings,
    ):
        return

    if gui_routes_papers.handle_post(
        handler,
        parsed,
        read_json_body(),
        **papers_bindings,
    ):
        return

    handler.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)


def handle_put(
    handler: Any,
    parsed: Any,
    *,
    read_json_body,
    papers_bindings: dict[str, object],
) -> None:
    if gui_routes_papers.handle_put(
        handler,
        parsed,
        read_json_body(),
        **papers_bindings,
    ):
        return

    handler.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)


def handle_patch(
    handler: Any,
    parsed: Any,
    *,
    read_json_body,
    app_bindings: dict[str, object],
    papers_bindings: dict[str, object],
) -> None:
    if gui_routes_app.handle_patch(
        handler,
        parsed,
        read_json_body=read_json_body,
        **app_bindings,
    ):
        return

    if gui_routes_papers.handle_patch(
        handler,
        parsed,
        read_json_body(),
        **papers_bindings,
    ):
        return

    handler.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)


def handle_delete(
    handler: Any,
    parsed: Any,
    *,
    app_bindings: dict[str, object],
    papers_bindings: dict[str, object],
) -> None:
    if gui_routes_app.handle_delete(
        handler,
        parsed,
        **app_bindings,
    ):
        return

    if gui_routes_papers.handle_delete(
        handler,
        parsed,
        **papers_bindings,
    ):
        return

    handler.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)

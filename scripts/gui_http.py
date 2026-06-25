from __future__ import annotations

import json
import mimetypes
import sys
from http import HTTPStatus
from pathlib import Path
from typing import Any


def log_message(format_string: str, *args: object) -> None:
    sys.stdout.write(f"[cark-gui] {format_string % args}\n")
    sys.stdout.flush()


def read_json_body(handler: Any) -> dict[str, object]:
    content_length = int(handler.headers.get("Content-Length") or 0)
    body = handler.rfile.read(content_length) if content_length > 0 else b"{}"
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = {}
    return payload if isinstance(payload, dict) else {}


def read_binary_body(handler: Any) -> bytes:
    content_length = int(handler.headers.get("Content-Length") or 0)
    return handler.rfile.read(content_length) if content_length > 0 else b""


def write_json(handler: Any, payload: object, *, status: HTTPStatus = HTTPStatus.OK) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def serve_file(handler: Any, path: Path) -> None:
    if not path.exists() or not path.is_file():
        write_json(handler, {"error": "文件不存在"}, status=HTTPStatus.NOT_FOUND)
        return
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    data = path.read_bytes()
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)

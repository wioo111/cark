from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import gui_memory


def normalize_text_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return " ".join(part for part in (normalize_text_value(item) for item in value) if part).strip()
    if isinstance(value, dict):
        parts: list[str] = []
        for key in ("text", "caption", "footnote", "value", "content"):
            if key in value:
                normalized = normalize_text_value(value.get(key))
                if normalized:
                    parts.append(normalized)
        return " ".join(parts).strip()
    return ""


def normalize_string_list(value: Any, *, limit: int = 8) -> list[str]:
    items: list[str] = []
    if isinstance(value, list):
        for item in value:
            text = normalize_text_value(item)
            if text and text not in items:
                items.append(text)
            if len(items) >= limit:
                break
    return items


def write_json_file(path: Path, payload: Any) -> None:
    gui_memory.write_json_file(path, payload)


def load_json_object(path: Path) -> dict[str, object]:
    payload = gui_memory.read_json_file(path, default={})
    return payload if isinstance(payload, dict) else {}


def load_first_json_object(paths: list[Path]) -> dict[str, object]:
    for path in paths:
        payload = load_json_object(path)
        if payload:
            return payload
    return {}


def sanitize_filename(name: str) -> str:
    base_name = Path(unquote(name or "")).name.strip()
    if not base_name:
        return f"upload-{uuid.uuid4().hex[:8]}.pdf"
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "-", base_name)
    cleaned = cleaned.strip(" .")
    return cleaned or f"upload-{uuid.uuid4().hex[:8]}.pdf"


def sanitize_ascii_stem(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._")
    return cleaned or "input"


def build_direct_network_env(proxy_env_keys: tuple[str, ...]) -> dict[str, str]:
    env = os.environ.copy()
    for key in proxy_env_keys:
        env.pop(key, None)
    env["NO_PROXY"] = "*"
    env["no_proxy"] = "*"
    return env

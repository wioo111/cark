import base64
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional


@dataclass
class PaperRecord:
    paper_id: str
    title: str
    task_id: Optional[str]
    root_dir: Path
    auto_dir: Path
    updated_at: float
    available_views: list[str]
    source_pdf: Optional[str]
    files: dict[str, Optional[Path]]


def default_copilot_agent() -> dict[str, object]:
    return {
        "id": "agent-default",
        "enabled": True,
        "name": "共读助手",
        "rolePrompt": "你是用户的论文共读伙伴。先完整理解论文，再围绕用户划线句子的上下文给出具体、克制、有判断的评论。",
        "apiKey": str(os.getenv("OPENROUTER_API_KEY") or ""),
        "baseUrl": str(os.getenv("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1"),
        "model": str(os.getenv("OPENROUTER_MODEL") or ""),
    }


def current_timestamp_iso() -> str:
    return datetime.now().isoformat()


def encode_paper_id(task_id: Optional[str], title: str) -> str:
    raw = f"{task_id or title}::{title}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").rstrip("=")


def decode_paper_id(paper_id: str) -> tuple[Optional[str], Optional[str]]:
    try:
        padded = paper_id + ("=" * (-len(paper_id) % 4))
        decoded = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
    except Exception:
        return None, None

    if "::" not in decoded:
        return None, None

    first, second = decoded.split("::", 1)
    return first or None, second or None

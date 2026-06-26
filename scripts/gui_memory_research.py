from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

import gui_memory


def list_memory_research_state(memory_root: Path, records: Iterable[Any]) -> dict[str, object]:
    recent_insights: list[dict[str, object]] = []
    open_questions: list[dict[str, object]] = []
    for record in records:
        for item in gui_memory.load_memory_items(record, memory_root):
            if str(item.get("activationStatus") or "active") != "active":
                continue
            if str(item.get("status") or "active") == "archived":
                continue
            item_type = str(item.get("type") or "")
            if item_type == "insight":
                recent_insights.append(decorate_paper_research_item(record, item))
            elif item_type == "question" and str(item.get("status") or "active") != "done":
                open_questions.append(decorate_paper_research_item(record, item))
    recent_insights.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
    open_questions.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
    return {
        "recentInsights": recent_insights[:8],
        "openQuestions": open_questions[:8],
        "insightCount": len(recent_insights),
        "openQuestionCount": len(open_questions),
    }


def decorate_paper_research_item(record: Any, item: dict[str, object]) -> dict[str, object]:
    return {
        **item,
        "layer": "paper",
        "paperId": str(record.paper_id),
        "paperTitle": str(record.title),
    }

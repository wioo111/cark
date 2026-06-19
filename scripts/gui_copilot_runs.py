from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import gui_memory


RUN_STATUSES = {"queued", "running", "done", "failed", "canceled"}
ACTIVE_STATUSES = {"queued", "running"}
RETRYABLE_AGENT_STATUSES = {"failed", "canceled"}
_RUN_LOCK = threading.RLock()


def current_timestamp_iso() -> str:
    return datetime.now().isoformat()


def paper_runs_dir(record: Any, memory_root: Path) -> Path:
    gui_memory.migrate_legacy_paper_memory(record, memory_root)
    return gui_memory.paper_memory_dir(record, memory_root) / "copilot_runs"


def run_path(record: Any, memory_root: Path, run_id: str) -> Path:
    return paper_runs_dir(record, memory_root) / f"{safe_run_id(run_id)}.json"


def safe_run_id(run_id: str) -> str:
    cleaned = "".join(ch for ch in str(run_id).strip() if ch.isalnum() or ch in {"-", "_"})
    if not cleaned:
        raise FileNotFoundError("未找到指定共读任务")
    return cleaned[:96]


def list_runs(record: Any, memory_root: Path) -> list[dict[str, object]]:
    root = paper_runs_dir(record, memory_root)
    if not root.exists():
        return []
    runs: list[dict[str, object]] = []
    for path in sorted(root.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        payload = gui_memory.read_json_file(path)
        if isinstance(payload, dict):
            runs.append(normalize_run(record, payload))
    runs.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
    return runs[:120]


def list_active_runs(record: Any, memory_root: Path) -> list[dict[str, object]]:
    return [run for run in list_runs(record, memory_root) if is_active_run(run)]


def load_run(record: Any, memory_root: Path, run_id: str) -> dict[str, object]:
    path = run_path(record, memory_root, run_id)
    if not path.exists():
        raise FileNotFoundError("未找到指定共读任务")
    payload = gui_memory.read_json_file(path)
    if not isinstance(payload, dict):
        raise FileNotFoundError("共读任务记录损坏")
    return normalize_run(record, payload)


def create_run(record: Any, memory_root: Path, payload: dict[str, object], agents: list[dict[str, object]]) -> dict[str, object]:
    annotation_id = payload.get("annotationId")
    if not isinstance(annotation_id, str) or not annotation_id.strip():
        raise ValueError("缺少批注标识")
    if not agents:
        raise ValueError("缺少可运行的智能体")

    timestamp = current_timestamp_iso()
    run_id = f"run-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    agent_runs = [
        {
            "agentId": str(agent.get("id") or "").strip(),
            "agentName": str(agent.get("name") or "共读助手").strip() or "共读助手",
            "status": "queued",
            "resultCommentId": None,
            "error": None,
            "startedAt": None,
            "finishedAt": None,
        }
        for agent in agents
        if str(agent.get("id") or "").strip()
    ]
    if not agent_runs:
        raise ValueError("缺少可运行的智能体")

    run = {
        "runId": run_id,
        "paperId": record.paper_id,
        "annotationId": annotation_id.strip(),
        "agents": agent_runs,
        "status": "queued",
        "userMessage": str(payload.get("userMessage") or "").strip(),
        "followUpCommentId": str(payload.get("followUpCommentId") or "").strip() or None,
        "followUpAgentId": str(payload.get("followUpAgentId") or "").strip() or None,
        "results": [],
        "errors": [],
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "startedAt": None,
        "finishedAt": None,
        "attempt": 1,
    }
    save_run(record, memory_root, run)
    return run


def save_run(record: Any, memory_root: Path, run: dict[str, object]) -> dict[str, object]:
    normalized = normalize_run(record, run)
    path = run_path(record, memory_root, str(normalized["runId"]))
    with _RUN_LOCK:
        gui_memory.write_json_file(path, normalized)
    return normalized


def update_run(record: Any, memory_root: Path, run_id: str, updater) -> dict[str, object]:
    with _RUN_LOCK:
        run = load_run(record, memory_root, run_id)
        next_run = updater(dict(run)) or run
        next_run["updatedAt"] = current_timestamp_iso()
        return save_run(record, memory_root, next_run)


def mark_run_running(record: Any, memory_root: Path, run_id: str) -> dict[str, object]:
    def apply(run: dict[str, object]) -> dict[str, object]:
        if run.get("status") == "canceled":
            return run
        timestamp = current_timestamp_iso()
        run["status"] = "running"
        run["startedAt"] = run.get("startedAt") or timestamp
        return run

    return update_run(record, memory_root, run_id, apply)


def mark_agent_running(record: Any, memory_root: Path, run_id: str, agent_id: str) -> dict[str, object]:
    def apply(run: dict[str, object]) -> dict[str, object]:
        timestamp = current_timestamp_iso()
        agents = normalize_agent_runs(run.get("agents"))
        for agent in agents:
            if agent.get("agentId") == agent_id and agent.get("status") != "done":
                agent["status"] = "running"
                agent["startedAt"] = agent.get("startedAt") or timestamp
                agent["finishedAt"] = None
                agent["error"] = None
        run["agents"] = agents
        run["status"] = "running"
        run["startedAt"] = run.get("startedAt") or timestamp
        return run

    return update_run(record, memory_root, run_id, apply)


def mark_agent_done(record: Any, memory_root: Path, run_id: str, agent_id: str, comment_id: str | None) -> dict[str, object]:
    def apply(run: dict[str, object]) -> dict[str, object]:
        timestamp = current_timestamp_iso()
        agents = normalize_agent_runs(run.get("agents"))
        for agent in agents:
            if agent.get("agentId") == agent_id:
                agent["status"] = "done"
                agent["resultCommentId"] = comment_id
                agent["error"] = None
                agent["finishedAt"] = timestamp
                break
        run["agents"] = agents
        run["results"] = [
            *normalize_results(run.get("results")),
            {"agentId": agent_id, "commentId": comment_id, "createdAt": timestamp},
        ]
        return finish_if_terminal(run)

    return update_run(record, memory_root, run_id, apply)


def mark_agent_failed(record: Any, memory_root: Path, run_id: str, agent_id: str, message: str) -> dict[str, object]:
    def apply(run: dict[str, object]) -> dict[str, object]:
        timestamp = current_timestamp_iso()
        agents = normalize_agent_runs(run.get("agents"))
        for agent in agents:
            if agent.get("agentId") == agent_id:
                agent["status"] = "failed"
                agent["error"] = message
                agent["finishedAt"] = timestamp
                break
        run["agents"] = agents
        run["errors"] = [
            *normalize_errors(run.get("errors")),
            {"agentId": agent_id, "message": message, "createdAt": timestamp},
        ]
        return finish_if_terminal(run)

    return update_run(record, memory_root, run_id, apply)


def cancel_run(record: Any, memory_root: Path, run_id: str) -> dict[str, object]:
    def apply(run: dict[str, object]) -> dict[str, object]:
        timestamp = current_timestamp_iso()
        agents = normalize_agent_runs(run.get("agents"))
        for agent in agents:
            if agent.get("status") in ACTIVE_STATUSES:
                agent["status"] = "canceled"
                agent["finishedAt"] = timestamp
        run["agents"] = agents
        run["status"] = "canceled"
        run["finishedAt"] = timestamp
        return run

    return update_run(record, memory_root, run_id, apply)


def prepare_retry(record: Any, memory_root: Path, run_id: str, agent_id: str | None = None) -> dict[str, object]:
    def apply(run: dict[str, object]) -> dict[str, object]:
        agents = normalize_agent_runs(run.get("agents"))
        target_agent_id = str(agent_id or "").strip()
        retry_count = 0
        for agent in agents:
            if target_agent_id and agent.get("agentId") != target_agent_id:
                continue
            if agent.get("status") in RETRYABLE_AGENT_STATUSES:
                agent["status"] = "queued"
                agent["error"] = None
                agent["startedAt"] = None
                agent["finishedAt"] = None
                retry_count += 1
        if retry_count == 0:
            raise ValueError("没有可重试的智能体")
        run["agents"] = agents
        run["status"] = "queued"
        run["finishedAt"] = None
        run["attempt"] = int(run.get("attempt") or 1) + 1
        return run

    return update_run(record, memory_root, run_id, apply)


def prepare_resume(record: Any, memory_root: Path, run_id: str) -> dict[str, object]:
    def apply(run: dict[str, object]) -> dict[str, object]:
        agents = normalize_agent_runs(run.get("agents"))
        resumed_count = 0
        for agent in agents:
            if agent.get("status") in ACTIVE_STATUSES:
                agent["status"] = "queued"
                agent["error"] = None
                agent["startedAt"] = None
                agent["finishedAt"] = None
                resumed_count += 1
        if resumed_count == 0:
            return finish_if_terminal({**run, "agents": agents})
        run["agents"] = agents
        run["status"] = "queued"
        run["finishedAt"] = None
        return run

    return update_run(record, memory_root, run_id, apply)


def expire_stale_active_runs(
    record: Any,
    memory_root: Path,
    *,
    timeout_seconds: int,
    message: str = "共读任务超时，请重试",
) -> int:
    expired_count = 0
    now = datetime.now()
    for run in list_active_runs(record, memory_root):
        run_id = str(run.get("runId") or "").strip()
        if not run_id:
            continue
        updated_at = parse_timestamp(str(run.get("updatedAt") or ""))
        if updated_at is None or now - updated_at <= timedelta(seconds=timeout_seconds):
            continue

        def apply(current: dict[str, object]) -> dict[str, object]:
            timestamp = current_timestamp_iso()
            agents = normalize_agent_runs(current.get("agents"))
            errors = normalize_errors(current.get("errors"))
            for agent in agents:
                if agent.get("status") in ACTIVE_STATUSES:
                    agent["status"] = "failed"
                    agent["error"] = message
                    agent["finishedAt"] = timestamp
                    errors.append(
                        {
                            "agentId": agent.get("agentId"),
                            "message": message,
                            "createdAt": timestamp,
                        }
                    )
            current["agents"] = agents
            current["errors"] = errors
            current["status"] = "failed"
            current["finishedAt"] = timestamp
            return current

        update_run(record, memory_root, run_id, apply)
        expired_count += 1
    return expired_count


def is_canceled(record: Any, memory_root: Path, run_id: str) -> bool:
    try:
        return load_run(record, memory_root, run_id).get("status") == "canceled"
    except FileNotFoundError:
        return True


def is_active_run(run: dict[str, object]) -> bool:
    status = str(run.get("status") or "")
    if status in ACTIVE_STATUSES:
        return True
    return any(agent.get("status") in ACTIVE_STATUSES for agent in normalize_agent_runs(run.get("agents")))


def finish_if_terminal(run: dict[str, object]) -> dict[str, object]:
    agents = normalize_agent_runs(run.get("agents"))
    if any(agent.get("status") in ACTIVE_STATUSES for agent in agents):
        run["status"] = "running"
        return run
    timestamp = current_timestamp_iso()
    if any(agent.get("status") == "failed" for agent in agents):
        run["status"] = "failed"
    elif agents and all(agent.get("status") == "canceled" for agent in agents):
        run["status"] = "canceled"
    else:
        run["status"] = "done"
    run["finishedAt"] = run.get("finishedAt") or timestamp
    return run


def normalize_run(record: Any, payload: dict[str, object]) -> dict[str, object]:
    status = str(payload.get("status") or "queued")
    if status not in RUN_STATUSES:
        status = "queued"
    return {
        "schemaVersion": gui_memory.JSON_SCHEMA_VERSION,
        "runId": str(payload.get("runId") or payload.get("id") or "").strip(),
        "paperId": str(payload.get("paperId") or record.paper_id),
        "annotationId": str(payload.get("annotationId") or "").strip(),
        "agents": normalize_agent_runs(payload.get("agents")),
        "status": status,
        "userMessage": str(payload.get("userMessage") or ""),
        "followUpCommentId": str(payload.get("followUpCommentId") or "").strip() or None,
        "followUpAgentId": str(payload.get("followUpAgentId") or "").strip() or None,
        "results": normalize_results(payload.get("results")),
        "errors": normalize_errors(payload.get("errors")),
        "createdAt": str(payload.get("createdAt") or current_timestamp_iso()),
        "updatedAt": str(payload.get("updatedAt") or payload.get("createdAt") or current_timestamp_iso()),
        "startedAt": str(payload.get("startedAt")) if payload.get("startedAt") else None,
        "finishedAt": str(payload.get("finishedAt")) if payload.get("finishedAt") else None,
        "attempt": max(int(payload.get("attempt") or 1), 1),
    }


def normalize_agent_runs(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    agents: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "queued")
        if status not in RUN_STATUSES:
            status = "queued"
        agent_id = str(item.get("agentId") or item.get("id") or "").strip()
        if not agent_id:
            continue
        agents.append(
            {
                "agentId": agent_id,
                "agentName": str(item.get("agentName") or item.get("name") or "共读助手").strip() or "共读助手",
                "status": status,
                "resultCommentId": str(item.get("resultCommentId") or "").strip() or None,
                "error": str(item.get("error") or "").strip() or None,
                "startedAt": str(item.get("startedAt")) if item.get("startedAt") else None,
                "finishedAt": str(item.get("finishedAt")) if item.get("finishedAt") else None,
            }
        )
    return agents


def normalize_results(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def normalize_errors(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def parse_timestamp(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None

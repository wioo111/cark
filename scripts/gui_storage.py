import json
import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any


ACTIVE_TASK_STATUSES = ("queued", "running")


def format_task_command(command: list[str]) -> str:
    secret_flags = {"--api-token", "--app-secret", "--folder-token"}
    masked: list[str] = []
    hide_next = False
    for item in command:
        if hide_next:
            masked.append("***")
            hide_next = False
            continue
        masked.append(item)
        if item in secret_flags:
            hide_next = True
    return " ".join(masked)


def redact_task_log_line(line: str) -> str:
    return re.sub(
        r"(--(?:api-token|app-secret|folder-token)\s+)\S+",
        r"\1***",
        line,
        flags=re.IGNORECASE,
    )


class SingleInstanceLock:
    def __init__(self, path: Path):
        self.path = path
        self._handle = None

    def acquire(self) -> bool:
        if self._handle is not None:
            return True
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+b")
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            handle.close()
            return False
        self._handle = handle
        return True

    def release(self):
        handle = self._handle
        if handle is None:
            return
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
            self._handle = None


class WorkbenchStore:
    def __init__(self, database_path: Path):
        self.database_path = database_path
        self._lock = threading.RLock()
        self.initialize()

    def _connect(self) -> sqlite3.Connection:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self):
        with self._lock, self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    file_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    error TEXT,
                    logs_json TEXT NOT NULL,
                    result_json TEXT,
                    source_path TEXT,
                    owner_id TEXT,
                    worker_pid INTEGER
                );

                CREATE TABLE IF NOT EXISTS papers (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    task_id TEXT,
                    root_dir TEXT NOT NULL,
                    auto_dir TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    available_views_json TEXT NOT NULL,
                    source_pdf TEXT,
                    files_json TEXT NOT NULL,
                    indexed_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS reading_states (
                    paper_id TEXT PRIMARY KEY,
                    view TEXT NOT NULL,
                    scroll_y REAL NOT NULL,
                    active_section_id TEXT,
                    draft_json TEXT,
                    updated_at TEXT NOT NULL,
                    client_revision INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS zotero_imports (
                    attachment_key TEXT PRIMARY KEY,
                    item_key TEXT,
                    task_id TEXT NOT NULL,
                    imported_at TEXT NOT NULL
                );
                """
            )
            task_columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(tasks)").fetchall()
            }
            if "owner_id" not in task_columns:
                connection.execute("ALTER TABLE tasks ADD COLUMN owner_id TEXT")
            if "worker_pid" not in task_columns:
                connection.execute("ALTER TABLE tasks ADD COLUMN worker_pid INTEGER")
            reading_state_columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(reading_states)").fetchall()
            }
            if "client_revision" not in reading_state_columns:
                connection.execute(
                    "ALTER TABLE reading_states ADD COLUMN client_revision INTEGER NOT NULL DEFAULT 0"
                )
            rows = connection.execute("SELECT id, logs_json FROM tasks").fetchall()
            for row in rows:
                logs = _load_json(row["logs_json"], [])
                if not isinstance(logs, list):
                    continue
                sanitized = [
                    redact_task_log_line(str(line))
                    for line in logs
                ]
                if sanitized != logs:
                    connection.execute(
                        "UPDATE tasks SET logs_json = ? WHERE id = ?",
                        (_dump_json(sanitized), row["id"]),
                    )

    def create_task(self, task: dict[str, object], source_path: str | None, owner_id: str):
        with self._lock, self._connection() as connection:
            connection.execute(
                """
                INSERT INTO tasks (
                    id, file_name, status, stage, progress, created_at, updated_at,
                    error, logs_json, result_json, source_path, owner_id, worker_pid
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task["id"],
                    task["fileName"],
                    task["status"],
                    task["stage"],
                    int(task["progress"]),
                    task["createdAt"],
                    task["updatedAt"],
                    task.get("error"),
                    _dump_json(
                        [
                            redact_task_log_line(str(line))
                            for line in (task.get("logs") or [])
                        ]
                    ),
                    _dump_json(task.get("result")) if task.get("result") is not None else None,
                    source_path,
                    owner_id,
                    None,
                ),
            )

    def get_task(self, task_id: str) -> dict[str, object] | None:
        with self._lock, self._connection() as connection:
            row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return _task_from_row(row) if row else None

    def get_task_source_path(self, task_id: str) -> str | None:
        with self._lock, self._connection() as connection:
            row = connection.execute("SELECT source_path FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return str(row["source_path"]) if row and row["source_path"] else None

    def get_task_runtime(self, task_id: str) -> dict[str, object] | None:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT owner_id, worker_pid FROM tasks WHERE id = ?",
                (task_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "ownerId": row["owner_id"],
            "workerPid": int(row["worker_pid"]) if row["worker_pid"] is not None else None,
        }

    def list_tasks(self) -> list[dict[str, object]]:
        with self._lock, self._connection() as connection:
            rows = connection.execute("SELECT * FROM tasks ORDER BY created_at DESC").fetchall()
        return [_task_from_row(row) for row in rows]

    def update_task(self, task_id: str, updated_at: str, **changes: object):
        column_map = {
            "fileName": "file_name",
            "status": "status",
            "stage": "stage",
            "progress": "progress",
            "error": "error",
            "logs": "logs_json",
            "result": "result_json",
            "ownerId": "owner_id",
            "workerPid": "worker_pid",
        }
        assignments = ["updated_at = ?"]
        values: list[object] = [updated_at]
        for key, value in changes.items():
            column = column_map.get(key)
            if not column:
                continue
            if key in {"logs", "result"}:
                value = _dump_json(value) if value is not None else None
            assignments.append(f"{column} = ?")
            values.append(value)
        values.append(task_id)
        with self._lock, self._connection() as connection:
            connection.execute(
                f"UPDATE tasks SET {', '.join(assignments)} WHERE id = ?",
                values,
            )

    def append_task_log(
        self,
        task_id: str,
        line: str,
        updated_at: str,
        *,
        stage: str | None = None,
        progress: int | None = None,
    ):
        with self._lock, self._connection() as connection:
            row = connection.execute("SELECT logs_json FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if not row:
                return
            logs = _load_json(row["logs_json"], [])
            if not isinstance(logs, list):
                logs = []
            logs.append(redact_task_log_line(line))
            logs = logs[-240:]
            assignments = ["logs_json = ?", "updated_at = ?"]
            values: list[object] = [_dump_json(logs), updated_at]
            if stage is not None:
                assignments.append("stage = ?")
                values.append(stage)
            if progress is not None:
                assignments.append("progress = ?")
                values.append(max(0, min(int(progress), 100)))
            values.append(task_id)
            connection.execute(
                f"UPDATE tasks SET {', '.join(assignments)} WHERE id = ?",
                values,
            )

    def mark_orphaned_active_tasks_interrupted(self, owner_id: str, updated_at: str) -> int:
        message = "服务在任务完成前停止。请确认配置后重试。"
        with self._lock, self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE tasks
                SET status = 'interrupted',
                    stage = '已中断',
                    error = ?,
                    updated_at = ?
                WHERE status IN ('queued', 'running')
                  AND (owner_id IS NULL OR owner_id != ?)
                """,
                (message, updated_at, owner_id),
            )
            return cursor.rowcount

    def reset_task_for_retry(self, task_id: str, owner_id: str, updated_at: str):
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT status, logs_json FROM tasks WHERE id = ?",
                (task_id,),
            ).fetchone()
            if not row:
                raise FileNotFoundError("未找到指定任务")
            if row["status"] not in {"failed", "interrupted"}:
                raise ValueError("只有失败或已中断的任务可以重试")
            logs = _load_json(row["logs_json"], [])
            if not isinstance(logs, list):
                logs = []
            logs.append("正在重试任务")
            connection.execute(
                """
                UPDATE tasks
                SET status = 'queued',
                    stage = '等待重试',
                    progress = 0,
                    error = NULL,
                    result_json = NULL,
                    logs_json = ?,
                    owner_id = ?,
                    worker_pid = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (_dump_json(logs[-240:]), owner_id, updated_at, task_id),
            )

    def upsert_papers(self, papers: list[dict[str, object]], indexed_at: str):
        with self._lock, self._connection() as connection:
            self._upsert_papers(connection, papers, indexed_at)

    def sync_papers(self, papers: list[dict[str, object]], indexed_at: str):
        with self._lock, self._connection() as connection:
            self._upsert_papers(connection, papers, indexed_at)
            connection.execute(
                "CREATE TEMP TABLE current_paper_ids (id TEXT PRIMARY KEY)"
            )
            connection.executemany(
                "INSERT INTO current_paper_ids (id) VALUES (?)",
                [(paper["id"],) for paper in papers],
            )
            connection.execute(
                "DELETE FROM papers WHERE id NOT IN (SELECT id FROM current_paper_ids)"
            )
            connection.execute("DROP TABLE current_paper_ids")

    def _upsert_papers(
        self,
        connection: sqlite3.Connection,
        papers: list[dict[str, object]],
        indexed_at: str,
    ):
        connection.executemany(
            """
            INSERT INTO papers (
                id, title, task_id, root_dir, auto_dir, updated_at,
                available_views_json, source_pdf, files_json, indexed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                task_id = excluded.task_id,
                root_dir = excluded.root_dir,
                auto_dir = excluded.auto_dir,
                updated_at = excluded.updated_at,
                available_views_json = excluded.available_views_json,
                source_pdf = excluded.source_pdf,
                files_json = excluded.files_json,
                indexed_at = excluded.indexed_at
            """,
            [
                (
                    paper["id"],
                    paper["title"],
                    paper.get("taskId"),
                    paper["rootDir"],
                    paper["autoDir"],
                    float(paper["updatedAt"]),
                    _dump_json(paper.get("availableViews") or []),
                    paper.get("sourcePdf"),
                    _dump_json(paper.get("files") or {}),
                    indexed_at,
                )
                for paper in papers
            ],
        )

    def list_papers(self) -> list[dict[str, object]]:
        with self._lock, self._connection() as connection:
            rows = connection.execute("SELECT * FROM papers ORDER BY updated_at DESC").fetchall()
        return [_paper_from_row(row) for row in rows]

    def record_zotero_import(
        self,
        attachment_key: str,
        item_key: str | None,
        task_id: str,
        imported_at: str,
    ):
        with self._lock, self._connection() as connection:
            connection.execute(
                """
                INSERT INTO zotero_imports (
                    attachment_key, item_key, task_id, imported_at
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(attachment_key) DO UPDATE SET
                    item_key = excluded.item_key,
                    task_id = excluded.task_id,
                    imported_at = excluded.imported_at
                """,
                (attachment_key, item_key, task_id, imported_at),
            )

    def get_zotero_import(self, attachment_key: str) -> dict[str, object] | None:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM zotero_imports WHERE attachment_key = ?",
                (attachment_key,),
            ).fetchone()
        if not row:
            return None
        return {
            "attachmentKey": row["attachment_key"],
            "itemKey": row["item_key"],
            "taskId": row["task_id"],
            "importedAt": row["imported_at"],
        }

    def list_zotero_imports(self) -> list[dict[str, object]]:
        with self._lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM zotero_imports ORDER BY imported_at DESC"
            ).fetchall()
        return [
            {
                "attachmentKey": row["attachment_key"],
                "itemKey": row["item_key"],
                "taskId": row["task_id"],
                "importedAt": row["imported_at"],
            }
            for row in rows
        ]

    def get_reading_state(self, paper_id: str) -> dict[str, object] | None:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM reading_states WHERE paper_id = ?",
                (paper_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "paperId": row["paper_id"],
            "view": row["view"],
            "scrollY": float(row["scroll_y"]),
            "activeSectionId": row["active_section_id"],
            "draft": _load_json(row["draft_json"], None),
            "updatedAt": row["updated_at"],
            "clientRevision": int(row["client_revision"]),
        }

    def save_reading_state(self, paper_id: str, state: dict[str, object], updated_at: str) -> dict[str, object]:
        view = state.get("view")
        if view not in {"linearized", "bilingual"}:
            raise ValueError("阅读视图非法")
        try:
            scroll_y = max(float(state.get("scrollY") or 0), 0)
        except (TypeError, ValueError) as error:
            raise ValueError("阅读位置非法") from error
        active_section_id = state.get("activeSectionId")
        if active_section_id is not None and not isinstance(active_section_id, str):
            raise ValueError("章节位置非法")
        draft = state.get("draft")
        if draft is not None and not isinstance(draft, dict):
            raise ValueError("批注草稿非法")
        try:
            client_revision = max(int(state.get("clientRevision") or 0), 0)
        except (TypeError, ValueError) as error:
            raise ValueError("阅读状态版本非法") from error

        with self._lock, self._connection() as connection:
            connection.execute(
                """
                INSERT INTO reading_states (
                    paper_id, view, scroll_y, active_section_id, draft_json, updated_at,
                    client_revision
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(paper_id) DO UPDATE SET
                    view = excluded.view,
                    scroll_y = excluded.scroll_y,
                    active_section_id = excluded.active_section_id,
                    draft_json = excluded.draft_json,
                    updated_at = excluded.updated_at,
                    client_revision = excluded.client_revision
                WHERE excluded.client_revision >= reading_states.client_revision
                """,
                (
                    paper_id,
                    view,
                    scroll_y,
                    active_section_id,
                    _dump_json(draft) if draft is not None else None,
                    updated_at,
                    client_revision,
                ),
            )
        saved = self.get_reading_state(paper_id)
        if saved is None:
            raise RuntimeError("阅读状态保存失败")
        return saved


def _dump_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _load_json(value: str | None, fallback: Any) -> Any:
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _task_from_row(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "fileName": row["file_name"],
        "status": row["status"],
        "stage": row["stage"],
        "progress": int(row["progress"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "error": row["error"],
        "logs": _load_json(row["logs_json"], []),
        "result": _load_json(row["result_json"], None),
    }


def _paper_from_row(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "title": row["title"],
        "taskId": row["task_id"],
        "rootDir": row["root_dir"],
        "autoDir": row["auto_dir"],
        "updatedAt": float(row["updated_at"]),
        "availableViews": _load_json(row["available_views_json"], []),
        "sourcePdf": row["source_pdf"],
        "files": _load_json(row["files_json"], {}),
    }

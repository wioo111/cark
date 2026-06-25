from __future__ import annotations

import json
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional


def snapshot_task(store: Any, task_id: str) -> dict[str, object] | None:
    return store.get_task(task_id)


def list_tasks_payload(store: Any) -> list[dict[str, object]]:
    return store.list_tasks()


def update_task(
    store: Any,
    timestamp_factory: Callable[[], str],
    task_id: str,
    **changes: object,
) -> None:
    store.update_task(task_id, timestamp_factory(), **changes)


def append_task_log(
    store: Any,
    timestamp_factory: Callable[[], str],
    task_id: str,
    line: str,
    *,
    stage: Optional[str] = None,
    progress: Optional[int] = None,
) -> None:
    cleaned = line.rstrip()
    if not cleaned:
        return
    store.append_task_log(
        task_id,
        cleaned,
        timestamp_factory(),
        stage=stage,
        progress=progress,
    )


def extract_json_result(output_text: str) -> Optional[dict[str, object]]:
    if not output_text:
        return None
    for index in range(len(output_text) - 1, -1, -1):
        if output_text[index] != "{":
            continue
        candidate = output_text[index:].strip()
        try:
            payload = json.loads(candidate)
        except Exception:
            continue
        if isinstance(payload, dict) and ("linearized_markdown" in payload or "input_pdf" in payload):
            return payload
    return None


def find_record_for_output(
    payload: dict[str, object],
    *,
    indexed_records_func: Callable[..., dict[str, Any]],
) -> Optional[Any]:
    linearized_path = payload.get("linearized_markdown")
    content_list_path = payload.get("content_list_json")
    linearized_target = Path(linearized_path).resolve() if isinstance(linearized_path, str) else None
    content_list_target = Path(content_list_path).resolve() if isinstance(content_list_path, str) else None

    for record in indexed_records_func(refresh=True).values():
        record_linearized = record.files.get("linearized")
        record_content_list = record.files.get("contentListJson")
        try:
            if linearized_target and record_linearized and record_linearized.resolve() == linearized_target:
                return record
            if content_list_target and record_content_list and record_content_list.resolve() == content_list_target:
                return record
        except OSError:
            continue
    return None


def build_task_command(
    file_path: Path,
    settings: dict[str, object],
    *,
    workbench_root: Path,
    build_direct_network_env: Callable[[], dict[str, str]],
    sanitize_ascii_stem: Callable[[str], str],
    python_executable: str = sys.executable,
) -> tuple[list[str], dict[str, str], Path]:
    mineru_settings = settings["mineru"]
    translation_settings = settings["translation"]
    publish_settings = settings["publish"]
    if not isinstance(mineru_settings, dict) or not isinstance(translation_settings, dict) or not isinstance(publish_settings, dict):
        raise ValueError("设置数据损坏")

    backend = str(mineru_settings.get("backend") or "local")
    if backend == "cloud" and not str(mineru_settings.get("apiToken") or "").strip():
        raise ValueError("云解析已启用，但 MinerU API Token 为空")
    if bool(translation_settings.get("enabled")) and not str(translation_settings.get("apiKey") or "").strip():
        raise ValueError("双语翻译已启用，但翻译 API Key 为空")
    if not bool(publish_settings.get("prepareOnly", True)):
        required = {
            "folderToken": "飞书目录 token",
            "appId": "飞书 app id",
            "appSecret": "飞书 app secret",
        }
        missing = [label for key, label in required.items() if not str(publish_settings.get(key) or "").strip()]
        if missing:
            raise ValueError("协作平台导出已启用，但缺少: " + "、".join(missing))

    script_path = workbench_root / "scripts" / "pdf_to_feishu_docx.py"
    command = [
        python_executable,
        str(script_path),
        "--input-pdf",
        str(file_path),
        "--backend",
        backend,
        "--parse-method",
        str(mineru_settings.get("parseMethod") or "auto"),
        "--image-mode",
        str(publish_settings.get("imageMode") or "note"),
    ]
    if backend == "cloud":
        command.extend(["--model-version", str(mineru_settings.get("modelVersion") or "pipeline")])
        command.extend(["--api-token", str(mineru_settings.get("apiToken") or "")])
    if bool(mineru_settings.get("reuseExistingParse", True)):
        command.append("--reuse-existing-parse")
    if bool(translation_settings.get("enabled")):
        command.append("--translate")
    if bool(publish_settings.get("prepareOnly", True)):
        command.append("--prepare-only")
    else:
        command.extend(["--folder-token", str(publish_settings.get("folderToken") or "")])
        command.extend(["--app-id", str(publish_settings.get("appId") or "")])
        command.extend(["--app-secret", str(publish_settings.get("appSecret") or "")])

    env = build_direct_network_env()
    env["OPENAI_API_KEY"] = str(translation_settings.get("apiKey") or "")
    env["OPENAI_BASE_URL"] = str(translation_settings.get("baseUrl") or "https://api.deepseek.com/v1")
    env["OPENAI_MODEL"] = str(translation_settings.get("model") or "deepseek-chat")
    fail_ratio_limit = translation_settings.get("failRatioLimit")
    env["TRANSLATE_FAIL_RATIO_LIMIT"] = str(0.2 if fail_ratio_limit is None else fail_ratio_limit)

    safe_stem = sanitize_ascii_stem(file_path.stem)
    mineru_log = workbench_root / "runtime" / "logs" / f"mineru_{safe_stem}.log"
    return command, env, mineru_log


def detect_stdout_stage(line: str) -> tuple[Optional[str], Optional[int]]:
    lowered = line.lower()
    if "[preflight" in line:
        return "环境检查", 8
    if "[云解析]" in line:
        return "云端解析", 42
    if "translating" in lowered or "翻译" in line:
        return "双语翻译", 72
    if "document_url" in line or "document_token" in line:
        return "协作平台导出", 92
    if "linearized_markdown" in line or "prepared_markdown" in line:
        return "整理产物", 84
    return None, None


def run_upload_task(
    task_id: str,
    file_path: Path,
    *,
    load_settings: Callable[[], dict[str, object]],
    build_task_command_func: Callable[[Path, dict[str, object]], tuple[list[str], dict[str, str], Path]],
    update_task_func: Callable[..., None],
    append_task_log_func: Callable[..., None],
    extract_json_result_func: Callable[[str], Optional[dict[str, object]]],
    find_record_for_output_func: Callable[[dict[str, object]], Optional[Any]],
    format_task_command: Callable[[list[str]], str],
    server_instance_id: str,
    workbench_root: Path,
) -> None:
    try:
        settings = load_settings()
        command, env, mineru_log = build_task_command_func(file_path, settings)
        update_task_func(
            task_id,
            status="running",
            stage="准备执行",
            progress=5,
            ownerId=server_instance_id,
        )
        append_task_log_func(task_id, f"$ {format_task_command(command)}", stage="准备执行", progress=5)
        process = subprocess.Popen(
            command,
            cwd=str(workbench_root),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        update_task_func(task_id, workerPid=process.pid)
        output_lines: list[str] = []
        stdout_queue: queue.Queue[str | None] = queue.Queue()

        def _reader() -> None:
            assert process.stdout is not None
            for raw_line in process.stdout:
                stdout_queue.put(raw_line)
            stdout_queue.put(None)

        threading.Thread(target=_reader, daemon=True).start()

        log_offset = 0
        stdout_done = False
        while True:
            drained = False
            while True:
                try:
                    item = stdout_queue.get_nowait()
                except queue.Empty:
                    break
                drained = True
                if item is None:
                    stdout_done = True
                    break
                output_lines.append(item)
                stage, progress = detect_stdout_stage(item)
                append_task_log_func(task_id, item, stage=stage, progress=progress)

            if mineru_log.exists():
                try:
                    with mineru_log.open("r", encoding="utf-8", errors="replace") as fh:
                        fh.seek(log_offset)
                        for line in fh.readlines():
                            append_task_log_func(task_id, line, stage="PDF解析", progress=38)
                        log_offset = fh.tell()
                except OSError:
                    pass

            if process.poll() is not None and stdout_done and not drained:
                break
            time.sleep(0.25)

        return_code = process.wait()
        full_output = "".join(output_lines)
        payload = extract_json_result_func(full_output)
        if return_code != 0:
            message = "解析任务失败"
            error_lines = [line for line in reversed(output_lines) if line.strip()]
            if error_lines:
                message = error_lines[0].strip()
            update_task_func(
                task_id,
                status="failed",
                stage="执行失败",
                progress=100,
                error=message,
                workerPid=None,
            )
            return

        result = {"paperId": None, "paperTitle": None, "output": payload}
        if payload:
            record = find_record_for_output_func(payload)
            if record:
                result["paperId"] = record.paper_id
                result["paperTitle"] = record.title
        update_task_func(
            task_id,
            status="succeeded",
            stage="处理完成",
            progress=100,
            result=result,
            error=None,
            workerPid=None,
        )
        append_task_log_func(task_id, "任务完成", stage="处理完成", progress=100)
    except Exception as error:
        update_task_func(
            task_id,
            status="failed",
            stage="执行失败",
            progress=100,
            error=str(error),
            workerPid=None,
        )
        append_task_log_func(task_id, f"ERROR: {error}", stage="执行失败", progress=100)


def create_upload_task(
    file_name: str,
    content: bytes,
    *,
    uploads_dir: Path,
    store: Any,
    current_timestamp_iso: Callable[[], str],
    server_instance_id: str,
    sanitize_filename: Callable[[str], str],
    run_upload_task_func: Callable[[str, Path], None],
) -> dict[str, object]:
    if not content:
        raise ValueError("上传内容为空")
    safe_name = sanitize_filename(file_name)
    task_id = f"task-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    staged_path = uploads_dir / f"{task_id}-{safe_name}"
    staged_path.parent.mkdir(parents=True, exist_ok=True)
    staged_path.write_bytes(content)
    task = {
        "id": task_id,
        "fileName": safe_name,
        "status": "queued",
        "stage": "等待执行",
        "progress": 0,
        "createdAt": current_timestamp_iso(),
        "updatedAt": current_timestamp_iso(),
        "error": None,
        "logs": [f"已接收文件: {safe_name}"],
        "result": None,
    }
    store.create_task(task, str(staged_path), server_instance_id)
    threading.Thread(target=run_upload_task_func, args=(task_id, staged_path), daemon=True).start()
    return snapshot_task(store, task_id) or task


def create_upload_task_from_path(
    file_path: Path,
    *,
    uploads_dir: Path,
    store: Any,
    current_timestamp_iso: Callable[[], str],
    server_instance_id: str,
    sanitize_filename: Callable[[str], str],
    run_upload_task_func: Callable[[str, Path], None],
    file_name: str | None = None,
) -> dict[str, object]:
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError("待导入的 PDF 文件不存在")
    if file_path.suffix.lower() != ".pdf":
        raise ValueError("只能导入 PDF 文件")
    safe_name = sanitize_filename(file_name or file_path.name)
    if not safe_name.lower().endswith(".pdf"):
        safe_name = f"{safe_name}.pdf"
    task_id = f"task-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    staged_path = uploads_dir / f"{task_id}-{safe_name}"
    staged_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file_path, staged_path)
    task = {
        "id": task_id,
        "fileName": safe_name,
        "status": "queued",
        "stage": "等待执行",
        "progress": 0,
        "createdAt": current_timestamp_iso(),
        "updatedAt": current_timestamp_iso(),
        "error": None,
        "logs": [f"已从 Zotero 导入：{safe_name}"],
        "result": None,
    }
    store.create_task(task, str(staged_path), server_instance_id)
    threading.Thread(target=run_upload_task_func, args=(task_id, staged_path), daemon=True).start()
    return snapshot_task(store, task_id) or task


def retry_upload_task(
    task_id: str,
    *,
    store: Any,
    server_instance_id: str,
    current_timestamp_iso: Callable[[], str],
    is_process_alive: Callable[[int], bool],
    run_upload_task_func: Callable[[str, Path], None],
) -> dict[str, object]:
    source_path = store.get_task_source_path(task_id)
    if not source_path:
        raise FileNotFoundError("原始上传文件不存在，请重新上传 PDF")
    staged_path = Path(source_path)
    if not staged_path.exists():
        raise FileNotFoundError("原始上传文件已被移除，请重新上传 PDF")
    runtime = store.get_task_runtime(task_id)
    worker_pid = runtime.get("workerPid") if runtime else None
    if isinstance(worker_pid, int) and is_process_alive(worker_pid):
        raise ValueError("上一次处理进程仍在运行，暂时不能重复启动")
    store.reset_task_for_retry(task_id, server_instance_id, current_timestamp_iso())
    threading.Thread(target=run_upload_task_func, args=(task_id, staged_path), daemon=True).start()
    task = snapshot_task(store, task_id)
    if not task:
        raise FileNotFoundError("未找到指定任务")
    return task

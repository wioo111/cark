import argparse
import base64
import importlib.util
import json
import mimetypes
import os
import queue
import re
import requests
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, unquote, urlparse

from gui_storage import SingleInstanceLock, WorkbenchStore, format_task_command
from process_utils import is_process_alive


WORKBENCH_ROOT = Path(__file__).resolve().parents[1]
GUI_DIST_DIR = WORKBENCH_ROOT / "gui" / "dist"
CONFIG_DIR = WORKBENCH_ROOT / "config"
RUNTIME_OUTPUT_DIR = WORKBENCH_ROOT / "runtime" / "output"
MEMORY_ROOT_DIR = WORKBENCH_ROOT / "runtime" / "memory"
DATABASE_PATH = WORKBENCH_ROOT / "runtime" / "cark.sqlite3"
INSTANCE_LOCK_PATH = WORKBENCH_ROOT / "runtime" / "locks" / "gui_server.lock"
GUI_SETTINGS_PATH = CONFIG_DIR / "gui_settings.json"
GUI_UPLOADS_DIR = WORKBENCH_ROOT / "runtime" / "uploads" / "gui"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
UUID_DIR_RE = re.compile(r"^[0-9a-fA-F-]{32,36}$")
PROXY_ENV_KEYS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
)
STORE = WorkbenchStore(DATABASE_PATH)
SERVER_INSTANCE_ID = f"{os.getpid()}-{uuid.uuid4().hex}"


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


def normalize_text_value(value) -> str:
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


def normalize_string_list(value, *, limit: int = 8) -> list[str]:
    items: list[str] = []
    if isinstance(value, list):
        for item in value:
            text = normalize_text_value(item)
            if text and text not in items:
                items.append(text)
            if len(items) >= limit:
                break
    return items


def write_json_file(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_json_object(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
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


def build_direct_network_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in PROXY_ENV_KEYS:
        env.pop(key, None)
    env["NO_PROXY"] = "*"
    env["no_proxy"] = "*"
    return env


def default_gui_settings() -> dict[str, object]:
    pipeline = load_first_json_object(
        [
            CONFIG_DIR / "pdf_docx_pipeline.json",
            CONFIG_DIR / "pdf_docx_pipeline.example.json",
        ]
    )
    return {
        "mineru": {
            "backend": str(pipeline.get("backend") or "local"),
            "modelVersion": str(pipeline.get("model_version") or "pipeline"),
            "parseMethod": str(pipeline.get("parse_method") or "auto"),
            "apiToken": str(os.getenv("MINERU_API_TOKEN") or pipeline.get("api_token") or ""),
            "reuseExistingParse": bool(pipeline.get("reuse_existing_parse", True)),
        },
        "translation": {
            "enabled": bool(pipeline.get("translate", False)),
            "apiKey": str(os.getenv("OPENAI_API_KEY") or ""),
            "baseUrl": str(os.getenv("OPENAI_BASE_URL") or "https://api.deepseek.com/v1"),
            "model": str(os.getenv("OPENAI_MODEL") or "deepseek-chat"),
            "failRatioLimit": float(os.getenv("TRANSLATE_FAIL_RATIO_LIMIT") or 0.2),
        },
        "publish": {
            "prepareOnly": bool(pipeline.get("prepare_only", True)),
            "imageMode": str(pipeline.get("image_mode") or "note"),
            "folderToken": str(os.getenv("FEISHU_FOLDER_TOKEN") or pipeline.get("folder_token") or ""),
            "appId": str(os.getenv("FEISHU_APP_ID") or pipeline.get("app_id") or ""),
            "appSecret": str(os.getenv("FEISHU_APP_SECRET") or pipeline.get("app_secret") or ""),
        },
        "copilot": {
            "apiKey": str(os.getenv("OPENROUTER_API_KEY") or ""),
            "baseUrl": str(os.getenv("OPENROUTER_BASE_URL") or ""),
            "model": str(os.getenv("OPENROUTER_MODEL") or ""),
        },
    }


def materialize_gui_settings() -> dict[str, object]:
    defaults = sanitize_gui_settings(default_gui_settings())
    existing = load_json_object(GUI_SETTINGS_PATH)
    if existing:
        merged = sanitize_gui_settings(
            {
                "mineru": {
                    **defaults["mineru"],
                    **(existing.get("mineru") if isinstance(existing.get("mineru"), dict) else {}),
                },
                "translation": {
                    **defaults["translation"],
                    **(existing.get("translation") if isinstance(existing.get("translation"), dict) else {}),
                },
                "publish": {
                    **defaults["publish"],
                    **(existing.get("publish") if isinstance(existing.get("publish"), dict) else {}),
                },
                "copilot": {
                    **defaults["copilot"],
                    **(existing.get("copilot") if isinstance(existing.get("copilot"), dict) else {}),
                },
            }
        )
    else:
        merged = defaults
    if not GUI_SETTINGS_PATH.exists() or load_json_object(GUI_SETTINGS_PATH) != merged:
        write_json_file(GUI_SETTINGS_PATH, merged)
    return merged


def sanitize_gui_settings(payload: dict[str, object]) -> dict[str, object]:
    defaults = default_gui_settings()
    mineru = payload.get("mineru") if isinstance(payload.get("mineru"), dict) else {}
    translation = payload.get("translation") if isinstance(payload.get("translation"), dict) else {}
    publish = payload.get("publish") if isinstance(payload.get("publish"), dict) else {}
    copilot = payload.get("copilot") if isinstance(payload.get("copilot"), dict) else {}

    backend = mineru.get("backend") if mineru.get("backend") in {"local", "cloud"} else defaults["mineru"]["backend"]
    model_version = (
        mineru.get("modelVersion")
        if mineru.get("modelVersion") in {"pipeline", "vlm"}
        else defaults["mineru"]["modelVersion"]
    )
    parse_method = (
        mineru.get("parseMethod")
        if mineru.get("parseMethod") in {"auto", "txt", "ocr"}
        else defaults["mineru"]["parseMethod"]
    )
    image_mode = (
        publish.get("imageMode")
        if publish.get("imageMode") in {"strip", "note", "keep"}
        else defaults["publish"]["imageMode"]
    )
    try:
        fail_ratio_limit = float(translation.get("failRatioLimit"))
    except (TypeError, ValueError):
        fail_ratio_limit = float(defaults["translation"]["failRatioLimit"])

    return {
        "mineru": {
            "backend": backend,
            "modelVersion": model_version,
            "parseMethod": parse_method,
            "apiToken": str(mineru.get("apiToken") or "").strip(),
            "reuseExistingParse": bool(mineru.get("reuseExistingParse", defaults["mineru"]["reuseExistingParse"])),
        },
        "translation": {
            "enabled": bool(translation.get("enabled", defaults["translation"]["enabled"])),
            "apiKey": str(translation.get("apiKey") or "").strip(),
            "baseUrl": str(translation.get("baseUrl") or defaults["translation"]["baseUrl"]).strip(),
            "model": str(translation.get("model") or defaults["translation"]["model"]).strip(),
            "failRatioLimit": min(max(fail_ratio_limit, 0.0), 1.0),
        },
        "publish": {
            "prepareOnly": bool(publish.get("prepareOnly", defaults["publish"]["prepareOnly"])),
            "imageMode": image_mode,
            "folderToken": str(publish.get("folderToken") or "").strip(),
            "appId": str(publish.get("appId") or "").strip(),
            "appSecret": str(publish.get("appSecret") or "").strip(),
        },
        "copilot": {
            "apiKey": str(copilot.get("apiKey") or "").strip(),
            "baseUrl": str(copilot.get("baseUrl") or "").strip(),
            "model": str(copilot.get("model") or "").strip(),
        },
    }


def load_gui_settings() -> dict[str, object]:
    defaults = materialize_gui_settings()
    saved = load_json_object(GUI_SETTINGS_PATH)
    merged = {
        "mineru": {
            **defaults["mineru"],
            **(saved.get("mineru") if isinstance(saved.get("mineru"), dict) else {}),
        },
        "translation": {
            **defaults["translation"],
            **(saved.get("translation") if isinstance(saved.get("translation"), dict) else {}),
        },
        "publish": {
            **defaults["publish"],
            **(saved.get("publish") if isinstance(saved.get("publish"), dict) else {}),
        },
        "copilot": {
            **defaults["copilot"],
            **(saved.get("copilot") if isinstance(saved.get("copilot"), dict) else {}),
        },
    }
    return sanitize_gui_settings(merged)


def save_gui_settings(payload: dict[str, object]) -> dict[str, object]:
    settings = sanitize_gui_settings(payload)
    write_json_file(GUI_SETTINGS_PATH, settings)
    return settings


def detect_capabilities(settings: Optional[dict[str, object]] = None) -> dict[str, object]:
    current = settings if settings is not None else load_gui_settings()
    mineru = current.get("mineru") if isinstance(current.get("mineru"), dict) else {}
    translation = current.get("translation") if isinstance(current.get("translation"), dict) else {}
    publish = current.get("publish") if isinstance(current.get("publish"), dict) else {}
    local_candidates = [
        WORKBENCH_ROOT / ".venv" / "Scripts" / "mineru.exe",
        WORKBENCH_ROOT / ".venv" / "bin" / "mineru",
    ]
    local_available = any(path.exists() for path in local_candidates)
    if not local_available:
        local_available = bool(shutil.which("mineru")) or importlib.util.find_spec("mineru") is not None
    cloud_configured = bool(str(mineru.get("apiToken") or "").strip())
    translation_configured = bool(str(translation.get("apiKey") or "").strip())

    issues: list[dict[str, str]] = []
    backend = str(mineru.get("backend") or "local")
    if backend == "local" and not local_available:
        issues.append(
            {
                "code": "local-parser-missing",
                "message": "这台电脑还不能本地解析 PDF。",
                "action": "切换到云端解析，或重新运行安装脚本补齐本地解析能力。",
            }
        )
    if backend == "cloud" and not cloud_configured:
        issues.append(
            {
                "code": "cloud-token-missing",
                "message": "云端解析缺少访问凭据。",
                "action": "在常用设置中填写云端解析 Token。",
            }
        )
    if bool(translation.get("enabled")) and not translation_configured:
        issues.append(
            {
                "code": "translation-key-missing",
                "message": "双语翻译已开启，但缺少翻译凭据。",
                "action": "填写翻译 API Key，或关闭双语翻译。",
            }
        )
    if not bool(publish.get("prepareOnly", True)):
        missing_publish = [
            label
            for key, label in (
                ("folderToken", "目标文件夹"),
                ("appId", "App ID"),
                ("appSecret", "App Secret"),
            )
            if not str(publish.get(key) or "").strip()
        ]
        if missing_publish:
            issues.append(
                {
                    "code": "publish-credentials-missing",
                    "message": "协作平台导出已开启，但配置不完整。",
                    "action": "在高级设置中补齐：" + "、".join(missing_publish) + "。",
                }
            )

    return {
        "ready": not issues,
        "issues": issues,
        "localParser": {
            "available": local_available,
            "message": "可在这台电脑上解析" if local_available else "未检测到本地解析能力",
        },
        "cloudParser": {
            "configured": cloud_configured,
            "message": "云端凭据已配置" if cloud_configured else "云端凭据未配置",
        },
        "translation": {
            "configured": translation_configured,
            "message": "翻译凭据已配置" if translation_configured else "翻译凭据未配置",
        },
    }


def ensure_upload_ready(settings: Optional[dict[str, object]] = None):
    capabilities = detect_capabilities(settings)
    issues = capabilities.get("issues")
    if isinstance(issues, list) and issues:
        messages = [
            f"{issue.get('message', '')} {issue.get('action', '')}".strip()
            for issue in issues
            if isinstance(issue, dict)
        ]
        raise ValueError("当前环境还不能上传：" + " ".join(messages))


def test_mineru_connection(settings: dict[str, object]) -> dict[str, object]:
    mineru = settings.get("mineru") if isinstance(settings.get("mineru"), dict) else {}
    token = str(mineru.get("apiToken") or "").strip()
    if not token:
        raise ValueError("请先填写 MinerU API Token")

    model_version = str(mineru.get("modelVersion") or "pipeline")
    parse_method = str(mineru.get("parseMethod") or "auto")
    try:
        from mineru_cloud import _apply_upload_url
    except Exception as error:
        raise RuntimeError(f"无法加载 MinerU 云测试模块: {error}") from error

    pseudo_pdf = Path("connection-test.pdf")
    batch_id, _upload_url = _apply_upload_url(
        pseudo_pdf,
        token,
        model_version=model_version,
        is_ocr=(parse_method == "ocr"),
        enable_formula=True,
        enable_table=True,
        language="en",
    )
    return {
        "ok": True,
        "message": "MinerU 云 token 可用",
        "detail": f"已成功申请上传地址，batch_id={batch_id}",
    }


def test_translation_connection(settings: dict[str, object]) -> dict[str, object]:
    translation = settings.get("translation") if isinstance(settings.get("translation"), dict) else {}
    api_key = str(translation.get("apiKey") or "").strip()
    base_url = str(translation.get("baseUrl") or "https://api.deepseek.com/v1").strip()
    model = str(translation.get("model") or "deepseek-chat").strip()
    if not api_key:
        raise ValueError("请先填写翻译 API Key")
    if not base_url:
        raise ValueError("请先填写翻译 Base URL")
    if not model:
        raise ValueError("请先填写翻译模型")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a connectivity test assistant."},
            {"role": "user", "content": "Reply with exactly: ok"},
        ],
        "temperature": 0,
        "max_tokens": 8,
    }
    response = requests.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    result = response.json()
    content = (
        result.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    preview = str(content).strip()[:120]
    return {
        "ok": True,
        "message": "翻译模型可用",
        "detail": f"模型返回: {preview or 'ok'}",
    }


def run_connection_test(target: str, settings_payload: dict[str, object]) -> dict[str, object]:
    settings = sanitize_gui_settings(settings_payload)
    try:
        if target == "mineru":
            return test_mineru_connection(settings)
        if target == "translation":
            return test_translation_connection(settings)
        raise ValueError("未知测试目标")
    except Exception as error:
        return {
            "ok": False,
            "message": str(error),
            "detail": None,
        }


def snapshot_task(task_id: str) -> dict[str, object] | None:
    return STORE.get_task(task_id)


def list_tasks_payload() -> list[dict[str, object]]:
    return STORE.list_tasks()


def update_task(task_id: str, **changes):
    STORE.update_task(task_id, current_timestamp_iso(), **changes)


def append_task_log(task_id: str, line: str, *, stage: Optional[str] = None, progress: Optional[int] = None):
    cleaned = line.rstrip()
    if not cleaned:
        return
    STORE.append_task_log(
        task_id,
        cleaned,
        current_timestamp_iso(),
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


def find_record_for_output(payload: dict[str, object]) -> Optional[PaperRecord]:
    linearized_path = payload.get("linearized_markdown")
    content_list_path = payload.get("content_list_json")
    linearized_target = Path(linearized_path).resolve() if isinstance(linearized_path, str) else None
    content_list_target = Path(content_list_path).resolve() if isinstance(content_list_path, str) else None

    for record in indexed_records(refresh=True).values():
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


def build_task_command(file_path: Path, settings: dict[str, object]) -> tuple[list[str], dict[str, str], Path]:
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

    script_path = WORKBENCH_ROOT / "scripts" / "pdf_to_feishu_docx.py"
    command = [
        sys.executable,
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
    env["TRANSLATE_FAIL_RATIO_LIMIT"] = str(
        0.2 if fail_ratio_limit is None else fail_ratio_limit
    )

    safe_stem = sanitize_ascii_stem(file_path.stem)
    mineru_log = WORKBENCH_ROOT / "runtime" / "logs" / f"mineru_{safe_stem}.log"
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


def run_upload_task(task_id: str, file_path: Path):
    try:
        settings = load_gui_settings()
        command, env, mineru_log = build_task_command(file_path, settings)
        update_task(
            task_id,
            status="running",
            stage="准备执行",
            progress=5,
            ownerId=SERVER_INSTANCE_ID,
        )
        append_task_log(task_id, f"$ {format_task_command(command)}", stage="准备执行", progress=5)
        process = subprocess.Popen(
            command,
            cwd=str(WORKBENCH_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        update_task(task_id, workerPid=process.pid)
        output_lines: list[str] = []
        stdout_queue: queue.Queue[str | None] = queue.Queue()

        def _reader():
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
                append_task_log(task_id, item, stage=stage, progress=progress)

            if mineru_log.exists():
                try:
                    with mineru_log.open("r", encoding="utf-8", errors="replace") as fh:
                        fh.seek(log_offset)
                        for line in fh.readlines():
                            append_task_log(task_id, line, stage="PDF解析", progress=38)
                        log_offset = fh.tell()
                except OSError:
                    pass

            if process.poll() is not None and stdout_done and not drained:
                break
            time.sleep(0.25)

        return_code = process.wait()
        full_output = "".join(output_lines)
        payload = extract_json_result(full_output)
        if return_code != 0:
            message = "解析任务失败"
            error_lines = [line for line in reversed(output_lines) if line.strip()]
            if error_lines:
                message = error_lines[0].strip()
            update_task(
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
            record = find_record_for_output(payload)
            if record:
                result["paperId"] = record.paper_id
                result["paperTitle"] = record.title
        update_task(
            task_id,
            status="succeeded",
            stage="处理完成",
            progress=100,
            result=result,
            error=None,
            workerPid=None,
        )
        append_task_log(task_id, "任务完成", stage="处理完成", progress=100)
    except Exception as error:
        update_task(
            task_id,
            status="failed",
            stage="执行失败",
            progress=100,
            error=str(error),
            workerPid=None,
        )
        append_task_log(task_id, f"ERROR: {error}", stage="执行失败", progress=100)


def create_upload_task(file_name: str, content: bytes) -> dict[str, object]:
    if not content:
        raise ValueError("上传内容为空")
    safe_name = sanitize_filename(file_name)
    task_id = f"task-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    staged_path = GUI_UPLOADS_DIR / f"{task_id}-{safe_name}"
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
    STORE.create_task(task, str(staged_path), SERVER_INSTANCE_ID)
    threading.Thread(target=run_upload_task, args=(task_id, staged_path), daemon=True).start()
    return snapshot_task(task_id) or task


def retry_upload_task(task_id: str) -> dict[str, object]:
    source_path = STORE.get_task_source_path(task_id)
    if not source_path:
        raise FileNotFoundError("原始上传文件不存在，请重新上传 PDF")
    staged_path = Path(source_path)
    if not staged_path.exists():
        raise FileNotFoundError("原始上传文件已被移除，请重新上传 PDF")
    runtime = STORE.get_task_runtime(task_id)
    worker_pid = runtime.get("workerPid") if runtime else None
    if isinstance(worker_pid, int) and is_process_alive(worker_pid):
        raise ValueError("上一次处理进程仍在运行，暂时不能重复启动")
    STORE.reset_task_for_retry(task_id, SERVER_INSTANCE_ID, current_timestamp_iso())
    threading.Thread(target=run_upload_task, args=(task_id, staged_path), daemon=True).start()
    task = snapshot_task(task_id)
    if not task:
        raise FileNotFoundError("未找到指定任务")
    return task


def strip_known_suffix(name: str) -> str:
    suffixes = [
        "_linearized_bilingual",
        "_linearized",
        "_bilingual",
        "_feishu_docx_ready",
        "_feishu_ready",
    ]
    current = name
    changed = True
    while changed:
        changed = False
        for suffix in suffixes:
            if current.endswith(suffix):
                current = current[: -len(suffix)]
                changed = True
    return current


def find_primary_file(auto_dir: Path, title: str, suffixes: list[str]) -> Optional[Path]:
    for suffix in suffixes:
        candidate = auto_dir / f"{title}{suffix}"
        if candidate.exists():
            return candidate

    for suffix in suffixes:
        matches = sorted(auto_dir.glob(f"*{suffix}"), key=lambda item: item.stat().st_mtime, reverse=True)
        if matches:
            return matches[0]
    return None


def detect_source_pdf(root_dir: Path, auto_dir: Path) -> Optional[str]:
    candidates: list[Path] = []
    candidates.extend(sorted((root_dir / "uploads").glob("*.pdf")))
    if root_dir.parent != RUNTIME_OUTPUT_DIR:
        candidates.extend(sorted((root_dir.parent / "uploads").glob("*.pdf")))
    candidates.extend(sorted(auto_dir.glob("*_origin.pdf")))
    candidates.extend(sorted(auto_dir.glob("*.pdf")))
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def detect_content_list(auto_dir: Path) -> Optional[Path]:
    matches = sorted(auto_dir.glob("*_content_list.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    return matches[0] if matches else None


def discover_records() -> dict[str, PaperRecord]:
    records: dict[str, PaperRecord] = {}
    for linearized_path in RUNTIME_OUTPUT_DIR.glob("**/*_linearized.md"):
        auto_dir = linearized_path.parent
        if auto_dir.name != "auto":
            continue

        title = strip_known_suffix(linearized_path.stem)
        root_dir = auto_dir.parent
        task_id: Optional[str] = None
        if root_dir.parent.parent == RUNTIME_OUTPUT_DIR and UUID_DIR_RE.match(root_dir.parent.name):
            task_id = root_dir.parent.name

        paper_id = encode_paper_id(task_id, title)
        content_list = detect_content_list(auto_dir)
        bilingual = find_primary_file(auto_dir, title, ["_linearized_bilingual.md", "_bilingual.md"])
        feishu_ready = find_primary_file(
            auto_dir,
            title,
            ["_linearized_feishu_docx_ready.md", "_feishu_docx_ready.md", "_linearized_feishu_ready.md", "_feishu_ready.md"],
        )
        files = {
            "linearized": linearized_path,
            "bilingual": bilingual,
            "feishuReady": feishu_ready,
            "contentListJson": content_list,
        }
        available_views = ["linearized"]
        if bilingual and bilingual.exists():
            available_views.append("bilingual")

        updated_at = max(path.stat().st_mtime for path in files.values() if path and path.exists())
        record = PaperRecord(
            paper_id=paper_id,
            title=title,
            task_id=task_id,
            root_dir=root_dir,
            auto_dir=auto_dir,
            updated_at=updated_at,
            available_views=available_views,
            source_pdf=detect_source_pdf(root_dir, auto_dir),
            files=files,
        )

        existing = records.get(paper_id)
        if existing is None or existing.updated_at < record.updated_at:
            records[paper_id] = record
    return records


def serialize_paper_record(record: PaperRecord) -> dict[str, object]:
    return {
        "id": record.paper_id,
        "title": record.title,
        "taskId": record.task_id,
        "rootDir": str(record.root_dir),
        "autoDir": str(record.auto_dir),
        "updatedAt": record.updated_at,
        "availableViews": record.available_views,
        "sourcePdf": record.source_pdf,
        "files": {
            key: str(value) if value else None
            for key, value in record.files.items()
        },
    }


def deserialize_paper_record(payload: dict[str, object]) -> Optional[PaperRecord]:
    files_payload = payload.get("files")
    if not isinstance(files_payload, dict):
        return None
    linearized_value = files_payload.get("linearized")
    if not isinstance(linearized_value, str) or not Path(linearized_value).exists():
        return None
    available_views = payload.get("availableViews")
    if not isinstance(available_views, list):
        available_views = ["linearized"]
    return PaperRecord(
        paper_id=str(payload["id"]),
        title=str(payload["title"]),
        task_id=str(payload["taskId"]) if payload.get("taskId") else None,
        root_dir=Path(str(payload["rootDir"])),
        auto_dir=Path(str(payload["autoDir"])),
        updated_at=float(payload["updatedAt"]),
        available_views=[str(item) for item in available_views],
        source_pdf=str(payload["sourcePdf"]) if payload.get("sourcePdf") else None,
        files={
            key: Path(str(value)) if value else None
            for key, value in files_payload.items()
        },
    )


def sync_paper_index(store: WorkbenchStore = STORE):
    discovered = discover_records()
    store.sync_papers(
        [serialize_paper_record(record) for record in discovered.values()],
        current_timestamp_iso(),
    )


def indexed_records(*, refresh: bool = False) -> dict[str, PaperRecord]:
    if refresh:
        sync_paper_index()
    records: dict[str, PaperRecord] = {}
    for payload in STORE.list_papers():
        record = deserialize_paper_record(payload)
        if record:
            records[record.paper_id] = record
    return records


def get_record(paper_id: str) -> PaperRecord:
    records = indexed_records()
    normalized = unquote(paper_id).strip().rstrip("/")
    direct = records.get(normalized)
    if direct:
        return direct

    task_part, title_part = decode_paper_id(normalized)
    if title_part:
        for record in records.values():
            if record.title != title_part:
                continue
            if record.task_id == task_part:
                return record
            if record.task_id is None and task_part == title_part:
                return record

    records = indexed_records(refresh=True)
    direct = records.get(normalized)
    if direct:
        return direct
    if title_part:
        for record in records.values():
            if record.title == title_part and (
                record.task_id == task_part
                or (record.task_id is None and task_part == title_part)
            ):
                return record

    raise FileNotFoundError("未找到指定论文")


def list_papers() -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for record in sorted(indexed_records(refresh=True).values(), key=lambda item: item.updated_at, reverse=True):
        has_images = (record.auto_dir / "images").exists()
        items.append(
            {
                "id": record.paper_id,
                "title": record.title,
                "taskId": record.task_id,
                "updatedAt": datetime.fromtimestamp(record.updated_at).isoformat(),
                "availableViews": record.available_views,
                "hasImages": has_images,
                "sourcePdf": record.source_pdf,
            }
        )
    return items


def load_markdown(path: Optional[Path]) -> Optional[str]:
    if not path or not path.exists():
        return None
    return path.read_text(encoding="utf-8", errors="ignore")


def ensure_within_root(record: PaperRecord, relative_path: str) -> Path:
    target = (record.root_dir / relative_path).resolve()
    root = record.root_dir.resolve()
    if os.path.commonpath([str(root), str(target)]) != str(root):
        raise PermissionError("非法路径")
    return target


def build_images(record: PaperRecord) -> list[dict[str, str]]:
    images_dir = record.auto_dir / "images"
    items: list[dict[str, str]] = []
    if not images_dir.exists():
        return items

    for path in sorted(images_dir.glob("**/*"), key=lambda item: item.name.lower()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        relative = path.relative_to(record.root_dir).as_posix()
        items.append(
            {
                "name": path.name,
                "url": f"/api/media/{record.paper_id}?path={relative}",
                "filePath": str(path),
            }
        )
    return items


def load_blocks(record: PaperRecord) -> list[dict[str, object]]:
    content_list_path = record.files.get("contentListJson")
    if not content_list_path or not content_list_path.exists():
        return []

    try:
        payload = json.loads(content_list_path.read_text(encoding="utf-8"))
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    blocks: list[dict[str, object]] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            continue

        block_type = str(item.get("type") or "unknown")
        text_value = normalize_text_value(item.get("text"))
        captions = normalize_string_list(item.get("img_caption"), limit=4)
        footnotes = normalize_string_list(item.get("img_footnote"), limit=4)
        image_path = item.get("img_path") if isinstance(item.get("img_path"), str) else None
        preview = next(
            (
                value
                for value in [
                    text_value,
                    captions[0] if captions else "",
                    footnotes[0] if footnotes else "",
                    image_path or "",
                    block_type,
                ]
                if value
            ),
            block_type,
        )[:220]
        match_text = (text_value or preview)[:400]
        image_url = None
        if image_path:
            cleaned = image_path.lstrip("./")
            relative = f"auto/{cleaned}" if not cleaned.startswith("auto/") else cleaned
            image_url = f"/api/media/{record.paper_id}?path={relative}"

        blocks.append(
            {
                "id": f"block-{index}",
                "index": index,
                "type": block_type,
                "pageIdx": item.get("page_idx") if isinstance(item.get("page_idx"), int) else None,
                "textLevel": item.get("text_level") if isinstance(item.get("text_level"), int) else None,
                "preview": preview,
                "matchText": match_text or None,
                "imagePath": image_path,
                "imageUrl": image_url,
                "imageCaption": captions,
                "imageFootnote": footnotes,
                "bbox": item.get("bbox") if isinstance(item.get("bbox"), list) else None,
            }
        )
    return blocks


def build_stats(blocks: list[dict[str, object]]) -> dict[str, int]:
    heading_count = 0
    image_count = 0
    table_count = 0
    formula_count = 0
    paragraph_count = 0
    for block in blocks:
        block_type = str(block.get("type") or "")
        if "image" in block_type:
            image_count += 1
        elif "table" in block_type:
            table_count += 1
        elif "equation" in block_type or "formula" in block_type:
            formula_count += 1
        elif "title" in block_type or block.get("textLevel"):
            heading_count += 1
        else:
            paragraph_count += 1
    return {
        "headingCount": heading_count,
        "imageCount": image_count,
        "tableCount": table_count,
        "formulaCount": formula_count,
        "paragraphCount": paragraph_count,
        "blockCount": len(blocks),
    }


def build_detail(record: PaperRecord) -> dict[str, object]:
    blocks = load_blocks(record)
    return {
        "id": record.paper_id,
        "title": record.title,
        "taskId": record.task_id,
        "updatedAt": datetime.fromtimestamp(record.updated_at).isoformat(),
        "availableViews": record.available_views,
        "hasImages": bool((record.auto_dir / "images").exists()),
        "sourcePdf": record.source_pdf,
        "rootDir": str(record.root_dir),
        "files": {
            "contentListJson": str(record.files["contentListJson"]) if record.files.get("contentListJson") else None,
            "linearized": str(record.files["linearized"]) if record.files.get("linearized") else None,
            "bilingual": str(record.files["bilingual"]) if record.files.get("bilingual") else None,
            "feishuReady": str(record.files["feishuReady"]) if record.files.get("feishuReady") else None,
        },
        "markdown": {
            "linearized": load_markdown(record.files.get("linearized")),
            "bilingual": load_markdown(record.files.get("bilingual")),
        },
        "images": build_images(record),
        "stats": build_stats(blocks),
        "blocks": blocks,
    }


def paper_memory_dir(record: PaperRecord) -> Path:
    return MEMORY_ROOT_DIR / "papers" / record.paper_id


def paper_profile_path(record: PaperRecord) -> Path:
    return paper_memory_dir(record) / "paper_profile.json"


def paper_notes_dir(record: PaperRecord) -> Path:
    return paper_memory_dir(record) / "notes"


def paper_annotations_dir(record: PaperRecord) -> Path:
    return paper_memory_dir(record) / "annotations"


def default_memory_profile(record: PaperRecord) -> dict[str, object]:
    return {
        "paperId": record.paper_id,
        "title": record.title,
        "summary": "这是一张待沉淀的论文记忆卡。先记录你的判断，再逐步提纯成可复用的稳定观点。",
        "anchors": [],
        "openQuestions": [
            "这篇论文最值得保留的核心方法是什么？",
            "它和你现有知识库或项目的连接点是什么？",
        ],
        "recommendedActions": [
            "从当前段落记录一个关键判断",
            "把一个尚未想通的问题单独记下",
            "标注一个可迁移的方法或概念",
        ],
    }


def ensure_paper_memory(record: PaperRecord):
    paper_memory_dir(record).mkdir(parents=True, exist_ok=True)
    paper_notes_dir(record).mkdir(parents=True, exist_ok=True)
    paper_annotations_dir(record).mkdir(parents=True, exist_ok=True)
    if not paper_profile_path(record).exists():
        write_json_file(paper_profile_path(record), default_memory_profile(record))


def load_memory_profile(record: PaperRecord) -> dict[str, object]:
    ensure_paper_memory(record)
    default_profile = default_memory_profile(record)
    try:
        payload = json.loads(paper_profile_path(record).read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    merged = {**default_profile, **payload}
    merged["paperId"] = record.paper_id
    merged["title"] = record.title
    return merged


def load_memory_notes(record: PaperRecord) -> list[dict[str, object]]:
    ensure_paper_memory(record)
    items: list[dict[str, object]] = []
    for path in sorted(paper_notes_dir(record).glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(payload, dict):
            items.append(payload)
    return items


def build_memory_payload(record: PaperRecord) -> dict[str, object]:
    profile = load_memory_profile(record)
    notes = load_memory_notes(record)
    last_updated = notes[0]["updatedAt"] if notes else datetime.fromtimestamp(record.updated_at).isoformat()
    return {
        "paperId": record.paper_id,
        "title": record.title,
        "summary": str(profile.get("summary") or default_memory_profile(record)["summary"]),
        "anchors": normalize_string_list(profile.get("anchors"), limit=4),
        "openQuestions": normalize_string_list(profile.get("openQuestions"), limit=5),
        "recommendedActions": normalize_string_list(profile.get("recommendedActions"), limit=5),
        "noteCount": len(notes),
        "lastUpdated": last_updated,
        "recentNotes": notes[:8],
    }


def create_memory_note(record: PaperRecord, payload: dict[str, object]):
    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("笔记内容不能为空")
    ensure_paper_memory(record)
    timestamp = current_timestamp_iso()
    note_id = f"note-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    note = {
        "id": note_id,
        "paperId": record.paper_id,
        "content": content.strip(),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "blockId": payload.get("blockId") if isinstance(payload.get("blockId"), str) else None,
        "blockPreview": payload.get("blockPreview") if isinstance(payload.get("blockPreview"), str) else None,
        "quote": payload.get("quote") if isinstance(payload.get("quote"), str) else None,
        "tags": normalize_string_list(payload.get("tags"), limit=6),
    }
    write_json_file(paper_notes_dir(record) / f"{note_id}.json", note)
    return note


def annotation_preview(content: str, *, limit: int = 72) -> str:
    cleaned = " ".join(content.split())
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[:limit].rstrip()}..."


def normalize_annotation_comment(payload: dict[str, object]) -> dict[str, object]:
    author_type = payload.get("authorType")
    if author_type != "user":
        raise ValueError("当前阶段只允许保存用户评论")
    author_label = payload.get("authorLabel")
    if not isinstance(author_label, str) or not author_label.strip():
        raise ValueError("评论作者名称不能为空")
    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("评论内容不能为空")
    if payload.get("status", "ready") != "ready":
        raise ValueError("当前阶段不允许保存占位评论")
    timestamp = current_timestamp_iso()
    return {
        "id": f"comment-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}",
        "authorType": author_type,
        "authorLabel": author_label.strip(),
        "content": content.strip(),
        "preview": annotation_preview(content.strip()),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "status": "ready",
    }


def load_paper_annotations(record: PaperRecord) -> list[dict[str, object]]:
    ensure_paper_memory(record)
    items: list[dict[str, object]] = []
    for path in sorted(paper_annotations_dir(record).glob("*.json"), key=lambda item: item.stat().st_mtime):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(payload, dict):
            items.append(payload)
    items.sort(key=lambda item: (float(item.get("anchorTop") or 0), str(item.get("createdAt") or "")))
    return items


def annotation_file_path(record: PaperRecord, annotation_id: str) -> Path:
    if re.fullmatch(r"annotation-[A-Za-z0-9_-]+", annotation_id) is None:
        raise FileNotFoundError("批注线程标识非法")
    return paper_annotations_dir(record) / f"{annotation_id}.json"


def load_annotation(record: PaperRecord, annotation_id: str) -> tuple[Path, dict[str, object]]:
    file_path = annotation_file_path(record, annotation_id)
    if not file_path.exists():
        raise FileNotFoundError("未找到指定批注线程")
    payload = json.loads(file_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise FileNotFoundError("批注线程损坏")
    return file_path, payload


def create_annotation(record: PaperRecord, payload: dict[str, object]):
    quote = payload.get("quote")
    view = payload.get("view")
    anchor_top = payload.get("anchorTop")
    anchor_height = payload.get("anchorHeight")
    initial_comment = payload.get("initialComment")
    if not isinstance(quote, str) or not quote.strip():
        raise ValueError("批注选区不能为空")
    if view not in {"linearized", "bilingual"}:
        raise ValueError("批注视图非法")
    if not isinstance(anchor_top, (int, float)) or not isinstance(anchor_height, (int, float)):
        raise ValueError("批注位置参数非法")
    if not isinstance(initial_comment, dict):
        raise ValueError("缺少初始评论")

    ensure_paper_memory(record)
    timestamp = current_timestamp_iso()
    annotation_id = f"annotation-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    annotation = {
        "id": annotation_id,
        "paperId": record.paper_id,
        "view": view,
        "quote": quote.strip()[:600],
        "contextBefore": payload.get("contextBefore") if isinstance(payload.get("contextBefore"), str) else None,
        "contextAfter": payload.get("contextAfter") if isinstance(payload.get("contextAfter"), str) else None,
        "anchorTop": max(float(anchor_top), 0.0),
        "anchorHeight": max(float(anchor_height), 24.0),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "archived": False,
        "archivedAt": None,
        "comments": [normalize_annotation_comment(initial_comment)],
    }
    write_json_file(annotation_file_path(record, annotation_id), annotation)
    return annotation


def append_annotation_comment(record: PaperRecord, annotation_id: str, payload: dict[str, object]):
    file_path, annotation = load_annotation(record, annotation_id)
    comments = annotation.get("comments")
    if not isinstance(comments, list):
        comments = []
    comments.append(normalize_annotation_comment(payload))
    annotation["comments"] = comments
    annotation["updatedAt"] = current_timestamp_iso()
    annotation["archived"] = False
    annotation["archivedAt"] = None
    write_json_file(file_path, annotation)


def update_annotation_comment(record: PaperRecord, annotation_id: str, comment_id: str, payload: dict[str, object]):
    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("评论内容不能为空")
    file_path, annotation = load_annotation(record, annotation_id)
    comments = annotation.get("comments")
    if not isinstance(comments, list):
        raise FileNotFoundError("批注线程损坏")
    found = False
    for comment in comments:
        if isinstance(comment, dict) and comment.get("id") == comment_id:
            comment["content"] = content.strip()
            comment["preview"] = annotation_preview(content.strip())
            comment["updatedAt"] = current_timestamp_iso()
            found = True
            break
    if not found:
        raise FileNotFoundError("未找到指定评论")
    annotation["updatedAt"] = current_timestamp_iso()
    write_json_file(file_path, annotation)


def update_annotation(record: PaperRecord, annotation_id: str, payload: dict[str, object]):
    file_path, annotation = load_annotation(record, annotation_id)
    if "archived" in payload:
        archived = payload.get("archived")
        if not isinstance(archived, bool):
            raise ValueError("归档状态非法")
        annotation["archived"] = archived
        annotation["archivedAt"] = current_timestamp_iso() if archived else None
        annotation["updatedAt"] = current_timestamp_iso()
    write_json_file(file_path, annotation)


def delete_annotation(record: PaperRecord, annotation_id: str):
    file_path, _annotation = load_annotation(record, annotation_id)
    file_path.unlink()


def resolve_open_target(record: PaperRecord, target: str) -> Path:
    mapping = {
        "rootDir": record.root_dir,
        "contentListJson": record.files.get("contentListJson"),
        "linearized": record.files.get("linearized"),
        "bilingual": record.files.get("bilingual"),
        "feishuReady": record.files.get("feishuReady"),
    }
    value = mapping.get(target)
    if not isinstance(value, Path) or not value.exists():
        raise FileNotFoundError("未找到指定文件")
    return value


def open_in_explorer(path: Path):
    if path.is_dir():
        os.startfile(str(path))
    else:
        os.startfile(str(path.parent))


def parse_paper_api_path(path: str) -> tuple[str, str] | None:
    if not path.startswith("/api/papers/"):
        return None
    suffix = path.removeprefix("/api/papers/")
    paper_part, separator, remainder = suffix.partition("/")
    if not paper_part:
        return None
    return unquote(paper_part), f"/{remainder.rstrip('/')}" if separator and remainder else ""


class GuiRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(GUI_DIST_DIR), **kwargs)

    def log_message(self, format, *args):
        sys.stdout.write(f"[cark-gui] {format % args}\n")
        sys.stdout.flush()

    def read_json_body(self) -> dict[str, object]:
        content_length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            payload = {}
        return payload if isinstance(payload, dict) else {}

    def read_binary_body(self) -> bytes:
        content_length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(content_length) if content_length > 0 else b""

    def write_json(self, payload, *, status: HTTPStatus = HTTPStatus.OK):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def serve_file(self, path: Path):
        if not path.exists() or not path.is_file():
            return self.write_json({"error": "文件不存在"}, status=HTTPStatus.NOT_FOUND)
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/settings":
            return self.write_json(load_gui_settings())

        if parsed.path == "/api/capabilities":
            return self.write_json(detect_capabilities())

        if parsed.path == "/api/tasks":
            return self.write_json(list_tasks_payload())

        if parsed.path == "/api/papers":
            return self.write_json(list_papers())

        paper_route = parse_paper_api_path(parsed.path)
        if paper_route:
            paper_id, remainder = paper_route
            try:
                record = get_record(paper_id)
            except FileNotFoundError as error:
                return self.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)

            if remainder == "":
                return self.write_json(build_detail(record))
            if remainder == "/annotations":
                return self.write_json(load_paper_annotations(record))
            if remainder == "/reading-state":
                state = STORE.get_reading_state(record.paper_id)
                if state is None:
                    preferred_view = "bilingual" if "bilingual" in record.available_views else "linearized"
                    state = {
                        "paperId": record.paper_id,
                        "view": preferred_view,
                        "scrollY": 0,
                        "activeSectionId": None,
                        "draft": None,
                        "updatedAt": None,
                    }
                return self.write_json(state)
            if remainder == "/memory":
                return self.write_json(build_memory_payload(record))

        if parsed.path.startswith("/api/media/"):
            paper_id = unquote(parsed.path.removeprefix("/api/media/"))
            relative_path = parse_qs(parsed.query).get("path", [None])[0]
            if not relative_path:
                return self.write_json({"error": "缺少 path 参数"}, status=HTTPStatus.BAD_REQUEST)
            try:
                record = get_record(paper_id)
                target = ensure_within_root(record, relative_path)
            except (FileNotFoundError, PermissionError) as error:
                return self.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
            return self.serve_file(target)

        if parsed.path.startswith("/assets/") or parsed.path == "/favicon.ico":
            return super().do_GET()

        if parsed.path != "/" and (GUI_DIST_DIR / parsed.path.lstrip("/")).exists():
            return super().do_GET()

        self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/settings":
            payload = self.read_json_body()
            return self.write_json(save_gui_settings(payload))

        if parsed.path == "/api/settings/test":
            payload = self.read_json_body()
            target = payload.get("target")
            settings_payload = payload.get("settings")
            if not isinstance(target, str) or not isinstance(settings_payload, dict):
                return self.write_json({"error": "参数错误"}, status=HTTPStatus.BAD_REQUEST)
            result = run_connection_test(target, settings_payload)
            status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST
            return self.write_json(result, status=status)

        if parsed.path == "/api/tasks/upload":
            file_name = self.headers.get("X-File-Name")
            if not isinstance(file_name, str) or not file_name.strip():
                return self.write_json({"error": "缺少文件名"}, status=HTTPStatus.BAD_REQUEST)
            try:
                ensure_upload_ready()
                task = create_upload_task(file_name, self.read_binary_body())
            except ValueError as error:
                return self.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
            return self.write_json(task, status=HTTPStatus.CREATED)

        if parsed.path.startswith("/api/tasks/") and parsed.path.endswith("/retry"):
            task_id = unquote(parsed.path.removeprefix("/api/tasks/").removesuffix("/retry").strip("/"))
            try:
                return self.write_json(retry_upload_task(task_id))
            except ValueError as error:
                return self.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
            except FileNotFoundError as error:
                return self.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)

        paper_route = parse_paper_api_path(parsed.path)
        if paper_route:
            paper_id, remainder = paper_route
            payload = self.read_json_body()
            try:
                record = get_record(paper_id)
            except FileNotFoundError as error:
                return self.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)

            try:
                if remainder == "/annotations":
                    create_annotation(record, payload)
                    return self.write_json(load_paper_annotations(record))
                if remainder.startswith("/annotations/") and remainder.endswith("/comments"):
                    annotation_id = remainder.removeprefix("/annotations/").removesuffix("/comments").strip("/")
                    append_annotation_comment(record, annotation_id, payload)
                    return self.write_json(load_paper_annotations(record))
                if remainder == "/notes":
                    create_memory_note(record, payload)
                    return self.write_json(build_memory_payload(record))
            except (ValueError, FileNotFoundError) as error:
                status = HTTPStatus.BAD_REQUEST if isinstance(error, ValueError) else HTTPStatus.NOT_FOUND
                return self.write_json({"error": str(error)}, status=status)

        if parsed.path == "/api/actions/open":
            payload = self.read_json_body()
            paper_id = payload.get("paperId")
            target = payload.get("target")
            if not isinstance(paper_id, str) or not isinstance(target, str):
                return self.write_json({"error": "参数错误"}, status=HTTPStatus.BAD_REQUEST)
            try:
                record = get_record(paper_id)
                open_in_explorer(resolve_open_target(record, target))
                return self.write_json({"ok": True})
            except FileNotFoundError as error:
                return self.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)

        if parsed.path == "/api/actions/open-runtime":
            RUNTIME_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            open_in_explorer(RUNTIME_OUTPUT_DIR)
            return self.write_json({"ok": True})

        return self.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        parsed = urlparse(self.path)
        paper_route = parse_paper_api_path(parsed.path)
        if not paper_route:
            return self.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)

        paper_id, remainder = paper_route
        payload = self.read_json_body()
        try:
            record = get_record(paper_id)
            if remainder == "/reading-state":
                state = STORE.save_reading_state(record.paper_id, payload, current_timestamp_iso())
                return self.write_json(state)
        except ValueError as error:
            return self.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        except FileNotFoundError as error:
            return self.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)

        return self.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)

    def do_PATCH(self):
        parsed = urlparse(self.path)
        paper_route = parse_paper_api_path(parsed.path)
        if not paper_route:
            return self.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)

        paper_id, remainder = paper_route
        payload = self.read_json_body()
        try:
            record = get_record(paper_id)
            if remainder.startswith("/annotations/") and "/comments/" in remainder:
                annotation_suffix = remainder.removeprefix("/annotations/")
                annotation_id, comment_id = annotation_suffix.split("/comments/", 1)
                update_annotation_comment(record, annotation_id.strip("/"), comment_id.strip("/"), payload)
                return self.write_json(load_paper_annotations(record))
            if remainder.startswith("/annotations/"):
                annotation_id = remainder.removeprefix("/annotations/").strip("/")
                update_annotation(record, annotation_id, payload)
                return self.write_json(load_paper_annotations(record))
        except ValueError as error:
            return self.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        except FileNotFoundError as error:
            return self.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)

        return self.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        paper_route = parse_paper_api_path(parsed.path)
        if not paper_route:
            return self.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)

        paper_id, remainder = paper_route
        try:
            record = get_record(paper_id)
            if remainder.startswith("/annotations/"):
                delete_annotation(record, remainder.removeprefix("/annotations/").strip("/"))
                return self.write_json(load_paper_annotations(record))
        except FileNotFoundError as error:
            return self.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)

        return self.write_json({"error": "未知接口"}, status=HTTPStatus.NOT_FOUND)


def build_parser():
    parser = argparse.ArgumentParser(prog="cark-gui", description="cark 本地阅读服务。")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    return parser


def prepare_gui_server(
    host: str,
    port: int,
    *,
    store: WorkbenchStore = STORE,
    owner_id: str = SERVER_INSTANCE_ID,
    instance_lock: Optional[SingleInstanceLock] = None,
    server_factory=ThreadingHTTPServer,
):
    lock = instance_lock or SingleInstanceLock(INSTANCE_LOCK_PATH)
    if not lock.acquire():
        raise RuntimeError("cark 已经在运行，请使用现有窗口")
    try:
        server = server_factory((host, port), GuiRequestHandler)
    except Exception:
        lock.release()
        raise

    try:
        interrupted_count = store.mark_orphaned_active_tasks_interrupted(
            owner_id,
            current_timestamp_iso(),
        )
        sync_paper_index(store)
    except Exception:
        server.server_close()
        lock.release()
        raise
    return server, lock, interrupted_count


def main():
    args = build_parser().parse_args()
    try:
        server, instance_lock, interrupted_count = prepare_gui_server(args.host, args.port)
    except (OSError, RuntimeError) as error:
        print(f"无法启动 cark GUI: {error}", file=sys.stderr)
        return 2
    print(f"cark GUI listening on http://{args.host}:{args.port}/")
    if interrupted_count:
        print(f"[cark-gui] 已将 {interrupted_count} 个未完成任务标记为已中断。")
    if not args.no_browser:
        webbrowser.open(f"http://{args.host}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        instance_lock.release()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

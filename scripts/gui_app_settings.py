from __future__ import annotations

import importlib.util
import os
import shutil
from pathlib import Path
from typing import Any, Callable, Optional

import requests


def default_gui_settings(
    *,
    config_dir: Path,
    load_first_json_object: Callable[[list[Path]], dict[str, object]],
    default_copilot_agent: Callable[[], dict[str, object]],
) -> dict[str, object]:
    pipeline = load_first_json_object(
        [
            config_dir / "pdf_docx_pipeline.json",
            config_dir / "pdf_docx_pipeline.example.json",
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
            "agents": [default_copilot_agent()],
        },
    }


def sanitize_gui_settings(
    payload: dict[str, object],
    *,
    default_settings_factory: Callable[[], dict[str, object]],
    default_copilot_agent: Callable[[], dict[str, object]],
) -> dict[str, object]:
    defaults = default_settings_factory()
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

    raw_agents = copilot.get("agents") if isinstance(copilot.get("agents"), list) else None
    if raw_agents is None and any(key in copilot for key in ("apiKey", "baseUrl", "model")):
        raw_agents = [copilot]
    if raw_agents is None:
        raw_agents = defaults["copilot"]["agents"] if isinstance(defaults["copilot"], dict) else [default_copilot_agent()]

    agents: list[dict[str, object]] = []
    for index, item in enumerate(raw_agents[:8]):
        if not isinstance(item, dict):
            continue
        default_agent = default_copilot_agent()
        agent_id = str(item.get("id") or default_agent["id"] or f"agent-{index + 1}").strip()
        if not agent_id:
            agent_id = f"agent-{index + 1}"
        agents.append(
            {
                "id": agent_id,
                "enabled": bool(item.get("enabled", True)),
                "name": str(item.get("name") or f"共读助手 {index + 1}").strip() or f"共读助手 {index + 1}",
                "rolePrompt": str(item.get("rolePrompt") or default_agent["rolePrompt"]).strip(),
                "apiKey": str(item.get("apiKey") or "").strip(),
                "baseUrl": str(item.get("baseUrl") or default_agent["baseUrl"]).strip(),
                "model": str(item.get("model") or default_agent["model"]).strip(),
            }
        )
    if not agents:
        agents = [default_copilot_agent()]

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
            "agents": agents,
        },
    }


def materialize_gui_settings(
    *,
    settings_path: Path,
    default_settings_factory: Callable[[], dict[str, object]],
    sanitize_settings: Callable[[dict[str, object]], dict[str, object]],
    load_json_object: Callable[[Path], dict[str, object]],
    write_json_file: Callable[[Path, Any], None],
) -> dict[str, object]:
    defaults = sanitize_settings(default_settings_factory())
    existing = load_json_object(settings_path)
    if existing:
        merged = sanitize_settings(
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
                "copilot": existing.get("copilot") if isinstance(existing.get("copilot"), dict) else defaults["copilot"],
            }
        )
    else:
        merged = defaults
    if not settings_path.exists() or load_json_object(settings_path) != merged:
        write_json_file(settings_path, merged)
    return merged


def load_gui_settings(
    *,
    settings_path: Path,
    materialize_settings: Callable[[], dict[str, object]],
    sanitize_settings: Callable[[dict[str, object]], dict[str, object]],
    load_json_object: Callable[[Path], dict[str, object]],
) -> dict[str, object]:
    defaults = materialize_settings()
    saved = load_json_object(settings_path)
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
        "copilot": saved.get("copilot") if isinstance(saved.get("copilot"), dict) else defaults["copilot"],
    }
    return sanitize_settings(merged)


def save_gui_settings(
    payload: dict[str, object],
    *,
    settings_path: Path,
    sanitize_settings: Callable[[dict[str, object]], dict[str, object]],
    write_json_file: Callable[[Path, Any], None],
) -> dict[str, object]:
    settings = sanitize_settings(payload)
    write_json_file(settings_path, settings)
    return settings


def detect_capabilities(
    *,
    workbench_root: Path,
    load_settings: Callable[[], dict[str, object]],
    settings: Optional[dict[str, object]] = None,
) -> dict[str, object]:
    current = settings if settings is not None else load_settings()
    mineru = current.get("mineru") if isinstance(current.get("mineru"), dict) else {}
    translation = current.get("translation") if isinstance(current.get("translation"), dict) else {}
    publish = current.get("publish") if isinstance(current.get("publish"), dict) else {}
    local_candidates = [
        workbench_root / ".venv" / "Scripts" / "mineru.exe",
        workbench_root / ".venv" / "bin" / "mineru",
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


def ensure_upload_ready(
    *,
    detect_capabilities_func: Callable[[Optional[dict[str, object]]], dict[str, object]],
    settings: Optional[dict[str, object]] = None,
) -> None:
    capabilities = detect_capabilities_func(settings)
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


def test_translation_connection(
    settings: dict[str, object],
    *,
    requests_post: Callable[..., Any] = requests.post,
) -> dict[str, object]:
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
    response = requests_post(
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
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    preview = str(content).strip()[:120]
    return {
        "ok": True,
        "message": "翻译模型可用",
        "detail": f"模型返回: {preview or 'ok'}",
    }


def run_connection_test(
    target: str,
    settings_payload: dict[str, object],
    *,
    sanitize_settings: Callable[[dict[str, object]], dict[str, object]],
    test_mineru_connection_func: Callable[[dict[str, object]], dict[str, object]] = test_mineru_connection,
    test_translation_connection_func: Callable[[dict[str, object]], dict[str, object]] = test_translation_connection,
) -> dict[str, object]:
    settings = sanitize_settings(settings_payload)
    try:
        if target == "mineru":
            return test_mineru_connection_func(settings)
        if target == "translation":
            return test_translation_connection_func(settings)
        raise ValueError("未知测试目标")
    except Exception as error:
        return {
            "ok": False,
            "message": str(error),
            "detail": None,
        }

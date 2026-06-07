import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import shutil
from pathlib import Path

from content_list_to_feishu_docx import (
    coalesce,
    load_config,
    prepare_markdown_file,
    publish_native_docx,
    resolve_path,
    linearize_content_list_file,
)
from upload_md_to_feishu import FeishuApiError


def parse_args():
    parser = argparse.ArgumentParser(
        description="One-shot pipeline: PDF -> MinerU -> content_list.json -> native Feishu docx."
    )
    parser.add_argument("--config", help="Optional JSON config file for the PDF pipeline.")
    parser.add_argument("--input-pdf", help="Path to input PDF file.")
    parser.add_argument("--mineru-output-dir", help="Optional MinerU output directory.")
    parser.add_argument("--linearized-output", help="Optional output path for the linearized markdown.")
    parser.add_argument("--prepared-output", help="Optional output path for the Feishu-ready markdown.")
    parser.add_argument("--title", help="Optional Feishu document title.")
    parser.add_argument(
        "--folder-token",
        default=os.getenv("FEISHU_FOLDER_TOKEN", ""),
        help="Target Feishu folder token. Defaults to FEISHU_FOLDER_TOKEN.",
    )
    parser.add_argument(
        "--app-id",
        default=os.getenv("FEISHU_APP_ID", ""),
        help="Feishu app id. Defaults to FEISHU_APP_ID.",
    )
    parser.add_argument(
        "--app-secret",
        default=os.getenv("FEISHU_APP_SECRET", ""),
        help="Feishu app secret. Defaults to FEISHU_APP_SECRET.",
    )
    parser.add_argument(
        "--image-mode",
        choices=["strip", "note", "keep"],
        default=None,
        help="How to handle local image references before docx conversion. Defaults to config or note.",
    )
    parser.add_argument(
        "--parse-method",
        choices=["auto", "txt", "ocr"],
        default=None,
        help="MinerU parsing method. Defaults to config or auto.",
    )
    parser.add_argument(
        "--backend",
        choices=["local", "cloud"],
        default=None,
        help="解析后端：local（本地 mineru.exe，需 14GB 模型+GPU）或 "
             "cloud（MinerU 云 API，零模型下载，需 MINERU_API_TOKEN）。默认 local。",
    )
    parser.add_argument(
        "--model-version",
        choices=["pipeline", "vlm"],
        default=None,
        help="云后端模型版本：pipeline（默认，与本地同款）或 vlm（更全，多识别图表）。"
             "仅 --backend cloud 时生效。",
    )
    parser.add_argument(
        "--api-token",
        default=os.getenv("MINERU_API_TOKEN", ""),
        help="MinerU 云 API token。默认读环境变量 MINERU_API_TOKEN。仅 --backend cloud 时用。",
    )
    parser.add_argument("--replacements-file", help="Optional JSON file describing post-import text replacements.")
    parser.add_argument(
        "--replacement-block-limit",
        type=int,
        default=None,
        help="Only inspect the first N text-like blocks when applying configured replacements.",
    )
    parser.add_argument(
        "--reuse-existing-parse",
        action="store_true",
        help="Reuse a previous MinerU parse for the same staged PDF when available.",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Stop after producing local markdown artifacts and skip Feishu API calls.",
    )
    parser.add_argument(
        "--translate",
        action="store_true",
        help="Translate the linearized markdown into a bilingual version before Feishu import.",
    )
    return parser.parse_args()


def build_runtime_settings(args):
    config = load_config(args.config)
    config_dir = config.get("_config_dir", os.getcwd())

    input_pdf = resolve_path(coalesce(args.input_pdf, config.get("input_pdf")), config_dir)
    if not input_pdf or not input_pdf.exists():
        raise FeishuApiError("缺少有效的 PDF 路径")
    safe_stem = sanitize_stem_for_ascii(input_pdf.stem)

    mineru_output_dir = resolve_path(args.mineru_output_dir or config.get("mineru_output_dir"), config_dir)
    if not mineru_output_dir:
        mineru_output_dir = resolve_path("./runtime/output", str(Path(__file__).resolve().parents[1]))
        mineru_output_dir = mineru_output_dir / safe_stem

    linearized_output = resolve_path(args.linearized_output or config.get("linearized_output"), config_dir)
    if not linearized_output:
        linearized_output = mineru_output_dir / "auto" / f"{safe_stem}_linearized.md"

    prepared_output = resolve_path(args.prepared_output or config.get("prepared_output"), config_dir)
    if not prepared_output:
        prepared_output = mineru_output_dir / "auto" / f"{safe_stem}_feishu_docx_ready.md"

    replacements_file = resolve_path(args.replacements_file or config.get("replacements_file"), config_dir)

    return {
        "input_pdf": input_pdf,
        "safe_stem": safe_stem,
        "mineru_output_dir": mineru_output_dir,
        "linearized_output": linearized_output,
        "prepared_output": prepared_output,
        "title": coalesce(args.title, config.get("title"), input_pdf.stem),
        "folder_token": coalesce(args.folder_token, config.get("folder_token"), ""),
        "app_id": coalesce(args.app_id, config.get("app_id"), ""),
        "app_secret": coalesce(args.app_secret, config.get("app_secret"), ""),
        "image_mode": coalesce(args.image_mode, config.get("image_mode"), "note"),
        "parse_method": coalesce(args.parse_method, config.get("parse_method"), "auto"),
        "backend": coalesce(args.backend, config.get("backend"), "local"),
        "model_version": coalesce(args.model_version, config.get("model_version"), "pipeline"),
        "api_token": coalesce(args.api_token, config.get("api_token"), ""),
        "replacements_file": replacements_file,
        "replacement_block_limit": coalesce(args.replacement_block_limit, config.get("replacement_block_limit"), 40),
        "reuse_existing_parse": args.reuse_existing_parse or bool(config.get("reuse_existing_parse", True)),
        "prepare_only": args.prepare_only or bool(config.get("prepare_only", False)),
        "translate": args.translate or bool(config.get("translate", False)),
    }


def sanitize_stem_for_ascii(value):
    ascii_value = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._")
    return ascii_value or "input"


def stage_input_pdf(input_pdf):
    if all(ord(char) < 128 for char in str(input_pdf)):
        return input_pdf, False

    workbench_root = Path(__file__).resolve().parents[1]
    uploads_dir = workbench_root / "runtime" / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    base_name = sanitize_stem_for_ascii(input_pdf.stem)
    suffix = input_pdf.suffix.lower()
    preferred_path = uploads_dir / f"{base_name}{suffix}"

    candidates = [preferred_path]
    stat = input_pdf.stat()
    candidates.append(uploads_dir / f"{base_name}-{stat.st_size}-{int(stat.st_mtime)}{suffix}")

    for staged_path in candidates:
        if staged_path.exists():
            return staged_path, True
        try:
            shutil.copy2(input_pdf, staged_path)
            return staged_path, True
        except PermissionError:
            continue

    raise FeishuApiError(f"无法创建 ASCII 暂存 PDF: {input_pdf}")


def get_workbench_root():
    return Path(__file__).resolve().parents[1]


def build_mineru_env(mineru_output_dir):
    workbench_root = get_workbench_root()
    runtime_root = workbench_root / "runtime"
    hf_home = runtime_root / "hf-home"
    config_file = workbench_root / "config" / "mineru.json"
    directories = [
        runtime_root / "uv-cache",
        runtime_root / "python",
        runtime_root / "pip-cache",
        hf_home,
        hf_home / "hub",
        hf_home / "assets",
        runtime_root / "modelscope-cache",
        runtime_root / "tmp",
        mineru_output_dir,
        config_file.parent,
    ]
    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)

    paths = {
        "UV_CACHE_DIR": runtime_root / "uv-cache",
        "UV_PYTHON_INSTALL_DIR": runtime_root / "python",
        "PIP_CACHE_DIR": runtime_root / "pip-cache",
        "HF_HOME": hf_home,
        "HF_HUB_CACHE": hf_home / "hub",
        "HF_ASSETS_CACHE": hf_home / "assets",
        "MODELSCOPE_CACHE": runtime_root / "modelscope-cache",
        "TEMP": runtime_root / "tmp",
        "TMP": runtime_root / "tmp",
        "MINERU_TOOLS_CONFIG_JSON": config_file,
        "MINERU_API_OUTPUT_ROOT": mineru_output_dir,
        "MINERU_MODEL_SOURCE": "local",
        "HF_HUB_DISABLE_SYMLINKS_WARNING": "1",
        "UV_LINK_MODE": "copy",
        # Keep Windows GPU runs conservative to avoid RTX 4060 Laptop OOMs.
        "MINERU_FORCE_BATCH_RATIO": "1",
        "MINERU_PDF_RENDER_THREADS": "1",
    }
    env = os.environ.copy()
    for key, value in paths.items():
        env[key] = str(value)
    return env


def _terminate_process_tree(pid):
    """尽力杀掉指定进程及其子孙（Windows 用 taskkill /T，跨平台兜底用信号）。"""
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            os.kill(pid, 9)
    except Exception:
        pass


def _kill_orphan_mineru_api(output_root):
    """清理可能残留的孤儿 mineru.cli.fast_api 后端服务。

    MinerU 的 CLI 是 client/server 架构：mineru.exe(client) 会拉起一个
    mineru.cli.fast_api(uvicorn run_forever) 后端做解析。Windows 上 client
    退出时偶尔杀不干净后端，残留的 fast_api 会继承父进程 stdout 管道写端且
    永不退出，导致下一次 subprocess 读管道时永久阻塞。这里主动收尾。
    """
    try:
        import psutil
    except ImportError:
        return
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmdline = " ".join(proc.info.get("cmdline") or [])
            if "mineru.cli.fast_api" in cmdline:
                proc.kill()
        except Exception:
            continue


def _gpu_busy_mib():
    """返回当前 GPU 已用显存(MiB)；拿不到信息返回 None（视为可继续）。"""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None
    line = (result.stdout or "").strip().splitlines()
    if not line:
        return None
    try:
        return int(line[0].strip())
    except ValueError:
        return None


def _wait_for_gpu_idle(threshold_mib=1500, timeout_seconds=120):
    """等待 GPU 显存占用回落到阈值以下，避免与残留进程抢显存触发 cuBLAS 崩溃。

    拿不到 nvidia-smi 信息时直接返回 True（不阻塞）。
    """
    import time

    deadline = time.time() + timeout_seconds
    while True:
        used = _gpu_busy_mib()
        if used is None or used <= threshold_mib:
            return True
        if time.time() >= deadline:
            return False
        time.sleep(3)


class _ParseLock:
    """跨进程文件锁：保证同一时刻只有一个 MinerU 解析在跑（防 GPU 资源竞争）。

    用 os.open(O_CREAT|O_EXCL) 实现，拿不到锁就轮询等待（带超时）。
    """

    def __init__(self, lock_path, timeout_seconds=1800):
        self.lock_path = Path(lock_path)
        self.timeout_seconds = timeout_seconds
        self._fd = None

    def __enter__(self):
        import time

        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.time() + self.timeout_seconds
        while True:
            try:
                self._fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
                os.write(self._fd, str(os.getpid()).encode("ascii", "ignore"))
                return self
            except FileExistsError:
                # 检查持锁进程是否还活着；死了就抢锁（清理陈旧锁）。
                if self._stale_lock():
                    try:
                        self.lock_path.unlink()
                    except OSError:
                        pass
                    continue
                if time.time() >= deadline:
                    raise FeishuApiError(
                        f"等待解析锁超时（另一个解析任务仍在运行）：{self.lock_path}"
                    )
                time.sleep(2)

    def _stale_lock(self):
        try:
            pid_text = self.lock_path.read_text(encoding="ascii", errors="ignore").strip()
            pid = int(pid_text)
        except (OSError, ValueError):
            return False
        try:
            import psutil

            return not psutil.pid_exists(pid)
        except ImportError:
            return False

    def __exit__(self, *exc):
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
        try:
            self.lock_path.unlink()
        except OSError:
            pass
        return False


def _run_mineru_once(command, workbench_root, mineru_output_dir, mineru_log, timeout_seconds):
    """执行一次 mineru CLI，返回 returncode。输出重定向到日志文件（不用管道，防死锁）。"""
    with open(mineru_log, "w", encoding="utf-8", errors="replace") as log_fh:
        process = subprocess.Popen(
            command,
            cwd=str(workbench_root),
            env=build_mineru_env(mineru_output_dir),
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
        )
        try:
            return process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            _terminate_process_tree(process.pid)
            _kill_orphan_mineru_api(workbench_root / "runtime" / "output")
            raise FeishuApiError(
                f"MinerU 解析超时（>{timeout_seconds}s），已终止。日志见: {mineru_log}"
            )


def run_mineru_pipeline(settings):
    workbench_root = get_workbench_root()
    mineru_exe = workbench_root / ".venv" / "Scripts" / "mineru.exe"
    if not mineru_exe.exists():
        raise FeishuApiError(f"未找到 MinerU 可执行文件: {mineru_exe}")

    settings["mineru_output_dir"].mkdir(parents=True, exist_ok=True)
    command = [
        str(mineru_exe),
        "-p",
        str(settings["mineru_input_pdf"]),
        "-o",
        str(settings["mineru_output_dir"]),
        "-b",
        "pipeline",
        "-m",
        settings["parse_method"],
    ]

    # 关键：不用 capture_output=True（管道）。MinerU CLI 会派生一个 run_forever 的
    # fast_api 后端，若它残留且继承了 stdout 管道写端，管道永远收不到 EOF，
    # subprocess.run 会永久阻塞（这正是历史上“卡在 subprocess.run(mineru.exe)”的根因）。
    # 改为把输出重定向到日志文件，并加超时 + 进程树清理双保险。
    log_dir = workbench_root / "runtime" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    mineru_log = log_dir / f"mineru_{settings['safe_stem']}.log"
    output_root = workbench_root / "runtime" / "output"

    try:
        timeout_seconds = int(os.getenv("MINERU_CLI_TIMEOUT", "1800"))
    except ValueError:
        timeout_seconds = 1800
    try:
        gpu_idle_threshold = int(os.getenv("MINERU_GPU_IDLE_MIB", "1500"))
    except ValueError:
        gpu_idle_threshold = 1500
    max_attempts = 2  # 首次 + CUDA 崩溃自动重试 1 次

    # GPU 互斥锁：同一时刻只允许一个解析，避免多任务抢同一张卡触发 cuBLAS 崩溃。
    lock_path = workbench_root / "runtime" / "locks" / "mineru_parse.lock"
    returncode = None
    log_tail = ""
    with _ParseLock(lock_path, timeout_seconds=timeout_seconds):
        for attempt in range(1, max_attempts + 1):
            # 每次尝试前：清场残留 fast_api + 等 GPU 显存回落，确保干净起点。
            _kill_orphan_mineru_api(output_root)
            if not _wait_for_gpu_idle(threshold_mib=gpu_idle_threshold, timeout_seconds=60):
                # GPU 长时间不空闲只告警，不强行阻断（可能是别的正常负载）。
                pass

            returncode = _run_mineru_once(
                command, workbench_root, settings["mineru_output_dir"], mineru_log, timeout_seconds
            )

            # CLI client 收尾即便异常，产物也可能已完整；先清理残留后端。
            _kill_orphan_mineru_api(output_root)

            try:
                log_text = mineru_log.read_text(encoding="utf-8", errors="replace")
                log_tail = "\n".join(log_text.splitlines()[-40:])
            except OSError:
                log_text = ""
                log_tail = ""

            has_content_list = any(settings["mineru_output_dir"].rglob("*_content_list.json"))
            if has_content_list:
                break  # 成功（以产出 content_list 为准）

            # 失败：若是 CUDA/cuBLAS 执行错误且还有重试机会，清场+等 GPU 后重试。
            cuda_crash = ("CUBLAS_STATUS_EXECUTION_FAILED" in log_text) or ("CUDA error" in log_text)
            if cuda_crash and attempt < max_attempts:
                _kill_orphan_mineru_api(output_root)
                _wait_for_gpu_idle(threshold_mib=gpu_idle_threshold, timeout_seconds=120)
                continue
            break

    has_content_list = any(settings["mineru_output_dir"].rglob("*_content_list.json"))
    if (returncode != 0 and not has_content_list) or not has_content_list:
        raise FeishuApiError(
            f"MinerU 解析失败 (returncode={returncode})，且未产出 content_list。\n"
            f"日志尾部:\n{log_tail}\n\n完整日志: {mineru_log}"
        )

    return {
        "returncode": returncode,
        "log_file": str(mineru_log),
        "log_tail": log_tail,
    }


def run_cloud_pipeline(settings):
    """用 MinerU 云 API 解析，返回 content_list.json 路径。

    云后端不碰本地 GPU/模型，所以跳过 GPU 锁、显存自检、fast_api 清理等本地专属逻辑。
    产物（content_list.json + images/）解压到 mineru_output_dir/auto，与本地后端的单层
    auto 布局对齐，下游 sync_parse_assets / linearize 可直接复用。
    """
    from mineru_cloud import parse_pdf_via_cloud

    output_dir = settings["mineru_output_dir"] / "auto"
    output_dir.mkdir(parents=True, exist_ok=True)

    def _progress(state, progress):
        extra = f" {progress}" if progress else ""
        print(f"[云解析] state={state}{extra}", file=sys.stderr)

    try:
        cli_timeout = int(os.getenv("MINERU_CLI_TIMEOUT", "1800"))
    except ValueError:
        cli_timeout = 1800

    content_list_json = parse_pdf_via_cloud(
        settings["mineru_input_pdf"],
        output_dir,
        token=settings.get("api_token", ""),
        model_version=settings.get("model_version", "pipeline"),
        is_ocr=(settings.get("parse_method") == "ocr"),
        timeout=cli_timeout,
        on_progress=_progress,
    )
    return content_list_json


def _file_sha1(path):
    digest = hashlib.sha1()
    with Path(path).open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


# 每个解析任务成功后，在其输出目录写一个标记文件，记录源 PDF 的 sha1。
# 这样无论源 PDF 文件名是否 ASCII（是否进过 uploads/），都能可靠命中缓存。
SOURCE_HASH_MARKER = "source_pdf.sha1"


def write_source_hash_marker(mineru_output_dir, source_pdf):
    try:
        marker = Path(mineru_output_dir) / SOURCE_HASH_MARKER
        marker.write_text(_file_sha1(source_pdf), encoding="utf-8")
    except OSError:
        pass


def locate_cached_content_list(staged_pdf):
    output_root = get_workbench_root() / "runtime" / "output"
    if not output_root.exists():
        return None

    try:
        target_size = staged_pdf.stat().st_size
    except OSError:
        return None
    target_hash = ""

    candidates = []

    # 方式一（首选）：按 source_pdf.sha1 标记匹配，不依赖文件名/uploads。
    for marker in output_root.glob("**/" + SOURCE_HASH_MARKER):
        try:
            marked_hash = marker.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if not marked_hash:
            continue
        if not target_hash:
            target_hash = _file_sha1(staged_pdf)
        if marked_hash != target_hash:
            continue
        task_root = marker.parent
        found = list(task_root.glob("**/*_content_list.json"))
        # 只接受非空 content_list（避免命中失败残留的空解析）。
        candidates.extend(p for p in found if p.stat().st_size > 0)

    # 方式二（兼容旧数据）：按 uploads/ 下的源 PDF 副本比对 sha1。
    if not candidates:
        for upload_match in output_root.glob("**/uploads/*.pdf"):
            try:
                if upload_match.stat().st_size != target_size:
                    continue
            except OSError:
                continue
            if not target_hash:
                target_hash = _file_sha1(staged_pdf)
            if _file_sha1(upload_match) != target_hash:
                continue
            task_root = upload_match.parent.parent
            found = list(task_root.glob("**/*_content_list.json"))
            candidates.extend(p for p in found if p.stat().st_size > 0)

    if not candidates:
        return None
    return sorted(candidates, key=lambda path: path.stat().st_mtime, reverse=True)[0]


def locate_content_list(mineru_output_dir):
    candidates = sorted(mineru_output_dir.rglob("*_content_list.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not candidates:
        raise FeishuApiError(f"未在 MinerU 输出目录中找到 *_content_list.json: {mineru_output_dir}")
    return candidates[0]


def sync_parse_assets(content_list_json, markdown_output_dir):
    source_images_dir = content_list_json.parent / "images"
    target_images_dir = markdown_output_dir / "images"
    if not source_images_dir.exists():
        return False
    # 云后端把产物直接解压到 markdown 输出目录，此时 source==target，无需搬运
    # （否则 copytree 自我复制会触发 WinError 32）。
    try:
        if source_images_dir.resolve() == target_images_dir.resolve():
            return True
    except OSError:
        pass
    shutil.copytree(source_images_dir, target_images_dir, dirs_exist_ok=True)
    return True


def main():
    args = parse_args()
    settings = build_runtime_settings(args)

    # 启动前轻量体检：提前暴露 commit 内存不足/残留进程等问题，而不是跑到一半崩。
    # 云后端不碰本地 GPU/内存，跳过体检（其致命项都是本地解析专属）。
    if settings["backend"] == "local":
        try:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from preflight import run_quick_check

            pf_warns, pf_fatals = run_quick_check()
            for w in pf_warns:
                print(f"[preflight 警告] {w}", file=sys.stderr)
            if pf_fatals and os.getenv("MINERU_SKIP_PREFLIGHT") != "1":
                details = "; ".join(pf_fatals)
                raise FeishuApiError(
                    f"运行前体检发现致命问题: {details}。"
                    f"处理后重试，或设 MINERU_SKIP_PREFLIGHT=1 强制继续。"
                )
        except FeishuApiError:
            raise
        except Exception:
            pass  # 体检本身不能阻断主流程

    mineru_input_pdf, staged_input = stage_input_pdf(settings["input_pdf"])
    settings["mineru_input_pdf"] = mineru_input_pdf

    mineru_result = {"reused_cache": False}
    content_list_json = None
    if settings["reuse_existing_parse"]:
        content_list_json = locate_cached_content_list(settings["mineru_input_pdf"])
        if content_list_json:
            mineru_result["reused_cache"] = True

    if not content_list_json:
        if settings["backend"] == "cloud":
            content_list_json = run_cloud_pipeline(settings)
            mineru_result = {"reused_cache": False, "backend": "cloud"}
        else:
            mineru_result = run_mineru_pipeline(settings)
            mineru_result["reused_cache"] = False
            mineru_result["backend"] = "local"
            content_list_json = locate_content_list(settings["mineru_output_dir"])
        # 写源 PDF sha1 标记，供下次按内容命中缓存（不依赖文件名，云/本地通用）。
        write_source_hash_marker(content_list_json.parent, settings["mineru_input_pdf"])

    assets_synced = sync_parse_assets(content_list_json, settings["linearized_output"].parent)
    linearize_content_list_file(content_list_json, settings["linearized_output"])
    
    input_for_feishu = settings["linearized_output"]
    
    if settings["translate"]:
        from translate_content import translate_file
        bilingual_output = settings["linearized_output"].with_name(settings["linearized_output"].stem + "_bilingual.md")
        translate_file(settings["linearized_output"], bilingual_output)
        input_for_feishu = bilingual_output

    prepared_markdown, local_images = prepare_markdown_file(
        input_for_feishu,
        settings["prepared_output"],
        settings["image_mode"],
    )

    output = {
        "input_pdf": str(settings["input_pdf"]),
        "mineru_input_pdf": str(settings["mineru_input_pdf"]),
        "staged_input_pdf": staged_input,
        "mineru_output_dir": str(settings["mineru_output_dir"]),
        "content_list_json": str(content_list_json),
        "linearized_markdown": str(settings["linearized_output"]),
        "prepared_markdown": str(settings["prepared_output"]),
        "image_mode": settings["image_mode"],
        "parse_method": settings["parse_method"],
        "assets_synced": assets_synced,
        "local_images_rewritten": local_images,
        "mineru_result": mineru_result,
    }

    if not settings["prepare_only"]:
        publish_settings = {
            "prepared_output": settings["prepared_output"],
            "folder_token": settings["folder_token"],
            "app_id": settings["app_id"],
            "app_secret": settings["app_secret"],
            "title": settings["title"],
            "replacements_file": settings["replacements_file"],
            "replacement_block_limit": settings["replacement_block_limit"],
        }
        output.update(publish_native_docx(publish_settings, prepared_markdown))

    # Windows 控制台默认 GBK(cp936)，输出含中文/特殊字符的 JSON 会触发
    # UnicodeEncodeError。优先把结果以 UTF-8 安全写出，避免在最后一步白白崩掉。
    payload = json.dumps(output, ensure_ascii=False, indent=2)
    try:
        sys.stdout.buffer.write(payload.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
        sys.stdout.buffer.flush()
    except (AttributeError, ValueError):
        # 某些被重定向的 stdout 没有 buffer，退回普通 print 并替换不可编码字符。
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        sys.stdout.write(payload.encode(enc, errors="replace").decode(enc, errors="replace"))
        sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except FeishuApiError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

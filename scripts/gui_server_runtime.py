from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path
from typing import Any


def resolve_open_target(record: Any, target: str) -> Path:
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


def open_in_explorer(path: Path, *, startfile) -> None:
    if path.is_dir():
        startfile(str(path))
    else:
        startfile(str(path.parent))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cark-gui", description="cark 本地阅读服务。")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument(
        "--runtime-root",
        help="使用指定运行目录启动服务。默认使用仓库 runtime；demo 可传 runtime/demo-smoke。",
    )
    return parser


def prepare_gui_server(
    host: str,
    port: int,
    *,
    store: Any,
    owner_id: str,
    instance_lock,
    lock_path: Path,
    lock_factory,
    server_factory,
    handler_class,
    current_timestamp_iso,
    sync_paper_index,
    resume_active_copilot_runs,
):
    lock = instance_lock or lock_factory(lock_path)
    if not lock.acquire():
        raise RuntimeError("cark 已经在运行，请使用现有窗口")
    try:
        server = server_factory((host, port), handler_class)
    except Exception:
        lock.release()
        raise

    try:
        interrupted_count = store.mark_orphaned_active_tasks_interrupted(
            owner_id,
            current_timestamp_iso(),
        )
        sync_paper_index(store)
        copilot_recovery = resume_active_copilot_runs()
    except Exception:
        server.server_close()
        lock.release()
        raise
    return server, lock, interrupted_count, copilot_recovery


def main(
    *,
    argv: list[str] | None = None,
    build_parser_func=build_parser,
    prepare_server_func,
    open_browser=webbrowser.open,
    stderr=sys.stderr,
) -> int:
    args = build_parser_func().parse_args(argv)
    try:
        server, instance_lock, interrupted_count, copilot_recovery = prepare_server_func(args.host, args.port)
    except (OSError, RuntimeError) as error:
        print(f"无法启动 cark GUI: {error}", file=stderr)
        return 2
    print(f"cark GUI listening on http://{args.host}:{args.port}/")
    if args.runtime_root:
        print(f"[cark-gui] 使用运行目录: {args.runtime_root}")
    if interrupted_count:
        print(f"[cark-gui] 已将 {interrupted_count} 个未完成任务标记为已中断。")
    if copilot_recovery.get("expired"):
        print(f"[cark-gui] 已将 {copilot_recovery['expired']} 个超时共读任务标记为失败。")
    if copilot_recovery.get("resumed"):
        print(f"[cark-gui] 已恢复 {copilot_recovery['resumed']} 个未完成共读任务。")
    if not args.no_browser:
        open_browser(f"http://{args.host}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        instance_lock.release()
    return 0

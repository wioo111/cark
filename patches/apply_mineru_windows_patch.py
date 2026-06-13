"""为已安装的 MinerU 应用 Windows 稳定性补丁（可选、幂等）。

背景
----
MinerU 的 CLI 在 Windows 上用 spawn 方式起子进程池做"可视化"（生成 layout/span 预览
PDF）。该子进程池在收尾 ``executor.shutdown(wait=True)`` 时可能永久阻塞，进而拖死整个
解析进程。可视化只是预览，不是核心产物，改用线程池即可彻底规避，对解析结果无影响。

本脚本定位**当前 Python 环境里已安装的** ``mineru/cli/client.py``，把
``create_visualization_context()`` 里的 ``ProcessPoolExecutor`` 在 ``win32`` 下替换为
``ThreadPoolExecutor``。不分发 MinerU 源码，只在用户机器上就地打补丁。

用法
----
    python patches/apply_mineru_windows_patch.py          # 应用
    python patches/apply_mineru_windows_patch.py --check  # 只检查是否已打/是否需要

幂等：已打过会直接跳过。会先备份为 client.py.orig。
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

MARKER = "mineru-visualization"  # 补丁特征串，用于判断是否已应用

ORIGINAL = """    try:
        spawn_context = multiprocessing.get_context("spawn")
        return VisualizationContext(
            executor=ProcessPoolExecutor(
                max_workers=1,
                mp_context=spawn_context,
            ),
            futures=[],
        )"""

PATCHED = """    try:
        # [cark patch] Windows 上 spawn 子进程池收尾 shutdown(wait=True) 可能永久阻塞，
        # 拖死整个 CLI。可视化只是预览 PDF，非核心产物，win32 下改用线程池更稳。
        if sys.platform == "win32":
            executor = ThreadPoolExecutor(
                max_workers=1,
                thread_name_prefix="mineru-visualization",
            )
        else:
            spawn_context = multiprocessing.get_context("spawn")
            executor = ProcessPoolExecutor(
                max_workers=1,
                mp_context=spawn_context,
            )
        return VisualizationContext(
            executor=executor,
            futures=[],
        )"""

IMPORT_OLD = "from concurrent.futures import Future, ProcessPoolExecutor"
IMPORT_NEW = "from concurrent.futures import Future, ProcessPoolExecutor, ThreadPoolExecutor"


def locate_client_py() -> Path | None:
    try:
        import mineru.cli.client as client_mod
    except Exception:
        return None
    return Path(client_mod.__file__)


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply MinerU Windows stability patch.")
    parser.add_argument("--check", action="store_true", help="只检查，不修改")
    args = parser.parse_args()

    target = locate_client_py()
    if target is None or not target.exists():
        print("未找到已安装的 mineru.cli.client，请先 pip install mineru。")
        return 2

    text = target.read_text(encoding="utf-8")

    if MARKER in text:
        print(f"已打补丁，无需重复：{target}")
        return 0

    if args.check:
        need = ORIGINAL in text
        print(f"{'需要打补丁' if need else '未匹配到目标代码（MinerU 版本可能不同）'}：{target}")
        return 0 if need else 1

    if ORIGINAL not in text:
        print(
            "未匹配到目标代码，可能 MinerU 版本与本补丁不一致。\n"
            f"请手动检查 {target} 的 create_visualization_context()。"
        )
        return 1

    backup = target.with_suffix(".py.orig")
    if not backup.exists():
        shutil.copy2(target, backup)
        print(f"已备份原文件：{backup}")

    new_text = text.replace(ORIGINAL, PATCHED)
    if IMPORT_OLD in new_text and "ThreadPoolExecutor" not in new_text.split("\n")[0:40].__str__():
        new_text = new_text.replace(IMPORT_OLD, IMPORT_NEW)

    target.write_text(new_text, encoding="utf-8")
    print(f"补丁已应用：{target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""MinerU Workbench 运行前环境体检（preflight）。

一键检查会导致 MinerU 解析失败/卡死的几类已知问题，绿灯才建议跑解析：

1. 磁盘空间（C 盘临时盘 / D 盘工作盘）
2. 物理内存与 commit（提交内存）余量
3. WMI 子系统是否健康（platform.win32_ver 是否会卡）
4. WMI 兜底 shim 是否已就位
5. onnxruntime 能否快速导入（被 WMI 卡住的首要受害者）
6. torch 是否为 CUDA 版且 GPU 可见
7. 是否有残留的 mineru.cli.fast_api / 解析进程

用法：
    .venv/Scripts/python.exe scripts/preflight.py

退出码：0=全绿或仅警告；1=有致命项（建议先处理再跑解析）。
"""

from __future__ import annotations

import ctypes
import os
import sys
import threading
import time
from ctypes import wintypes

GREEN = "[ OK ]"
WARN = "[WARN]"
FAIL = "[FAIL]"

_fatal = 0
_warns = 0


def _ok(msg: str) -> None:
    print(f"{GREEN} {msg}")


def _warn(msg: str) -> None:
    global _warns
    _warns += 1
    print(f"{WARN} {msg}")


def _fail(msg: str) -> None:
    global _fatal
    _fatal += 1
    print(f"{FAIL} {msg}")


class _MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def check_memory() -> None:
    if os.name != "nt":
        _warn("非 Windows，跳过内存/commit 检查")
        return
    m = _MEMORYSTATUSEX()
    m.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
    mb = 1024 * 1024
    avail_phys = m.ullAvailPhys // mb
    commit_avail = m.ullAvailPageFile // mb
    load = m.dwMemoryLoad
    msg = f"内存占用 {load}% | 可用物理 {avail_phys}MB | commit 可用 {commit_avail}MB"
    # commit 余量是 CUDA DLL 加载成败的关键。低于 2GB 风险高。
    if commit_avail < 2048:
        _fail(msg + "  → commit 余量 < 2GB，CUDA DLL 加载可能触发 WinError 1455，建议清理进程")
    elif commit_avail < 4096:
        _warn(msg + "  → commit 余量偏低")
    else:
        _ok(msg)


def check_disk() -> None:
    for drive in ("C:\\", "D:\\"):
        if not os.path.exists(drive):
            continue
        try:
            total, used, free = _disk_usage(drive)
        except OSError:
            continue
        free_gb = free // (1024 ** 3)
        msg = f"磁盘 {drive} 剩余 {free_gb}GB"
        if free_gb < 5:
            _warn(msg + "  → 剩余 < 5GB，大模型/临时文件可能写失败")
        else:
            _ok(msg)


def _disk_usage(path: str):
    total, free = ctypes.c_ulonglong(), ctypes.c_ulonglong()
    ctypes.windll.kernel32.GetDiskFreeSpaceExW(
        ctypes.c_wchar_p(path), None, ctypes.byref(total), ctypes.byref(free)
    )
    return total.value, total.value - free.value, free.value


def check_wmi() -> None:
    """真正探测 WMI 服务是否健康。

    关键教训：不能用 platform.win32_ver() 探 WMI——Python 3.12 里它走的是
    RtlGetVersion 内核 API，根本不经过 WMI 服务，永远秒回，会误报"健康"。
    这里直接调一个**真正走 WMI 服务**的查询（Get-CimInstance Win32_OperatingSystem），
    带超时；卡住即说明 WMI 服务损坏。

    WMI 坏不影响 MinerU 解析（解析走 platform/RtlGetVersion + shim 兜底），
    只影响 tasklist / 任务管理器 / Get-CimInstance 这类系统工具。
    """
    import platform
    import subprocess

    shim_on = getattr(platform, "_mineru_wmi_shim_applied", False)

    wmi_healthy = None
    if os.name == "nt":
        try:
            # PowerShell 端也设超时双保险：查询 5s 内没回就判定卡死。
            ps_cmd = (
                "$job = Start-Job { Get-CimInstance Win32_OperatingSystem | "
                "Select-Object -ExpandProperty Caption }; "
                "if (Wait-Job $job -Timeout 5) { Receive-Job $job; 'WMI_OK' } "
                "else { Stop-Job $job; 'WMI_STUCK' }; Remove-Job $job -Force"
            )
            proc = subprocess.run(
                ["powershell.exe", "-NoProfile", "-Command", ps_cmd],
                capture_output=True,
                text=True,
                timeout=12,
            )
            out = (proc.stdout or "")
            if "WMI_OK" in out:
                wmi_healthy = True
            elif "WMI_STUCK" in out:
                wmi_healthy = False
            else:
                wmi_healthy = False  # 无输出/异常，按不健康处理
        except subprocess.TimeoutExpired:
            wmi_healthy = False
        except Exception:
            wmi_healthy = None
    else:
        # 非 Windows 无此问题。
        _ok("非 Windows，WMI 检查跳过")
        return

    if wmi_healthy is True:
        _ok("WMI 服务健康（Get-CimInstance 正常返回）")
    elif wmi_healthy is False:
        if shim_on:
            _warn(
                "WMI 服务损坏（Get-CimInstance 卡住），但 shim 已生效，"
                "MinerU 解析不受影响；tasklist/任务管理器等系统工具会卡 → 重启电脑可彻底修复"
            )
        else:
            _warn(
                "WMI 服务损坏（Get-CimInstance 卡住）。MinerU 解析靠 shim 兜底通常仍可跑，"
                "但建议确认 MINERU_WMI_SHIM 未被关闭；彻底修复需重启电脑"
            )
    else:
        _warn("无法判定 WMI 状态（探测异常）")
    return


def check_onnxruntime() -> None:
    start = time.time()
    try:
        import onnxruntime  # noqa: F401
    except Exception as exc:
        _fail(f"import onnxruntime 失败: {exc}")
        return
    elapsed = time.time() - start
    if elapsed > 10:
        _warn(f"onnxruntime 导入耗时 {elapsed:.1f}s（偏慢，可能 WMI 边缘状态）")
    else:
        _ok(f"onnxruntime 导入正常（{elapsed:.1f}s, v{onnxruntime.__version__}）")


def check_torch() -> None:
    try:
        import torch
    except Exception as exc:
        _fail(f"import torch 失败: {exc}")
        return
    cuda = torch.cuda.is_available()
    if cuda:
        try:
            name = torch.cuda.get_device_name(0)
        except Exception:
            name = "?"
        _ok(f"torch {torch.__version__} | CUDA 可用 | GPU: {name}")
    else:
        _warn(f"torch {torch.__version__} | CUDA 不可用（将走 CPU，极慢）")


def check_orphan_processes() -> None:
    try:
        import psutil
    except ImportError:
        _warn("psutil 未安装，跳过残留进程检查（pip install psutil）")
        return
    orphans = []
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmdline = " ".join(proc.info.get("cmdline") or [])
            if "mineru.cli.fast_api" in cmdline:
                orphans.append(proc.info["pid"])
        except Exception:
            continue
    if orphans:
        _warn(
            f"发现 {len(orphans)} 个残留 mineru.cli.fast_api 进程 {orphans} → "
            "建议清理后再跑，否则可能占内存/抢端口"
        )
    else:
        _ok("无残留 mineru.cli.fast_api 进程")


def run_quick_check() -> tuple:
    """供主脚本启动时调用的轻量体检（不退出进程）。

    只查最关键、最快的项：内存 commit 余量、GPU 是否被占、残留 fast_api。
    返回 (warnings: list[str], fatals: list[str])。不导入 torch/onnxruntime（太重）。
    """
    warnings_list = []
    fatals_list = []

    # commit 余量
    if os.name == "nt":
        try:
            m = _MEMORYSTATUSEX()
            m.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            commit_avail = m.ullAvailPageFile // (1024 * 1024)
            if commit_avail < 2048:
                fatals_list.append(
                    f"commit 可用仅 {commit_avail}MB（<2GB），CUDA 加载易触发 WinError 1455，建议先清理进程"
                )
            elif commit_avail < 4096:
                warnings_list.append(f"commit 可用偏低（{commit_avail}MB）")
        except Exception:
            pass

    # 残留 fast_api（会抢 GPU/端口）
    try:
        import psutil

        orphans = [
            p.info["pid"]
            for p in psutil.process_iter(["pid", "cmdline"])
            if "mineru.cli.fast_api" in " ".join(p.info.get("cmdline") or [])
        ]
        if orphans:
            warnings_list.append(f"发现 {len(orphans)} 个残留 fast_api 进程（启动解析时会自动清场）")
    except ImportError:
        pass

    return warnings_list, fatals_list


def main() -> int:
    print("=== MinerU Workbench 运行前体检 ===\n")
    check_disk()
    check_memory()
    check_wmi()
    check_onnxruntime()
    check_torch()
    check_orphan_processes()
    print()
    if _fatal:
        print(f"结论：{_fatal} 项致命、{_warns} 项警告。建议先处理致命项再跑解析。")
        return 1
    if _warns:
        print(f"结论：无致命项，{_warns} 项警告。可以跑，但留意上面的警告。")
        return 0
    print("结论：全部通过 ✓ 环境就绪，可以跑解析。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

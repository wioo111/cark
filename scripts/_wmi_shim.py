"""WMI 兜底 shim：让 onnxruntime / Magika / platform 在 WMI 损坏的机器上也能正常启动。

背景
----
在某些 Windows 机器上，WMI（Winmgmt）子系统会进入“服务在跑、查询却永久挂起”
的损坏状态。此时任何走 WMI 的调用都会无限卡住，典型受害者：

- ``platform.win32_ver()`` / ``platform.release()``  （内部走 ``platform._wmi_query``）
- ``import onnxruntime``  （import 期调用 ``check_distro_info() -> platform.release()``）
- 进而 ``magika`` / ``mineru.cli.common`` / ``mineru.cli.fast_api`` 全部启动卡死

实测：预先让 ``platform._wmi_query`` 快速失败后，``import onnxruntime`` 从“卡死 60s+”
变成 0.5s 成功，整条 ``mineru.cli.common`` 导入链约 8s 完成。

本 shim 的策略
--------------
- ``MINERU_WMI_SHIM=auto``（默认）：用一个带超时的后台探针调用 ``platform.win32_ver()``，
  若在 ``MINERU_WMI_SHIM_PROBE_TIMEOUT`` 秒（默认 3s）内未返回，判定 WMI 损坏并打补丁。
  健康机器探针会在毫秒级返回，几乎零开销，不会误伤。
- ``MINERU_WMI_SHIM=force``：无条件打补丁（跳过探针，最快启动）。
- ``MINERU_WMI_SHIM=off``：完全禁用本 shim。

补丁内容（幂等、可随时移除）
----------------------------
- 把 ``platform._wmi_query`` 替换为快速抛 ``OSError`` 的桩，使 ``uname()/release()``
  回退到不走 WMI 的注册表/环境变量路径。
- 把 ``platform.win32_ver`` 替换为返回固定值，避免任何残余 WMI 触点。

本文件被设计为既可作为 ``sitecustomize.py`` 直接放进 venv 的 site-packages 自动生效，
也可被显式 ``import`` 后调用 :func:`apply` 手动启用。
"""

from __future__ import annotations

import os
import platform

_SHIM_FLAG = "_mineru_wmi_shim_applied"
# WMI 损坏机器上的安全占位返回值（Windows 10/11 通用）。
_FAKE_WIN32_VER = ("10", "10.0", "", "Multiprocessor Free")


def _wmi_appears_broken(timeout: float) -> bool:
    """在后台线程调用 platform.win32_ver()，超时未返回则判定 WMI 损坏。"""
    import threading

    result = {"returned": False}

    def _call():
        try:
            platform.win32_ver()
        except Exception:
            # 抛异常说明调用本身没挂起，WMI 路径是“快速失败”而非“卡死”。
            pass
        result["returned"] = True

    worker = threading.Thread(target=_call, name="wmi-health-probe", daemon=True)
    worker.start()
    worker.join(timeout)
    # 线程仍存活 => win32_ver 卡住 => WMI 损坏。
    return worker.is_alive()


def apply(force: bool = False) -> bool:
    """打上 WMI 兜底补丁。返回 True 表示已（或本次）打补丁，False 表示判定无需补丁。

    幂等：重复调用安全，只会打一次。
    """
    if getattr(platform, _SHIM_FLAG, False):
        return True

    def _fake_wmi_query(*_args, **_kwargs):
        raise OSError("platform._wmi_query disabled by MinerU WMI shim (WMI subsystem unhealthy)")

    def _fake_win32_ver(release="", version="", csd="", ptype=""):
        return _FAKE_WIN32_VER

    # 仅当 platform 暴露了 _wmi_query（Python 3.12+）时替换它。
    if hasattr(platform, "_wmi_query"):
        platform._wmi_query = _fake_wmi_query  # type: ignore[attr-defined]
    platform.win32_ver = _fake_win32_ver  # type: ignore[assignment]
    setattr(platform, _SHIM_FLAG, True)
    return True


def maybe_apply() -> None:
    """按 MINERU_WMI_SHIM 环境变量决定是否启用。失败绝不影响解释器启动。"""
    mode = os.environ.get("MINERU_WMI_SHIM", "auto").strip().lower()
    if mode == "off":
        return
    try:
        if mode == "force":
            apply(force=True)
            return
        # auto：先探针，确认坏了再打补丁，避免误伤健康机器。
        try:
            timeout = float(os.environ.get("MINERU_WMI_SHIM_PROBE_TIMEOUT", "3"))
        except ValueError:
            timeout = 3.0
        if _wmi_appears_broken(timeout):
            apply()
    except Exception:
        # 任何异常都吞掉：shim 不能成为新的启动故障源。
        pass


# 作为 sitecustomize 被自动 import 时立即生效。
maybe_apply()

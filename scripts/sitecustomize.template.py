"""venv 自动加载引导：启用 MinerU 的 WMI 兜底 shim。

⚠️ 本文件是模板。由 scripts/setup-mineru.ps1 在创建/重建 venv 后复制到
   <venv>/Lib/site-packages/sitecustomize.py。请勿直接编辑 site-packages 里的副本，
   改这里再重新运行 setup（或手动复制）。

Python 启动时（site 机制启用）会自动 import ``sitecustomize``。本文件把工程的
scripts 目录加入 sys.path，再 import 真正的 shim 实现 ``_wmi_shim``，从而让所有
用本 venv 启动的进程（含 mineru.exe / fast_api）都自动获得 WMI 兜底保护。

真相源在项目的 ``scripts/_wmi_shim.py``。
行为可用环境变量 MINERU_WMI_SHIM 控制（auto/force/off），详见 _wmi_shim.py。
"""

import os
import sys

# 本文件位于 <venv>/Lib/site-packages/sitecustomize.py。
# 工程根 = site-packages 上溯 3 层（site-packages -> Lib -> .venv -> workbench_root）。
try:
    _here = os.path.dirname(os.path.abspath(__file__))
    _workbench_root = os.path.abspath(os.path.join(_here, "..", "..", ".."))
    _scripts_dir = os.path.join(_workbench_root, "scripts")
    if os.path.isdir(_scripts_dir) and _scripts_dir not in sys.path:
        sys.path.insert(0, _scripts_dir)
    import _wmi_shim  # noqa: F401  （import 即触发 maybe_apply()）
except Exception:
    # 引导失败绝不能阻断解释器启动。
    pass

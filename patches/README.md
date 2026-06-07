# patches/ — MinerU 可选补丁

这里**不包含 MinerU 的源码**，只包含 paper2lark 对 MinerU 的一处可选 Windows 稳定性
修复，以"就地打补丁"的方式作用于用户自己安装的 MinerU。

## Windows 可视化子进程池补丁

**问题**：MinerU CLI 在 Windows 上用 spawn 子进程池生成可视化预览（layout/span PDF），
收尾 `executor.shutdown(wait=True)` 可能永久阻塞，拖死整个解析进程。

**修复**：在 `win32` 下把该子进程池换成线程池。可视化只是预览、非核心产物，对解析
结果无影响。

**应用**（在已 `pip install mineru` 的环境里）：

```bash
python patches/apply_mineru_windows_patch.py          # 应用（幂等，自动备份 .orig）
python patches/apply_mineru_windows_patch.py --check  # 只检查是否需要/已打
```

补丁脚本会定位当前环境里已安装的 `mineru/cli/client.py` 就地修改，并先备份为
`client.py.orig`。已打过会跳过。若 MinerU 版本与补丁不匹配会安全报错、不动文件。

> 注：paper2lark 还在 venv 注入了 WMI 兜底 shim（见 `scripts/_wmi_shim.py`），那是
> 另一处独立加固，不在本目录。

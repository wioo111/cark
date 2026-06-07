# paper2lark 开发进展（截至 2026-06-08）

本文件记录项目当前状态与已完成工作，供下次接续。面向开发者，不含任何凭据或本机绝对路径。

## 项目是什么

把学术论文 PDF 一键变成**中英对照的飞书（Lark）原生文档**的编排工具：
解析（MinerU）→ 阅读顺序线性化 → 双语翻译（DeepSeek）→ 推送飞书 docx，保留公式/图/表。

定位：上层编排 + 一套 Windows 稳定性加固 + 探索 **Skill Download** 安装范式。

## 当前状态：可用，端到端验证通过

soccer 论文已完整验证：解析→线性化→翻译 37 chunk→飞书原生 docx（含 16 张图），
全程无人工干预。缓存命中时再跑约 2.4s。

## 已完成的工作

### 1. 核心链路（scripts/）
- `pdf_to_feishu_docx.py`：一键总入口
- `content_list_to_feishu_docx.py` / `linearize_content_list.py` / `translate_content.py`
- `upload_md_to_feishu.py` / `upload_md_to_feishu_docx.py` / `patch_feishu_doc_images.py`
- `preflight.py`：环境体检（含 `run_quick_check()` 轻量模式供主脚本启动调用）

### 2. Windows 稳定性加固（关键，详见 README 对应章节）
- **WMI 兜底 shim**（`_wmi_shim.py` + `sitecustomize.template.py`）：绕过本机损坏的 WMI
  导致的 onnxruntime 导入卡死。auto/force/off 三档，对健康环境零影响。
- **解析 subprocess 防死锁**：日志重定向（不用管道）+ 超时 + 解析后清理孤儿 fast_api +
  以 content_list 产出为成功判据。
- **GPU 互斥锁 + 启动清场 + GPU 空闲自检 + CUDA 崩溃自动重试 1 次**：防多任务抢卡触发
  `CUBLAS_STATUS_EXECUTION_FAILED`。
- **内容级缓存（按源 PDF sha1）**：写 `runtime/output/<...>/source_pdf.sha1`，
  `locate_cached_content_list` 按 sha1 命中，ASCII 文件名也能复用（修了旧逻辑只在
  `**/uploads/*.pdf` 找、ASCII 名永不命中的 bug）。
- **翻译 chunk 重试 + 失败汇总 + 失败比例阈值报错**。
- **图片上传重试**（飞书偶发 502/网络错误指数退避）。
- **终端 GBK 打印崩溃修复**（3 处 `print(json.dumps)` 改 UTF-8 安全写出）。
- MinerU 可视化子进程池补丁抽成 `patches/apply_mineru_windows_patch.py`（就地打补丁，
  不分发其源码）。

### 3. 开源化处理
- 重命名定位为 **paper2lark**（旧名 mineru-workbench）。
- `.gitignore` 排除 `.venv` / `runtime/*` / 模型 / 缓存 / 日志 / 真实 `config/mineru.json` /
  内部调试报告。`git init` 后仅追踪 ~24 个源码与文档文件。
- `config/mineru.example.json` 用 `<REPO_ROOT>` 占位；真实 mineru.json 不提交。
- README 重写：项目定位 + Skill Download 范式说明 + 致谢与依赖（MinerU 为外部依赖、
  Hermes 为灵感来源）+ 稳定性章节 + 目录结构。
- 脚本均用 `$PSScriptRoot` / `Path(__file__)` 相对定位，无写死路径。

### 4. 环境事实（本机）
- 飞书 + DeepSeek 凭据已存入 Windows 用户级环境变量，新终端自动读。
- WMI 服务实际仍损坏（preflight 会如实报 WARN，重启电脑可彻底修；不影响解析，有 shim 兜底）。

## 待办（下次接续）

1. ~~**写 `SKILL.md`**~~ ✅ 已完成（2026-06-08）。根目录 `SKILL.md` 是 Skill Download 范式
   的核心载体，分 6 阶段（环境探测 → 安装 MinerU → 应用 Windows 补丁 → 下模型 → 配凭据 →
   体检跑通）+ 常见卡点速查表。**关键诚实点**：`scripts/setup-mineru.ps1` 硬依赖同级
   `mineru-prototype` 源码目录（`_mineru_env.ps1` 里 `MinerUSource` 写死，editable 安装
   本地 MinerU 3.2.3）——这是**开发机专用**路径；普通安装者没有该目录，SKILL.md 分支 A
   改走 PyPI `pip install "mineru[pipeline]"` + 手动建 venv + 手动复制 sitecustomize shim，
   分支 B 才用现成 setup 脚本。README 占位说明已替换为指向 SKILL.md。
2. **手动安装 fallback 文档**：为没有 agentic AI 的用户补一份纯手动步骤（部分已在 README，
   SKILL.md 的命令也可直接照抄）。
3. ~~首个 git commit~~ ✅ 已完成（commit `init: paper2lark ...`）。SKILL.md 与本次文档更新待提交。
4. 可选：把 MinerU Windows 补丁提 PR 给 opendatalab/MinerU 上游。
5. 可选：扩展输出目标（不止飞书），呼应 `paperflow` 式的通用化。
6. **设计债**：`setup-mineru.ps1` 默认假设本地源码安装，与对外 `pip install mineru` 的叙述
   不一致。理想做法是给 setup 脚本加一个 `-FromPyPI` 开关（无 `mineru-prototype` 时自动走
   PyPI），把 SKILL 分支 A 的手动步骤收进脚本，让安装者也能一条命令搞定。

## 注意事项
- 本仓库非 MinerU 的分支，**不含其源码**；用户自行 `pip install mineru`。
- venv 不可移动/改名（Python venv 特性），换位置需重建——这也是它被 gitignore 的原因。
- 产物路径有单层/双层之分：MinerU 原始产物在 `runtime/output/<stem>/<stem>/auto/`，
  线性化/翻译/ready 产物在 `runtime/output/<stem>/auto/`。

# paper2lark

把一篇学术论文 PDF，一键变成**带中英对照的飞书（Lark）原生文档**。

解析（MinerU）→ 阅读顺序线性化 → 双语翻译（DeepSeek）→ 推送为飞书 docx，
公式、图片、表格一并保留。面向需要快速做"论文导读"的研究者与团队。

## 安装方式：Skill Download（实验性范式）

本项目实践一种 AI 时代的本地软件安装范式 —— **Skill Download**：
不再分发"配置好的 exe / 压缩包"，而是把**安装与配置的方法**整理成一份
可被 AI 执行的 `SKILL.md`。你把它喂给具备命令执行能力的 AI 助手（如 Claude Code），
用自然语言说明需求，AI 会在对话中替你完成环境探测、依赖安装、模型下载、
凭据配置与跑通验证。

- **为什么这么做**：本项目依赖 MinerU + 约 14GB 模型 + GPU 环境，传统打包既臃肿又
  难适配各人的机器。把"怎么装"交给 AI 现场执行，仓库本身就能保持极轻量
  （clone 下来只有脚本和文档，不含模型、不含虚拟环境）。
- **边界（诚实说明）**：① 需要一个能执行 shell 的 agentic AI；没有的话，下面保留了
  完整的手动安装步骤作为 fallback。② 14GB 模型必须下载，这是物理现实，Skill 能做的是
  让过程无痛、可验证，而不是让它消失。

> 安装向导见仓库根目录的 [`SKILL.md`](SKILL.md)：分阶段（环境探测 → 安装 MinerU →
> 应用 Windows 补丁 → 下载模型 → 配置凭据 → 体检跑通），把它喂给具备命令执行能力的
> AI 助手即可交互式安装。没有 agentic AI 的用户，按下面"手动安装"步骤操作。

## 致谢与依赖

本项目是上层编排工具，**站在两个上游项目的肩膀上**：

- **[MinerU](https://github.com/opendatalab/MinerU)**（Apache-2.0）：负责 PDF → 结构化
  内容的解析。paper2lark 通过其命令行 `mineru` 调用它，**不修改、不分发其源码**；
  用户按提示自行 `pip install mineru`。仓库 `patches/` 下附带一个可选的 Windows
  稳定性小补丁（见该目录说明）。
- **[Hermes-academy](https://github.com/dylanshaw338-create/Hermes-academy)**：
  本项目"PDF→翻译→协作平台"整体思路上的灵感来源之一。paper2lark 未使用其代码，
  为独立实现。

paper2lark 自身的贡献在于：端到端编排、阅读顺序线性化、双语翻译、飞书原生 docx 推送，
以及一整套 Windows 环境下的稳定性加固（见下文）。

## 本地运行约定

为隔离 C 盘空间、统一管理，运行期数据默认都放在仓库内的 `runtime/`（已 gitignore）：

- 虚拟环境 `.venv`、`uv`/`pip` 缓存、`TEMP/TMP`
- Hugging Face / ModelScope 模型缓存、MinerU 模型目录
- `config/mineru.json`（由 MinerU 下载器生成，含本机绝对路径，不提交；模板见
  `config/mineru.example.json`）
- MinerU 输出目录

## 运行前健康检查（强烈建议）

跑解析前先体检一次，绿灯再跑：

```powershell
.\.venv\Scripts\python.exe .\scripts\preflight.py
```

它会检查：磁盘空间、内存/commit 余量、WMI 服务状态、WMI 兜底 shim 是否生效、
onnxruntime 能否快速导入、torch 是否 CUDA 版且 GPU 可见、有无残留 fast_api 进程。

如果体检报“commit 余量过低”或“残留 fast_api 进程”，先清理再跑：关闭占内存的程序、
结束遗留的 `python -m mineru.cli.fast_api` 进程。

## Windows 稳定性修复（重要背景）

本工程在 Windows + RTX 4060 现场踩过一串坑，已落地修复，接手者需了解：


1. **WMI 子系统损坏会让 onnxruntime 导入永久卡死。**
   这台机器的 WMI 查询会无限挂起，导致 `platform.win32_ver()` → `import onnxruntime`
   → `magika` → 整个 mineru 启动卡死（表象很像“服务起不来 / mineru.exe 不返回”，
   但根因不是内存）。修复：`scripts/_wmi_shim.py` + venv 里的 `sitecustomize.py`
   引导（由 `setup-mineru.ps1` 自动复制）。它在检测到 WMI 卡住时给 `platform` 打补丁绕过。
   - 开关：环境变量 `MINERU_WMI_SHIM`，取值 `auto`（默认，探测到坏才打）/ `force`（无条件打）/ `off`（禁用）。
   - 实测：绕过后 onnxruntime 从“卡死 60s+”变成 0.5s 导入。

2. **mineru CLI 是 client/server 架构，旧的 `subprocess.run(capture_output=True)` 会死锁。**
   `mineru.exe` 会拉起一个 `mineru.cli.fast_api`（uvicorn，run_forever）后端做解析。
   解析虽成功，但 client 退出时偶尔杀不干净后端，残留的 fast_api 继承了 stdout 管道写端
   且永不退出 → 主脚本读管道永远等不到 EOF → 卡死。`pdf_to_feishu_docx.py` 已改为：
   输出重定向到 `runtime/logs/mineru_*.log`、加超时（`MINERU_CLI_TIMEOUT`，默认 1800s）、
   解析后主动清理残留 fast_api、以 content_list 是否产出作为成功判据。

3. **Windows 子进程池不稳定。** `mineru/utils/pdf_image_tools.py` 与
   `mineru/cli/client.py`（可视化）在 Windows 下都改用线程池，避免 `ProcessPoolExecutor`
   收尾 `shutdown(wait=True)` 卡死。

4. **保守显存策略。** 主脚本默认设 `MINERU_FORCE_BATCH_RATIO=1`、`MINERU_PDF_RENDER_THREADS=1`，
   layout 推理批大小固定为 1，降低 4060 上的 CUDA OOM 概率。

## 目录说明

- `config/mineru.json`: MinerU 配置文件
- `scripts/setup-mineru.ps1`: 安装 Python 3.12、创建虚拟环境、安装 `MinerU[pipeline]`
- `scripts/download-models.ps1`: 下载 MinerU 模型并写回 `config/mineru.json`
- `scripts/run-mineru-pipeline.ps1`: 使用 `pipeline` 后端执行解析
- `runtime/`: 所有缓存、模型、输出目录

## 首次安装

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-mineru.ps1
```

## 下载模型

默认下载 `pipeline` 模型，并使用 `ModelScope` 作为模型源：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\download-models.ps1
```

如需下载更重的 VLM 模型：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\download-models.ps1 -ModelType vlm
```

## 解析 PDF

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-mineru-pipeline.ps1 `
  -InputPath "D:\path\to\paper.pdf"
```

也可以显式指定输出目录：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-mineru-pipeline.ps1 `
  -InputPath "D:\path\to\paper.pdf" `
  -OutputPath "D:\path\to\output"
```

## 当前策略

- 先安装 `pipeline` 版本，降低磁盘占用和安装复杂度
- 先验证双栏论文的阅读顺序、标题、图片和公式表现
- 如果 `pipeline` 对个别论文顺序仍不稳定，再补装 `vlm` 并做混合链路

## 顺序优化

- `scripts/linearize_content_list.py`: 基于 `content_list.json` 做轻量顺序修正
- 当前规则会优先保留 MinerU 原始阅读顺序，只额外处理首页这类常见噪声：
  - 延后页脚脚注
  - 延后 DOI/引用说明
  - 丢弃无图注的装饰性小图
  - 清理 `<sup>` 这类 HTML 标记

示例：

```powershell
.\.venv\Scripts\python.exe .\scripts\linearize_content_list.py `
  ".\runtime\output\<task-id>\<paper>\auto\<paper>_content_list.json" `
  ".\runtime\output\<task-id>\<paper>\auto\<paper>_linearized.md"
```

## 导入飞书

`scripts/upload_md_to_feishu.py` 采用下面这条链路：

- 获取 `tenant_access_token`
- 上传 Markdown 文件到云空间
- 创建 `drive/v1/import_tasks`
- 轮询导入结果并返回文档链接

需要准备以下环境变量，或在命令行显式传入：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_FOLDER_TOKEN`

先只生成适合导入的 Markdown：

```powershell
.\.venv\Scripts\python.exe .\scripts\upload_md_to_feishu.py `
  ".\runtime\output\<task-id>\<paper>\auto\<paper>_linearized.md" `
  --image-mode note `
  --prepare-only `
  --prepared-output ".\runtime\output\<task-id>\<paper>\auto\<paper>_feishu_ready.md"
```

再真正导入飞书文档：

```powershell
.\.venv\Scripts\python.exe .\scripts\upload_md_to_feishu.py `
  ".\runtime\output\<task-id>\<paper>\auto\<paper>_linearized.md" `
  --title "论文导读：Collaborative Document Editing" `
  --image-mode note
```

说明：

- `--image-mode keep`: 保留 Markdown 图片语法
- `--image-mode note`: 把本地图片改写成文本占位，最适合导入任务
- `--image-mode strip`: 删除本地图片语法，仅保留正文和图注

## 一键原生 Docx 管线

如果你已经拿到了 MinerU 的 `content_list.json`，现在推荐直接使用：

- `scripts/content_list_to_feishu_docx.py`

这条链路会自动执行：

- 线性化 `content_list.json`
- 生成中间 Markdown
- 生成适合 Feishu block 转换的 Markdown
- 创建原生飞书 `docx`
- 把 Markdown 转成 Feishu blocks 并分批写入
- 把本地图片真正上传为飞书图片块
- 可选执行少量配置驱动的文本替换

### 直接命令

```powershell
.\.venv\Scripts\python.exe .\scripts\content_list_to_feishu_docx.py `
  --content-list-json ".\runtime\output\<task-id>\<paper>\auto\<paper>_content_list.json" `
  --title "论文导读：示例标题"
```

如果只想先产出本地文件，不调用飞书 API：

```powershell
.\.venv\Scripts\python.exe .\scripts\content_list_to_feishu_docx.py `
  --content-list-json ".\runtime\output\<task-id>\<paper>\auto\<paper>_content_list.json" `
  --prepare-only
```

### 配置文件方式

先复制一份模板：

- `config/docx_pipeline.example.json`

然后执行：

```powershell
.\.venv\Scripts\python.exe .\scripts\content_list_to_feishu_docx.py `
  --config ".\config\docx_pipeline.example.json"
```

### 可选文本替换

对于某些论文，如果确实需要少量个案修补，不要改主脚本，改配置文件：

- `config/feishu_text_replacements.example.json`

当前主流程默认不做任何文档特定替换；只有显式传入 `replacements_file` 时才会应用。

## PDF 到原生 Docx 一键管线

如果你要从 PDF 直接跑到原生飞书 `docx`，现在推荐直接使用：

- `scripts/pdf_to_feishu_docx.py`

这条链路会自动执行：

- 由 Python 直接设置 MinerU 环境并调用 `mineru.exe` 解析 PDF
- 自动定位最新的 `*_content_list.json`
- 线性化 `content_list.json`
- 生成适合 Feishu block 转换的 Markdown
- 创建原生飞书 `docx`
- 分批写入 blocks
- 上传真实图片
- 可选执行配置驱动的文本替换

说明：

- 默认会优先复用同内容 PDF 的既有 MinerU 解析缓存
- 复用命中时会自动同步旧解析目录里的 `images/` 到当前输出目录
- 没有命中缓存时，才会重新调用 MinerU 做解析

### 直接命令

```powershell
.\.venv\Scripts\python.exe .\scripts\pdf_to_feishu_docx.py `
  --input-pdf "D:\path\to\paper.pdf" `
  --title "论文导读：示例标题"
```

加上 `--translate` 会在导入前用 DeepSeek 生成中英对照双语 Markdown：

```powershell
.\.venv\Scripts\python.exe .\scripts\pdf_to_feishu_docx.py `
  --input-pdf "D:\path\to\paper.pdf" `
  --title "论文导读：示例标题" `
  --translate
```

飞书与翻译的凭据已写入 Windows 用户级环境变量（`FEISHU_APP_ID` /
`FEISHU_APP_SECRET` / `FEISHU_FOLDER_TOKEN` / `OPENAI_API_KEY` / `OPENAI_BASE_URL`），
所以新开任意终端都能直接跑、无需带凭据参数。如需重设：

```powershell
[Environment]::SetEnvironmentVariable('FEISHU_APP_ID','cli_xxx','User')
```

### 配置文件方式

先复制模板：

- `config/pdf_docx_pipeline.example.json`

然后执行：

```powershell
.\.venv\Scripts\python.exe .\scripts\pdf_to_feishu_docx.py `
  --config ".\config\pdf_docx_pipeline.example.json"
```

## 目录结构与脚本职责

```
paper2lark/
├─ SKILL.md                        # 喂给 AI 的安装/配置向导（Skill Download 范式）
├─ scripts/                        # 全部业务脚本
│  ├─ pdf_to_feishu_docx.py        # 一键总入口：PDF→解析→线性化→(翻译)→飞书 docx
│  ├─ content_list_to_feishu_docx.py  # 从 content_list 起步的 docx 管线
│  ├─ linearize_content_list.py    # content_list.json → 线性化 Markdown
│  ├─ translate_content.py         # DeepSeek 双语翻译（带重试+失败汇总）
│  ├─ upload_md_to_feishu.py       # 飞书 import_task 上传（旧链路，被复用）
│  ├─ upload_md_to_feishu_docx.py  # 创建原生飞书 docx + 写 blocks + 传图
│  ├─ patch_feishu_doc_images.py   # 图片块上传 / 文本替换
│  ├─ preflight.py                 # 运行前环境体检（含轻量模式供主脚本调用）
│  ├─ _wmi_shim.py                 # WMI 兜底（见下）
│  ├─ sitecustomize.template.py    # venv 自动加载引导模板（setup 时复制）
│  ├─ _mineru_env.ps1 / setup-mineru.ps1 / download-models.ps1 / run-mineru-pipeline.ps1
│  └─ ...
├─ patches/                        # 对 MinerU 的可选 Windows 稳定性补丁（不含其源码）
├─ config/                         # 配置模板（*.example.json）
├─ docs/                           # 调试报告、根因结论、开发进展
├─ runtime/                        # 运行期数据（已 .gitignore，不提交）
│  ├─ models/ hf-home/ python/ uv-cache/ pip-cache/   # 模型与缓存
│  ├─ output/                      # 解析与产物（含 source_pdf.sha1 缓存标记）
│  ├─ logs/ tmp/ locks/ uploads/   # 日志 / 临时 / 解析锁 / 暂存
└─ README.md
```

依赖关系：`pdf_to_feishu_docx` → `content_list_to_feishu_docx` →
{`linearize_content_list`, `patch_feishu_doc_images`, `upload_md_to_feishu(_docx)`}，
翻译走 `translate_content`，环境健康由 `preflight` + `_wmi_shim` 保障。

## 稳定性与调优（Windows + RTX 4060 实践）

一键全链路已做以下加固，正常情况无需人工干预：

- **解析互斥锁**：同一时刻只允许一个 MinerU 解析（`runtime/locks/mineru_parse.lock`），
  避免多任务抢同一张 GPU 触发 `CUBLAS_STATUS_EXECUTION_FAILED`。
- **启动清场 + GPU 自检**：解析前自动清理残留 `mineru.cli.fast_api`，并等 GPU 显存回落。
- **CUDA 崩溃自动重试**：检测到 cuBLAS/CUDA error 会清场、等 GPU 后自动重试一次。
- **内容级缓存**：按源 PDF 的 sha1 命中既有解析（`source_pdf.sha1` 标记），
  同一篇论文再跑直接复用、不重解析、不碰 GPU（不再受文件名是否 ASCII 影响）。
- **翻译重试**：每个 chunk 失败按指数退避重试 3 次，仍失败退回原文并在结尾汇总；
  失败比例超阈值（默认 20%）整体报错，避免"半翻译"文档。
- **启动体检**：主脚本启动先做轻量 preflight，commit 内存不足等致命项提前拦截。

可调环境变量：

| 变量 | 默认 | 作用 |
|---|---|---|
| `MINERU_CLI_TIMEOUT` | 1800 | 单次解析超时秒数 |
| `MINERU_GPU_IDLE_MIB` | 1500 | 解析前等待 GPU 显存回落到的阈值(MiB) |
| `MINERU_WMI_SHIM` | auto | WMI 兜底：auto/force/off |
| `TRANSLATE_FAIL_RATIO_LIMIT` | 0.2 | 翻译失败比例超过则整体报错 |
| `MINERU_SKIP_PREFLIGHT` | (未设) | 设 1 跳过启动体检强制继续 |

关于 **孤儿 fast_api**：MinerU CLI 是 client/server 架构，正常跑完 client 会自动杀掉
fast_api 后端；只有 client 进程被**强制中断**（kill/Ctrl-C）时 `finally` 来不及执行，
fast_api 才会变孤儿。所以日常使用不会残留；即便残留，下次解析启动时也会自动清场。

关于 **WMI**：本机历史上 WMI 服务异常会让 onnxruntime 导入卡死，已用应用层 shim 兜底
（`_wmi_shim.py`，对健康环境零影响）。`preflight.py` 会真实探测 WMI 服务状态并提示。

运行前手动体检：

```powershell
.\.venv\Scripts\python.exe .\scripts\preflight.py
```

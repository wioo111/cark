---
name: install-paper2lark
description: >
  交互式地为用户安装并跑通 paper2lark（论文 PDF → 中英对照飞书原生文档的编排工具）。
  解析有两种后端：云 API（推荐，零模型下载、不需要 GPU，跨平台）或本地部署
  （Windows + NVIDIA GPU + 约 14GB 模型，数据不出本机）。AI 助手按本文件分阶段执行：
  环境探测 → 选后端装环境 →（本地才需）补丁/下模型 → 配置凭据 → 跑通验收。
  适用场景：用户说"帮我装一下 paper2lark / 把这个工具跑起来 / 配置这个论文转飞书工具"。
---

# SKILL：安装并跑通 paper2lark

你（AI 助手）正在帮用户把 **paper2lark** 装到他们的机器上并跑通第一篇论文。
这是一份给你执行的安装向导，不是给人读的手册。按阶段推进，每一步先**探测**
再**决策**，把判断依据讲给用户听，遇到岔路用自然语言问清楚再动手。

## 这个工具是什么（先对齐预期）

paper2lark 把一篇学术论文 PDF，一键变成**带中英对照的飞书（Lark）原生文档**：
解析（MinerU）→ 阅读顺序线性化 → 双语翻译（DeepSeek）→ 推送飞书 docx，
保留公式、图片、表格。它是**上层编排工具**，真正的 PDF 解析靠 MinerU。

**解析有两种后端，安装路径因此分叉——这是你要先和用户确认的第一件事：**

- **☁️ 云 API（`--backend cloud`，推荐，默认推荐给大多数人）**：调 MinerU 官方在线服务
  解析，**本机零模型下载、不需要 GPU**。装起来极轻（只装 `requests`）。代价：论文会
  上传到 MinerU 服务器（上海 OSS），需联网，每账号每天 2000 页额度，单文件 ≤200MB/600 页。
- **💻 本地部署（`--backend local`，默认值）**：调本机 `mineru.exe` 解析，**数据不出本机、
  可离线**。代价：要下载**约 14GB 模型**、需要 NVIDIA GPU、装起来重。适合论文敏感不能外传、
  或要批量跑很多篇的场景。

诚实的前置门槛：

1. **飞书自建应用**（拿到 App ID / Secret，授权云文档读写、给目标文件夹 token）——两种后端都需要。
   没有的话推送飞书会失败，但解析+翻译+本地产物仍可单独跑（`--prepare-only`）。
2. **OpenAI 兼容的翻译 API**（开发机用 DeepSeek：`OPENAI_API_KEY` + `OPENAI_BASE_URL`）——
   只有用 `--translate` 时才需要。两种后端都用同一个翻译服务。
3. **若选云 API**：一个 MinerU API token（在 https://mineru.net 申请）+ 能联网。**不需要 GPU、
   不需要大磁盘。**
4. **若选本地部署**：**Windows**（稳定性加固都是为 Windows 写的）+ **NVIDIA GPU（建议 ≥6GB）** +
   **磁盘 ≥20GB 空闲**（光模型 14GB）。开发验证机为 RTX 4060 Laptop。

先问清用户选哪种后端，再决定走下面哪条安装路径。拿不准就推荐云 API——门槛最低、最快见效。

---

## 阶段 0.5：续装探测（中断重来时先看装到哪了，别从头瞎装）

安装常被打断（下模型最易断网、用户关机、token 没配等）。**重新进入这个 Skill 时，先跑下面
这组只读探测，判断已经到哪一步，从断点接着做，而不是重头再来。** 全程不改任何东西。

```bash
# 在 clone 出的仓库根目录（Paper2Lark）下执行
test -d .venv && echo "✓ venv 已建" || echo "✗ venv 未建 → 从阶段 2 开始"

# venv 里装了什么后端依赖（Windows 用 .venv/Scripts/python.exe，mac/Linux 用 .venv/bin/python）
PY=.venv/Scripts/python.exe; [ -f "$PY" ] || PY=.venv/bin/python
"$PY" -c "import requests; print('✓ requests 已装（云后端就绪）')" 2>/dev/null || echo "✗ requests 未装"
"$PY" -c "import mineru; print('✓ mineru 已装（本地后端就绪）')" 2>/dev/null || echo "✗ mineru 未装（云后端不需要）"

# 凭据/ token 设了没（只看有没有，不回显值）
for v in MINERU_API_TOKEN FEISHU_APP_ID FEISHU_APP_SECRET FEISHU_FOLDER_TOKEN OPENAI_API_KEY; do
  if [ -n "${!v}" ]; then echo "✓ $v 已设"; else echo "✗ $v 未设"; fi
done

# 本地后端：模型下全了没（云后端跳过这条）
test -f config/mineru.json && echo "✓ config/mineru.json 存在（模型路径已写回）" || echo "✗ 模型未下/未配"
```

据此决策接续点：
- **venv 未建** → 用户选好后端，从阶段 2A（云）或 2B（本地）开始。
- **venv 已建、requests 已装、token 已设** → 云后端环境就绪，直接跳阶段 6 跑通。
- **venv 已建但 mineru 未装/模型未下** → 本地后端没装完，回阶段 2B / 阶段 4 续上（模型下载可续传，重跑同一命令即可）。
- **环境都就绪，只是没配飞书凭据** → 阶段 6 先用 `--prepare-only` 验证解析+翻译，配好凭据再推飞书。

> 这一步是为了**幂等**：已经装好的别重装，断在哪接哪。讲清楚现状再动手，别默默重跑耗时步骤。

---

## 阶段 0：环境探测（先看清现场，再决定怎么装）

不要假设，先跑探测。把每一项结果讲给用户。**探测内容取决于用户选了哪种后端。**

```bash
# 两种后端都要：是否有 uv（本工具用 uv 管理 Python 3.12）
uv --version 2>&1 || echo "no uv — 需先装 uv（pip install uv 或官方脚本）"

# 仅本地部署需要：GPU 与磁盘
nvidia-smi                                              # 有输出=有 N 卡；记下显存与驱动 CUDA 版本
# PowerShell: Get-PSDrive C, D | Select Name, Free      # 磁盘空闲，本地后端要 ≥20GB
```

决策：
- **没装 uv** → 两种后端都依赖 `uv` 建环境。先让用户装 uv，再继续。
- **选了云 API** → 不用管 GPU/磁盘，直接跳到「阶段 2A：云 API 安装」。
- **选了本地部署且没 N 卡** → 明确告知会退化到 CPU、极慢，问用户是否仍要继续（或改用云 API）。
- **选了本地部署且磁盘 < 20GB** → 模型下载会失败，建议腾空间、换盘，或改用云 API。

---

## 阶段 1：取得 paper2lark 仓库本体

如果用户还没 clone，先拿到仓库。仓库很轻（只有脚本+文档，不含模型/venv）。
clone 下来的目录（默认 `Paper2Lark`）就是工作根目录，下文记作 `<REPO_ROOT>`——
脚本、配置、SKILL.md 都直接在它下面，没有额外嵌套层。

```bash
git clone https://github.com/wioo111/Paper2Lark.git
cd Paper2Lark
```

之后所有命令默认在 `<REPO_ROOT>`（即 clone 出的 `Paper2Lark` 目录）下执行。

---

## 阶段 2A：云 API 安装（推荐路径，零模型下载，跨平台）

如果用户选了云 API，这一段就是全部安装步骤，**跳过阶段 2B / 3 / 4**（那些是本地部署专属）。
云后端只依赖 `requests`，**Windows / macOS / Linux 都能跑**——按用户的系统选下面对应的命令。

1. 建一个轻量 venv，**只装 `requests`**（不装 mineru、不下模型、不要 GPU）：

   Windows (PowerShell)：
   ```powershell
   uv python install 3.12
   uv venv .venv --python 3.12 --seed
   .\.venv\Scripts\pip.exe install requests
   ```

   macOS / Linux (bash)：
   ```bash
   uv python install 3.12
   uv venv .venv --python 3.12 --seed
   ./.venv/bin/pip install requests
   ```
   > 之后所有 `.\.venv\Scripts\python.exe`（Windows）在 mac/Linux 上对应
   > `./.venv/bin/python`，下文不再重复两套，按系统换 venv 路径即可。

2. 配 MinerU API token（在 https://mineru.net 申请；token 走环境变量，不要写进文件）：

   Windows (PowerShell，写入用户级、永久生效)：
   ```powershell
   [Environment]::SetEnvironmentVariable('MINERU_API_TOKEN','<用户的token>','User')
   ```
   设完让用户**新开一个终端**（用户级环境变量对已开终端不生效）。

   macOS / Linux (bash，追加到 shell 配置永久生效)：
   ```bash
   echo 'export MINERU_API_TOKEN="<用户的token>"' >> ~/.bashrc   # zsh 用 ~/.zshrc
   source ~/.bashrc
   ```

3. 直接跳到阶段 5 配飞书/翻译凭据，再到阶段 6 用 `--backend cloud` 跑通。

> 云 API 的诚实边界，安装时讲清楚：① 论文会上传到 MinerU 服务器（上海 OSS）做解析；
> ② 需联网；③ 每账号每天 2000 页额度（超出降优先级）；④ 单文件 ≤200MB、≤600 页。
> 数据敏感不能外传的论文，请改用阶段 2B 的本地部署。

---

## 阶段 2B：本地部署安装 MinerU（数据不出本机，但要下约 14GB 模型）

> 仅当用户选了本地部署时做这一段。**包很大**：约 14GB 模型 + CUDA torch，需要 GPU。
> 只图省事、论文可外传的用户，回去用阶段 2A 的云 API 更轻。

⚠️ **这是本地路径最容易踩错的一步，务必先探测再装。**

仓库自带的 `scripts/setup-mineru.ps1` 是**开发机专用**的：它假设 MinerU 源码就放在
仓库**同级目录** `<REPO_ROOT>/mineru-prototype`，用 `pip install -e` 以 editable 方式
安装本地源码（见 `scripts/_mineru_env.ps1` 里 `MinerUSource` 的定义）。**普通安装者
没有这个目录**，直接跑 setup 脚本会报 `MinerU source directory not found`。

先探测：

```bash
# 同级有没有 mineru-prototype 源码目录？
ls -d ../mineru-prototype 2>/dev/null && echo "HAS local source" || echo "NO local source — 走 PyPI"
```

### 分支 A：同级**没有** mineru-prototype（绝大多数安装者，推荐）

直接从 PyPI 装。先用 setup 脚本建好隔离的 venv 和 Python 3.12，再手动装 MinerU：

1. 创建环境（用 `-SkipTorchReinstall` 先别动 torch，下一步单独处理）。
   注意：setup 脚本最后一步会 `pip install -e mineru-prototype`，**没有该目录会失败**。
   所以分支 A 不要整段跑 setup，而是**只借用它的环境准备逻辑**——最稳妥的做法是手动建 venv：

   ```powershell
   # 用 uv 装 Python 3.12 并建 venv（路径与 setup 脚本一致：仓库内 .venv）
   uv python install 3.12
   uv venv .venv --python 3.12 --seed
   ```

2. 从 PyPI 装 MinerU 的 pipeline 套件：

   ```powershell
   .\.venv\Scripts\pip.exe install "mineru[pipeline]"
   ```

3. **装 CUDA 版 torch**（PyPI 在 Windows 常解析成 CPU-only 轮子，必须显式指定 CUDA 通道；
   通道版本对齐 `nvidia-smi` 报的 CUDA，开发机用 cu128）：

   ```powershell
   .\.venv\Scripts\pip.exe install --force-reinstall --index-url https://download.pytorch.org/whl/cu128 torch torchvision
   ```

4. **装 WMI 兜底 shim 引导**（setup 脚本会自动做这步；手动建 venv 时要补上）。
   把 `scripts/sitecustomize.template.py` 复制为 venv site-packages 下的 `sitecustomize.py`：

   ```powershell
   Copy-Item -Force .\scripts\sitecustomize.template.py .\.venv\Lib\site-packages\sitecustomize.py
   ```

   作用见阶段 5 的 WMI 说明。

### 分支 B：同级**有** mineru-prototype（开发机 / 想跑本地改过的 MinerU）

可以直接用现成脚本，它会建 venv、editable 装本地源码、按是否有 N 卡自动选 CUDA torch 通道、
并自动复制 sitecustomize shim：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-mineru.ps1
```

可选参数：`-RecreateVenv`（重建 venv）、`-SkipTorchReinstall`（不重装 torch）、
`-TorchIndexUrl <url>`（手动指定 torch 通道）。

### 两个分支都做完后：验证 MinerU 装上了

```powershell
.\.venv\Scripts\python.exe -c "import mineru.cli.client as c; print(c.__file__)"
.\.venv\Scripts\pip.exe show mineru | findstr Version
```

能打印路径和版本（开发机为 3.2.3）即成功。

---

## 阶段 3：应用 MinerU Windows 稳定性补丁（仅本地部署，可选但强烈建议）

> 云 API 用户跳过本阶段——补丁针对的是本机 mineru.exe。

MinerU CLI 在 Windows 上用 spawn 子进程池生成可视化预览，收尾 `shutdown(wait=True)`
可能永久阻塞、拖死整个解析。补丁在 `win32` 下把它换成线程池（可视化只是预览，非核心
产物，对结果无影响）。脚本幂等、自动备份 `.orig`，版本不匹配会安全报错不动文件。

```bash
# 先检查需不需要打
.\.venv\Scripts\python.exe patches/apply_mineru_windows_patch.py --check
# 应用
.\.venv\Scripts\python.exe patches/apply_mineru_windows_patch.py
```

如果 `--check` 报"未匹配到目标代码（MinerU 版本可能不同）"，说明用户装的 MinerU 版本
和补丁锚点不一致。**不要硬改**，告诉用户当前版本可能不需要此补丁，或让用户提供版本号，
你再去 `mineru/cli/client.py` 的 `create_visualization_context()` 手工核对。

---

## 阶段 4：下载 MinerU 模型（仅本地部署，约 14GB，最耗时的一步）

> 云 API 用户跳过本阶段——云端自带模型，本机不下任何模型。

默认下 `pipeline` 模型。源可选 `huggingface`（脚本默认）或 `modelscope`（国内更快）。

```powershell
# 国内建议加 -Source modelscope
powershell -ExecutionPolicy Bypass -File .\scripts\download-models.ps1 -Source modelscope
```

它内部调 `mineru-models-download.exe`，下完会把模型路径写回 `config/mineru.json`。
**前提**：venv 里已装好 MinerU（阶段 2），否则报 "Run setup-mineru.ps1 first."。

如果用户机器对 VLM 链路有需求（双栏顺序更稳但更重），再补：
`powershell -ExecutionPolicy Bypass -File .\scripts\download-models.ps1 -ModelType vlm -Source modelscope`。
默认先只装 pipeline，降复杂度和占用。

下载中断很常见（14GB）——失败就重跑同一命令，下载器会续传。

---

## 阶段 5：配置凭据（飞书 + 翻译）

凭据走**环境变量**，新终端自动读，无需带参。值由用户提供，你不要编造，也不要把密钥回显到对话里。

Windows (PowerShell，写入用户级、永久生效)：
```powershell
[Environment]::SetEnvironmentVariable('FEISHU_APP_ID','<用户的>','User')
[Environment]::SetEnvironmentVariable('FEISHU_APP_SECRET','<用户的>','User')
[Environment]::SetEnvironmentVariable('FEISHU_FOLDER_TOKEN','<用户的>','User')   # 目标文件夹 token
# 翻译（DeepSeek 等 OpenAI 兼容服务），仅 --translate 时需要
[Environment]::SetEnvironmentVariable('OPENAI_API_KEY','<用户的>','User')
[Environment]::SetEnvironmentVariable('OPENAI_BASE_URL','https://api.deepseek.com','User')
```
设完**让用户新开一个终端**（用户级环境变量对已开终端不生效）。

macOS / Linux (bash，追加到 shell 配置；zsh 改 `~/.zshrc`)：
```bash
cat >> ~/.bashrc <<'EOF'
export FEISHU_APP_ID="<用户的>"
export FEISHU_APP_SECRET="<用户的>"
export FEISHU_FOLDER_TOKEN="<用户的>"
export OPENAI_API_KEY="<用户的>"          # 翻译用，仅 --translate 时需要
export OPENAI_BASE_URL="https://api.deepseek.com"
EOF
source ~/.bashrc
```

没飞书凭据也能继续——阶段 6 用 `--prepare-only` 只产出本地文件，不碰飞书 API。
云 API 用户的 `MINERU_API_TOKEN` 也在这里一并确认已设（阶段 2A 已设过则跳过）。

### 关于 WMI shim（仅本地部署相关，了解即可）

部分 Windows 机器 WMI 子系统损坏会让 `onnxruntime` 导入永久卡死（连带 MinerU 启动卡死，
表象像"mineru.exe 不返回"，但根因不是内存）。阶段 2 复制进 venv 的 `sitecustomize.py`
会在检测到 WMI 卡住时给 `platform` 打补丁绕过。开关是环境变量 `MINERU_WMI_SHIM`：
`auto`（默认，探测到坏才打）/ `force` / `off`。健康机器零影响，无需手动设。

---

## 阶段 6：体检 + 跑通第一篇（验收）

### 先体检（仅本地部署）

云 API 用户跳过——preflight 查的是本机 GPU/模型/WMI，对云后端无意义。

```powershell
.\.venv\Scripts\python.exe .\scripts\preflight.py
```

它查：磁盘、内存/commit 余量、WMI 服务、shim 是否生效、onnxruntime 能否快导入、
torch 是否 CUDA 版且 GPU 可见、有无残留 fast_api 进程。退出码 0=可跑（可能带警告），
1=有致命项。看到这些要先处理再跑：
- **commit 余量 < 2GB**：CUDA DLL 加载易触发 WinError 1455。关掉占内存的程序再跑。
- **残留 fast_api 进程**：启动解析时会自动清场，一般不用管；不放心就先结束 `python -m mineru.cli.fast_api`。
- **WMI 损坏但 shim 已生效**：解析不受影响，是 WARN 不是 FAIL，可继续；彻底修复需重启电脑。
- **torch CUDA 不可用**：回到阶段 2B 第 3 步重装 CUDA 版 torch。

### 跑通第一篇（端到端验收）

先用 `--prepare-only` 跑一遍只出本地产物，确认解析+线性化+翻译链路通，再开飞书推送。

**云 API（推荐）**：加 `--backend cloud`，可选 `--model-version vlm`（更全，多识别图表）：

```powershell
.\.venv\Scripts\python.exe .\scripts\pdf_to_feishu_docx.py `
  --input-pdf "D:\path\to\paper.pdf" `
  --title "论文导读：示例标题" `
  --backend cloud --model-version vlm `
  --translate --prepare-only
```
（token 已在阶段 2A 写进 `MINERU_API_TOKEN`，无需带参；也可显式 `--api-token`。
mac/Linux 把 `.\.venv\Scripts\python.exe` 换成 `./.venv/bin/python`、续行符 `` ` `` 换成 `\`、
路径用正斜杠即可。）

**本地部署**：不加 `--backend` 即默认 local：

```powershell
.\.venv\Scripts\python.exe .\scripts\pdf_to_feishu_docx.py `
  --input-pdf "D:\path\to\paper.pdf" `
  --title "论文导读：示例标题" `
  --translate --prepare-only
```

产物路径（找翻译/双语产物去 `auto` 目录）：
- 云 API：产物都在 `<mineru-output-dir>/auto/`（content_list、images、各 md 同层）。
- 本地：MinerU 原始产物在 `runtime/output/<stem>/<stem>/auto/`；线性化/翻译/ready 产物在
  单层 `runtime/output/<stem>/auto/`（`<stem>_linearized.md`、`_bilingual.md`、`_feishu_docx_ready.md`）。

确认双语 md 中英逐段对照、公式（行内 `$...$` 格式）保留后，去掉 `--prepare-only` 真正推送飞书
（命令同上，删掉 `--prepare-only`）。

成功标志：命令打印出飞书文档链接，文档里有正文、图片块、公式。同一篇 PDF 再跑会命中
内容级缓存（按源 PDF sha1），秒过、不重解析；云 API 命中缓存还能省每日额度。

---

## 收尾：把结果讲清楚

装完跟用户确认这几件事，作为交付清单：
- **云 API**：venv 只装了 `requests`，`MINERU_API_TOKEN` 已配，第一篇用 `--backend cloud` 跑通。
- **本地**：MinerU + CUDA torch 已装、模型已下、`preflight.py` 绿灯，第一篇 `--backend local` 跑通。
- 第一篇论文已端到端跑通（给出飞书文档链接或本地双语产物路径）。
- 凭据已写入用户级环境变量，以后新终端直接 `pdf_to_feishu_docx.py --input-pdf ... --translate`
  （加不加 `--backend cloud` 取决于用哪种后端）。
- 提醒可调环境变量（云 API 也用 `MINERU_CLI_TIMEOUT` 控制轮询超时、`MINERU_API_TOKEN` 存 token；
  本地另有 `MINERU_GPU_IDLE_MIB` / `MINERU_WMI_SHIM` / `TRANSLATE_FAIL_RATIO_LIMIT` /
  `MINERU_SKIP_PREFLIGHT`），细节见 README「稳定性与调优」。

## 常见卡点速查

| 现象 | 根因 | 处理 |
|---|---|---|
| 云 API 报"需要 MinerU API token" | 没配 `MINERU_API_TOKEN` 或没新开终端 | 阶段 2A 设环境变量后重开终端，或带 `--api-token` |
| 云 API 报文件超限 | 单文件 >200MB 或 >600 页 | 拆分 PDF，或改用本地后端 |
| `MinerU source directory not found` | 本地：跑了 setup 脚本但同级没有 `mineru-prototype` | 走阶段 2B 分支 A，从 PyPI 装 |
| `import mineru` 卡很久 / mineru.exe 不返回 | 本地：WMI 损坏让 onnxruntime 导入卡死 | 确认 venv 有 `sitecustomize.py`、`MINERU_WMI_SHIM` 未关；彻底修复重启电脑 |
| torch 装成 CPU 版，CUDA 不可用 | 本地：PyPI 在 Win 默认给 CPU 轮子 | 用 `--index-url https://download.pytorch.org/whl/cu128` 强装 |
| `mineru-models-download` 报 "Run setup first" | 本地：venv 没装好 MinerU | 回阶段 2B |
| 解析报 `CUBLAS_STATUS_EXECUTION_FAILED` | 多任务抢同一张卡 | 工具自带解析互斥锁+自动重试 1 次；别同时开多个解析 |
| 飞书推送失败 | 凭据没设/没新开终端/应用没授权云文档 | 阶段 5；先 `--prepare-only` 验证非飞书环节 |
| 找不到双语 md | 找错层级（去了双层 auto） | 翻译产物在**单层** `runtime/output/<stem>/auto/` |

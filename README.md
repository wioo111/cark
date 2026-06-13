# cark

把论文变成可继续阅读、批注和沉淀的本地工作台。

`cark` 把上传、解析、翻译、阅读、批注和沉淀收进同一个工作台。

- 上传 PDF
- 透明查看解析进度
- 配置 MinerU、翻译模型和扩展能力
- 在本地阅读器里继续读、标、评、沉淀

## 核心体验

- 首页直接拖拽上传 PDF
- 任务过程实时可见，知道它现在做到哪一步
- 设置页里集中管理 MinerU、翻译模型和扩展能力
- 阅读页支持整页滚动、浮动目录和句子级批注
- 评论线程支持回复、编辑、删除、归档和正文标记
- 所有主流程都围绕本地阅读与沉淀展开

## 为什么做它

- 读论文的过程常常被切碎在终端、网页、文档平台和脚本之间
- 解析完成之后，真正有价值的是继续阅读、批注和沉淀
- `cark` 想把这条链路收回本地，让“处理论文”和“消化论文”发生在一个地方

## 适合谁

- 想把论文长期留在本地工作台里继续处理的人
- 想把“解析、翻译、阅读、批注、沉淀”收进一个界面的人
- 不想在终端、网页和脚本之间来回跳的人

## GUI 里的几个关键术语

这些词会保留在设置页里，每个词都对应一个明确选择。

### 解析后端

- `local`：在你自己的机器上解析 PDF
- `cloud`：把 PDF 发到 MinerU 云端解析
- 重隐私、想离线：选 `local`
- 想省本地依赖、先快速跑通：选 `cloud`

### 解析模式

- `auto`：系统自动判断
- `txt`：适合原生文字型 PDF
- `ocr`：适合扫描件、截图件、影印件
- 不确定就用 `auto`
- 明确是电子原稿就用 `txt`
- 明显是扫描版就用 `ocr`

### 云模型版本

- `pipeline`：标准方案，默认优先
- `vlm`：增强视觉方案，适合复杂版面
- 先用 `pipeline`
- 复杂图表、复杂排版识别差时再试 `vlm`

## 快速开始

### 方式一：直接启动 GUI

```powershell
git clone https://github.com/wioo111/Paper2Lark.git
cd Paper2Lark
powershell -ExecutionPolicy Bypass -File .\install.ps1
cark gui
```

启动后会打开本地工作台，默认地址：

```text
http://127.0.0.1:8765
```

### 也可以继续用 CLI

CLI 适合批处理、调试和自动化。

```powershell
# 环境体检
cark doctor

# 启动 GUI
cark gui

# 直接处理一篇 PDF
cark upload "D:\path\to\paper.pdf" --backend cloud --translate

# 从已有 content_list.json 继续生成 docx
cark docx ".\runtime\output\<task-id>\<paper>\auto\<paper>_content_list.json"
```

## 技术取向

这个项目有几个明确立场：

- **GUI-first**：普通用户主流程都应该在 GUI 完成
- **CLI still matters**：CLI 继续服务批处理、调试和自动化
- **local-first**：优先保证本地可读、可控、可沉淀
- **透明处理**：上传后能看到过程，不用只等结果
- **本地优先**：上传、处理、阅读和沉淀都先在本地完成

## 当前阶段

它已经是一套能跑起来的本地论文工作台。

已完成的重点：

- GUI 上传与实时任务面板
- GUI 全局设置与连接测试
- 句子级批注阅读器
- MinerU 本地 / 云端双后端接入
- 翻译与扩展导出链路已接通

还会继续推进的方向：的连接测试

- 更强的共读与沉淀能力


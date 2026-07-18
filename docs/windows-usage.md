# cark Windows Usage Guide

This guide is for setting up, checking, demoing, and troubleshooting cark on Windows.

## Requirements

- Windows 10 or Windows 11
- PowerShell
- Git
- `uv` for Python environment setup
- Node.js 22.12 or newer for the GUI build
- Optional: NVIDIA GPU for local MinerU parsing
- Optional: MinerU cloud token, translation key, and Copilot agent key

## Install

```powershell
git clone https://github.com/wioo111/cark.git cark
cd cark
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer creates `.venv`, installs the Python package, installs GUI dependencies, builds the GUI, and adds `.venv\Scripts` to the user `PATH` unless `-SkipPathUpdate` is passed.

If the installer updates `PATH`, reopen PowerShell before running `cark`.

## First Check

Run the environment doctor first:

```powershell
cark doctor
```

The default doctor profile checks whether the GUI, demo, cloud parsing path, and local runtime are ready. It checks disk space, memory/commit headroom, WMI behavior, local parser imports, residual MinerU processes, GUI build output, demo smoke scripts, and runtime writability.

Missing `onnxruntime` or `torch` is a warning in the default profile because the no-key demo and cloud parsing can still run without local MinerU parsing.

Before using local MinerU parsing, run the strict local parser profile:

```powershell
cark doctor --profile local
```

Warnings do not always block usage. Fatal items in the strict local profile should be fixed before local parsing.

## Run The Demo

The demo does not need MinerU or API keys:

```powershell
cark demo
```

It creates an isolated runtime under `runtime/demo-smoke` with a mock paper, annotation, agent comment, candidate memory, activated memory, search index, and Markdown export.

Open the demo in the GUI:

```powershell
cark demo --gui
```

Reuse an existing demo runtime without resetting it:

```powershell
cark demo --gui --no-reset
```

Use a custom demo runtime:

```powershell
cark demo --runtime-root "D:\cark-demo-runtime" --force-reset
```

## Start The Workbench

```powershell
cark gui
```

The default address is:

```text
http://127.0.0.1:8765
```

Use a different port if `8765` is busy:

```powershell
cark gui --port 18765
```

Use a separate runtime for testing:

```powershell
cark gui --runtime-root "D:\cark-test-runtime"
```

## Process A Real Paper

From the GUI, open settings and choose a parser backend:

- `local`: keeps parsing on this computer; requires MinerU dependencies.
- `cloud`: sends the PDF to MinerU cloud; requires a cloud token.

From the CLI:

```powershell
cark upload "D:\papers\example.pdf" --backend cloud
```

Enable translation only after configuring the translation API key, Base URL, and model.

## Copilot Agents

Open settings and configure each agent with:

- name
- purpose description
- role prompt
- API key
- Base URL
- model

Enabled agents with missing required fields are not saved as usable agents. Use "Test agent" in settings before relying on Copilot in a recording or demo.

## Runtime Data

Local data lives under `runtime/` by default:

```text
runtime/cark.sqlite3
runtime/output/
runtime/uploads/gui/
runtime/memory/
runtime/demo-smoke/
```

These files are local working data and should not be committed.

## Troubleshooting

If PowerShell blocks scripts:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

If `cark` is not found after install, reopen PowerShell or run:

```powershell
.\.venv\Scripts\cark.exe --help
```

If `cark doctor` reports low commit memory, close large applications and retry. Low commit headroom can cause CUDA DLL loading failures such as `WinError 1455`.

If WMI is stuck, local parsing can still work through the shim, but Windows tools such as Task Manager or `Get-CimInstance` may hang. Rebooting Windows is the clean fix.

If the GUI does not open, check the terminal output for the local address and open it manually. If the port is busy, use `cark gui --port 18765`.

If demo reset fails because the runtime is in use, close the demo GUI and run:

```powershell
cark demo --force-reset
```

If local parsing is not available, switch to cloud parsing in settings, rerun the MinerU setup script, or verify with `cark doctor --profile local`.

## Developer Quality Gate

Before handing off a change:

```powershell
cd gui
npm run lint
npm test
npm run build

cd ..
python -m compileall -q cli.py scripts
cark doctor
cark demo
git diff --check
```

`npm test` also runs the Python unit tests through the GUI package script.

## Demo Recording Checklist

1. Run `cark doctor`.
2. Run `cark demo`.
3. Start `cark demo --gui --no-reset`.
4. Open the demo paper.
5. Show the annotation, agent comment, candidate memory, activated memory, search result, and Markdown export.
6. Open settings and show the agent connection test state.

For a local parsing recording, run `cark doctor --profile local` before uploading a real PDF.

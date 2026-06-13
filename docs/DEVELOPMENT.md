# Development

## Prerequisites

- Windows PowerShell
- Python 3.12
- Node.js 22.12 or newer
- `uv`

## Install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer creates the Python environment, installs frontend dependencies, and builds `gui/dist`. Use `-SkipGuiBuild` only when you intentionally want a Python-only setup.

Create local configuration from templates when needed:

```powershell
cark config init --profile all
```

`config/mineru.json` contains machine-specific model paths and is intentionally ignored.

## Run

```powershell
cark gui
```

Frontend-only development:

```powershell
Set-Location .\gui
npm run dev
```

## Verify

```powershell
Set-Location .\gui
npm run lint
npm test
npm run build

Set-Location ..
python -m compileall -q cli.py scripts
```

## Branch policy

- `main` is always the current product branch.
- Feature branches are short-lived and should use a descriptive prefix such as `codex/agent-backend`.
- Delete feature branches after merge.
- Do not keep a parallel `master` branch.

## Generated files

The following are local only:

- `.venv/`
- `gui/node_modules/`
- `gui/dist/`
- `runtime/`
- `config/mineru.json`
- `config/gui_settings.json`
- Python caches and package metadata

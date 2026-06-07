param(
    [switch]$RecreateVenv,
    [string]$IndexUrl = "https://pypi.org/simple",
    [string]$TorchIndexUrl = "",
    [switch]$SkipTorchReinstall
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_mineru_env.ps1")
$paths = Set-MineruWorkbenchEnv -ModelSource "modelscope"

if (-not (Test-Path (Join-Path $paths.MinerUSource "pyproject.toml"))) {
    throw "MinerU source directory not found: $($paths.MinerUSource)"
}

if ($RecreateVenv -and (Test-Path $paths.VenvPath)) {
    Remove-Item -Recurse -Force $paths.VenvPath
}

Write-Host "Installing Python 3.12 to $($paths.PythonInstall)"
uv python install 3.12 --install-dir $paths.PythonInstall --cache-dir $paths.UvCache

Write-Host "Creating virtual environment at $($paths.VenvPath)"
if (Test-Path $paths.VenvPath) {
    if ($RecreateVenv) {
        uv venv $paths.VenvPath --python 3.12 --managed-python --seed --cache-dir $paths.UvCache --clear
    }
    else {
        uv venv $paths.VenvPath --python 3.12 --managed-python --seed --cache-dir $paths.UvCache --allow-existing
    }
}
else {
    uv venv $paths.VenvPath --python 3.12 --managed-python --seed --cache-dir $paths.UvCache
}

$pipExe = Join-Path $paths.VenvPath "Scripts\pip.exe"
if (-not (Test-Path $pipExe)) {
    throw "Virtual environment pip not found: $pipExe"
}

Write-Host "Installing MinerU pipeline dependencies from $($paths.MinerUSource)"
& $pipExe install --index-url $IndexUrl -e "$($paths.MinerUSource)[pipeline]"

$hasNvidiaGpu = $false
try {
    & nvidia-smi | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $hasNvidiaGpu = $true
    }
}
catch {
    $hasNvidiaGpu = $false
}

$resolvedTorchIndexUrl = $TorchIndexUrl
if (-not $resolvedTorchIndexUrl -and $hasNvidiaGpu) {
    # PyPI commonly resolves to CPU-only wheels on Windows; prefer the CUDA channel when an NVIDIA GPU is present.
    $resolvedTorchIndexUrl = "https://download.pytorch.org/whl/cu128"
}

if (-not $SkipTorchReinstall -and $resolvedTorchIndexUrl) {
    Write-Host "Reinstalling torch/torchvision from $resolvedTorchIndexUrl"
    & $pipExe install --force-reinstall --index-url $resolvedTorchIndexUrl torch torchvision
}

# 安装 WMI 兜底 shim 引导：把 sitecustomize 模板复制进 venv 的 site-packages，
# 使 mineru.exe / fast_api 等子进程在 WMI 损坏的机器上也能正常启动。
# 详见 scripts/_wmi_shim.py。重建 venv 会清掉 site-packages，故每次 setup 都复制。
$siteCustomizeTemplate = Join-Path $PSScriptRoot "sitecustomize.template.py"
if (Test-Path $siteCustomizeTemplate) {
    $sitePackages = Join-Path $paths.VenvPath "Lib\site-packages"
    if (Test-Path $sitePackages) {
        Copy-Item -Force $siteCustomizeTemplate (Join-Path $sitePackages "sitecustomize.py")
        Write-Host "Installed WMI fallback shim bootstrap -> $sitePackages\sitecustomize.py"
    }
}

Write-Host ""
Write-Host "Setup complete."
Write-Host "Config file:  $($paths.ConfigFile)"
Write-Host "HF cache:     $($paths.HfHome)"
Write-Host "ModelScope:   $($paths.ModelScopeCache)"
Write-Host "Venv:         $($paths.VenvPath)"
Write-Host ""
Write-Host "Next step:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$($paths.WorkbenchRoot)\scripts\download-models.ps1`""

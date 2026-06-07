Set-StrictMode -Version Latest

function Get-MineruWorkbenchPaths {
    $workbenchRoot = Split-Path -Parent $PSScriptRoot
    $repoRoot = Split-Path -Parent $workbenchRoot
    $runtimeRoot = Join-Path $workbenchRoot "runtime"
    $hfHome = Join-Path $runtimeRoot "hf-home"

    return [ordered]@{
        WorkbenchRoot   = $workbenchRoot
        MinerUSource    = Join-Path $repoRoot "mineru-prototype"
        RuntimeRoot     = $runtimeRoot
        ConfigFile      = Join-Path $workbenchRoot "config\mineru.json"
        VenvPath        = Join-Path $workbenchRoot ".venv"
        PythonInstall   = Join-Path $runtimeRoot "python"
        UvCache         = Join-Path $runtimeRoot "uv-cache"
        PipCache        = Join-Path $runtimeRoot "pip-cache"
        HfHome          = $hfHome
        HfHubCache      = Join-Path $hfHome "hub"
        HfAssetsCache   = Join-Path $hfHome "assets"
        ModelScopeCache = Join-Path $runtimeRoot "modelscope-cache"
         TempRoot        = Join-Path $runtimeRoot "tmp"
        OutputRoot      = Join-Path $runtimeRoot "output"
        PipelineLocal   = Join-Path $runtimeRoot "models\pipeline"
        VlmLocal        = Join-Path $runtimeRoot "models\vlm"
    }
}

function Initialize-MineruWorkbenchDirectories {
    param(
        [hashtable]$Paths
    )

    $dirs = @(
        $Paths.WorkbenchRoot,
        $Paths.RuntimeRoot,
        (Split-Path -Parent $Paths.ConfigFile),
        $Paths.PythonInstall,
        $Paths.UvCache,
        $Paths.PipCache,
        $Paths.HfHome,
        $Paths.HfHubCache,
        $Paths.HfAssetsCache,
        $Paths.ModelScopeCache,
         $Paths.TempRoot,
        $Paths.OutputRoot,
        $Paths.PipelineLocal,
        $Paths.VlmLocal
    )

    foreach ($dir in $dirs) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
}

function Set-MineruWorkbenchEnv {
    param(
        [ValidateSet("local", "modelscope", "huggingface")]
        [string]$ModelSource = "local"
    )

    $paths = Get-MineruWorkbenchPaths
    Initialize-MineruWorkbenchDirectories -Paths $paths

    $env:UV_CACHE_DIR = $paths.UvCache
    $env:UV_PYTHON_INSTALL_DIR = $paths.PythonInstall
    $env:PIP_CACHE_DIR = $paths.PipCache
    $env:HF_HOME = $paths.HfHome
    $env:HF_HUB_CACHE = $paths.HfHubCache
    $env:HF_ASSETS_CACHE = $paths.HfAssetsCache
    $env:MODELSCOPE_CACHE = $paths.ModelScopeCache
     $env:TEMP = $paths.TempRoot
     $env:TMP = $paths.TempRoot
    $env:MINERU_TOOLS_CONFIG_JSON = $paths.ConfigFile
    $env:MINERU_API_OUTPUT_ROOT = $paths.OutputRoot
    $env:MINERU_MODEL_SOURCE = $ModelSource
    $env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
    $env:UV_LINK_MODE = "copy"

    return $paths
}

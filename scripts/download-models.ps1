param(
    [ValidateSet("pipeline", "vlm", "all")]
    [string]$ModelType = "pipeline",
    [ValidateSet("modelscope", "huggingface")]
    [string]$Source = "huggingface"
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_mineru_env.ps1")
$paths = Set-MineruWorkbenchEnv -ModelSource $Source

$mineruDownload = Join-Path $paths.VenvPath "Scripts\mineru-models-download.exe"
if (-not (Test-Path $mineruDownload)) {
    throw "Run setup-mineru.ps1 first."
}

Write-Host "Start downloading MinerU models"
Write-Host "Source: $Source"
Write-Host "ModelType: $ModelType"
Write-Host "Config: $($paths.ConfigFile)"
Write-Host ""

& $mineruDownload --source $Source --model_type $ModelType

Write-Host ""
Write-Host "Download finished"
Write-Host "Config file:"
Write-Host $paths.ConfigFile
Write-Host "Next step:"
Write-Host "  cark upload <paper.pdf> --backend local --prepare-only"

param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [string]$OutputPath,

    [ValidateSet("auto", "txt", "ocr")]
    [string]$Method = "auto"
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_mineru_env.ps1")
$paths = Set-MineruWorkbenchEnv -ModelSource "local"

$mineruExe = Join-Path $paths.VenvPath "Scripts\mineru.exe"
if (-not (Test-Path $mineruExe)) {
    throw "Run setup-mineru.ps1 first."
}

if (-not $OutputPath) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($InputPath)
    $OutputPath = Join-Path $paths.OutputRoot $baseName
}

if (-not (Test-Path $InputPath)) {
    throw "Input file not found: $InputPath"
}

New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null

Write-Host "Running MinerU pipeline backend..."
Write-Host "Input:       $InputPath"
Write-Host "Output:      $OutputPath"
Write-Host "Config file: $($paths.ConfigFile)"
Write-Host "Model mode:  local"
Write-Host ""

& $mineruExe -p $InputPath -o $OutputPath -b pipeline -m $Method

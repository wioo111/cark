[CmdletBinding()]
param(
    [string]$RuntimeRoot = "",
    [switch]$NoReset,
    [switch]$ForceReset
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "smoke_demo.py"
$python = if ($env:PYTHON) { $env:PYTHON } else { "python" }

$arguments = @($scriptPath)
if ($RuntimeRoot) {
    $arguments += @("--runtime-root", $RuntimeRoot)
}
if ($NoReset) {
    $arguments += "--no-reset"
}
if ($ForceReset) {
    $arguments += "--force-reset"
}

& $python @arguments
exit $LASTEXITCODE

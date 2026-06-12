param(
    [switch]$SkipPathUpdate
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$VenvPip = Join-Path $RepoRoot ".venv\Scripts\pip.exe"
$VenvScripts = Join-Path $RepoRoot ".venv\Scripts"

function Ensure-Command {
    param(
        [string]$CommandName,
        [string]$InstallHint
    )

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Missing command: $CommandName. $InstallHint"
    }
}

Ensure-Command -CommandName "uv" -InstallHint "Please install uv first."

Push-Location $RepoRoot
try {
    if (-not (Test-Path $VenvPython)) {
        uv python install 3.12
        uv venv .venv --python 3.12 --seed
    }

    & $VenvPip install -e .

    if (-not $SkipPathUpdate) {
        $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $pathEntries = @()
        if ($currentUserPath) {
            $pathEntries = $currentUserPath.Split(";") | Where-Object { $_ -and $_.Trim() }
        }

        if ($pathEntries -notcontains $VenvScripts) {
            if ($currentUserPath) {
                $newUserPath = "$currentUserPath;$VenvScripts"
            }
            else {
                $newUserPath = $VenvScripts
            }
            [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
            Write-Host "Added $VenvScripts to user PATH. Reopen terminal and run cark."
        } else {
            Write-Host "User PATH already contains $VenvScripts."
        }
    }

    Write-Host "`n[Success] Installation completed."
    Write-Host "You can now run it using the 'cark' command."
    Write-Host "Try running:"
    Write-Host "  cark --help"
}
finally {
    Pop-Location
}

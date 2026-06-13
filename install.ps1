param(
    [switch]$SkipPathUpdate,
    [switch]$SkipGuiBuild
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
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
if (-not $SkipGuiBuild) {
    Ensure-Command -CommandName "npm" -InstallHint "Please install Node.js 22.12 or newer first."
}

Push-Location $RepoRoot
try {
    if (-not (Test-Path $VenvPython)) {
        uv python install 3.12
        uv venv .venv --python 3.12 --seed
    }

    & $VenvPython -m pip install -e .
    if ($LASTEXITCODE -ne 0) {
        throw "Python package installation failed."
    }

    if (-not $SkipGuiBuild) {
        Push-Location (Join-Path $RepoRoot "gui")
        try {
            & npm ci
            if ($LASTEXITCODE -ne 0) {
                throw "Frontend dependency installation failed."
            }

            & npm run build
            if ($LASTEXITCODE -ne 0) {
                throw "Frontend build failed."
            }
        }
        finally {
            Pop-Location
        }
    }

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

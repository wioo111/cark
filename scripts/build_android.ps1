$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$guiRoot = Join-Path $repoRoot "gui"
$androidRoot = Join-Path $guiRoot "android"

$javaCandidates = @(
    $env:JAVA_HOME,
    "C:\Program Files\Android\Android Studio\jbr"
) | Where-Object { $_ -and (Test-Path (Join-Path $_ "bin\java.exe")) }

if (-not $javaCandidates) {
    throw "JDK not found. Install Android Studio or set JAVA_HOME."
}

$sdkCandidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA "Android\Sdk")
) | Where-Object { $_ -and (Test-Path (Join-Path $_ "platforms")) }

if (-not $sdkCandidates) {
    throw "Android SDK not found. Install Android SDK Platform 36 in Android Studio."
}

$env:JAVA_HOME = @($javaCandidates)[0]
$env:ANDROID_HOME = @($sdkCandidates)[0]
$env:ANDROID_SDK_ROOT = @($sdkCandidates)[0]
$env:PATH = "$(Join-Path $env:JAVA_HOME 'bin');$(Join-Path $env:ANDROID_HOME 'platform-tools');$env:PATH"

Push-Location $guiRoot
try {
    npm run android:sync
    if ($LASTEXITCODE -ne 0) { throw "Web asset sync failed." }

    Push-Location $androidRoot
    try {
        & .\gradlew.bat assembleDebug
        if ($LASTEXITCODE -ne 0) { throw "Android APK build failed." }
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}

$apkPath = Join-Path $androidRoot "app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apkPath)) {
    throw "APK was not found after the build: $apkPath"
}

Write-Output "APK: $apkPath"

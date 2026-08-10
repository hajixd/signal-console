param(
  [string]$TaskName = "Korra MT5 Credential Bridge"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Copy .env.example to .env and set MT5_BRIDGE_SECRET and MT5_PATH first."
}

$secretConfigured = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*MT5_BRIDGE_SECRET\s*=\s*.+$' }
if (-not $secretConfigured) {
  throw "MT5_BRIDGE_SECRET must be set in bridges\mt5\.env."
}

$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
  python -m venv .venv
}
& $venvPython -m pip install --disable-pip-version-check -r .\requirements.txt

$runPath = Join-Path $PSScriptRoot "run.ps1"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -Action $action `
  -Description "Runs the secure Korra website-to-MT5 credential execution service." `
  -Force `
  -Principal $principal `
  -Settings $settings `
  -TaskName $TaskName `
  -Trigger $trigger | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Output "Installed and started '$TaskName'."
Write-Output "The bridge is available locally at http://127.0.0.1:8787/health."

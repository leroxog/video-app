<#
.SYNOPSIS
  Hard network boundary for the ysound model: Windows Firewall rules that stop the model's Python from
  reaching the internet or your home network. Only 127.0.0.1 / ::1 (this computer itself) stays reachable.

.DESCRIPTION
  serve_model.py already keeps the model off the network from the inside (netguard.py). That is a safety
  net, not a wall. This script builds the wall at the operating-system level: two outbound BLOCK rules,
  one for the model environment's python.exe and one for the base python.exe it starts. It changes
  nothing else, and -Remove deletes exactly these rules again.

  The song computer's worker must use a DIFFERENT Python than the model (otherwise the rule would block
  the worker, too). The setup in README.md installs the model with its own uv-managed Python for this.

  Run once, as Administrator (right-click PowerShell -> Run as administrator):
      powershell -ExecutionPolicy Bypass -File harden.ps1
  Undo:
      powershell -ExecutionPolicy Bypass -File harden.ps1 -Remove
#>
#Requires -RunAsAdministrator
param(
    [string]$AceDir = (Join-Path $env:USERPROFILE "ysound-ai\ACE-Step-1.5"),
    [switch]$Remove
)
$ErrorActionPreference = "Stop"
$RulePrefix = "ysound-model-no-network"

if ($Remove) {
    Get-NetFirewallRule -DisplayName "$RulePrefix*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host "Removed all '$RulePrefix*' firewall rules."
    return
}

$venvPython = Join-Path $AceDir ".venv\Scripts\python.exe"
$cfg = Join-Path $AceDir ".venv\pyvenv.cfg"
if (-not (Test-Path $venvPython) -or -not (Test-Path $cfg)) { throw "Model environment not found: $venvPython" }
$homeLine = Get-Content $cfg | Where-Object { $_ -match '^\s*home\s*=' } | Select-Object -First 1
$basePython = Join-Path (($homeLine -split '=', 2)[1].Trim()) "python.exe"
if (-not (Test-Path $basePython)) { throw "Base Python not found: $basePython" }

$systemPython = (Get-Command python -ErrorAction SilentlyContinue).Source
if ($systemPython -and ((Resolve-Path $systemPython).Path -eq (Resolve-Path $basePython).Path)) {
    throw "The model uses the same python.exe as your normal 'python' ($basePython). Blocking it would block the worker too. Recreate the model environment with a uv-managed Python first (see README.md)."
}

# Everything except this computer itself (127.0.0.0/8 and ::1).
$remote = @("0.0.0.0-126.255.255.255", "128.0.0.0-255.255.255.255", "::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")
foreach ($program in @($venvPython, $basePython)) {
    $name = "$RulePrefix ($(Split-Path $program -Leaf) in $(Split-Path (Split-Path $program -Parent) -Leaf))"
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $name -Direction Outbound -Action Block -Program $program `
        -RemoteAddress $remote -Profile Any -Description "ysound: the AI model must never reach the network" | Out-Null
    Write-Host "Blocked outbound network for: $program"
}

# Prove it: the model's Python must NOT reach the internet, but must still reach itself.
$test = 'import socket,sys,threading
s=socket.socket(); s.bind(("127.0.0.1",0)); s.listen(1); port=s.getsockname()[1]
threading.Thread(target=lambda: s.accept(), daemon=True).start()
socket.create_connection(("127.0.0.1",port),timeout=3).close()
print("loopback: ok")
try:
    socket.create_connection(("1.1.1.1",443),timeout=5).close()
    print("internet: REACHABLE (the firewall rule does NOT work)"); sys.exit(2)
except OSError:
    print("internet: blocked (good)")'
& $venvPython -c $test
if ($LASTEXITCODE -ne 0) { throw "Self-test failed -- the rules are in place but did not block the model's Python. Check README.md." }
Write-Host "Done. The model can talk to this computer only."

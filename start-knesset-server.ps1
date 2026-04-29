param(
  [int]$Port = 3011
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\Program Files\nodejs\node.exe"
$psi.Arguments = "src/server.js"
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$env:PORT = [string]$Port

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi

if (-not $process.Start()) {
  throw "Failed to start the Knesset server process."
}

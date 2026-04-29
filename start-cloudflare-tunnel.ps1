$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\Program Files\nodejs\node.exe"
$psi.Arguments = "src/scripts/cloudflare-quick-tunnel.js"
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi

if (-not $process.Start()) {
  throw "Failed to start the Cloudflare tunnel launcher."
}

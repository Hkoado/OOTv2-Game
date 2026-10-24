param(
  [string]$ConfigPath,
  [string]$Name
)
# Read-only host/guest view. Uses worker.local.json when present so it works on any machine.
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path (Join-Path $PSScriptRoot '..') '..'))
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot 'worker.local.json' }
if (-not $Name) {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Config not found: $ConfigPath" }
  $node = Get-Command node.exe -ErrorAction Stop
  $parsed = (& $node.Source (Join-Path $repoRoot 'tools\cli\worker-config.js') $ConfigPath) | ConvertFrom-Json
  if (-not $parsed.ok) { throw "Invalid worker config: $($parsed.error)" }
  $Name = $parsed.config.vmName
}
$vm = Get-VM -Name $Name -ErrorAction SilentlyContinue
if (-not $vm) {
  Write-Output "VM '$Name' does not exist on this machine."
  return
}
$vm | Select-Object Name, State, CPUUsage, MemoryAssigned, Uptime
Get-VMNetworkAdapter -VMName $Name | Select-Object VMName, SwitchName, IPAddresses

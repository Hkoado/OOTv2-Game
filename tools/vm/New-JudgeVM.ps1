[CmdletBinding()]
param(
  [string]$Name = 'OOTv2-Judge',
  [string]$Directory = 'D:\OOTv2-VM',
  [string]$SwitchName = 'Default Switch',
  [string]$WslDistribution = 'Ubuntu',
  [ValidateRange(2,8)][int]$CpuCount = 4,
  [ValidateRange(2,8)][int]$MemoryGiB = 4,
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
if ($Name -notmatch '^[A-Za-z0-9_-]{1,50}$') { throw 'Invalid VM name' }
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run in Administrator PowerShell' }
Import-Module Hyper-V
$existing = Get-VM -Name $Name -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output 'VM exists: no changes made. Use Get-JudgeStatus.ps1 to inspect; updates use Install-Judge.ps1.'
  return
}
Get-VMSwitch -Name $SwitchName -ErrorAction Stop | Out-Null
$Directory = [IO.Path]::GetFullPath($Directory)
if ($Directory -notmatch '^[A-Za-z]:\\[A-Za-z0-9_\\-]+$') { throw 'Use a local directory without spaces/special characters' }
New-Item -ItemType Directory -Force $Directory | Out-Null
if ((Get-PSDrive -Name $Directory.Substring(0,1)).Free -lt 45GB) { throw 'At least 45 GiB free required' }
$key = Join-Path $Directory 'judge_ed25519'
if (-not (Test-Path $key)) {
  # Empty passphrase: dedicated automation key; restrict its Windows ACL immediately.
  & ssh-keygen.exe -t ed25519 -f $key -N '""' -C 'ootv2-local-judge'
  if ($LASTEXITCODE -ne 0) { throw 'SSH key generation failed' }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $key /inheritance:r /grant:r "${identity}:(R,W)" '*S-1-5-18:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict private key ACL' }
function WslPath([string]$Path) {
  $result = & wsl.exe -d $WslDistribution -- wslpath -a $Path
  if ($LASTEXITCODE -ne 0) { throw 'wslpath failed' }
  return ($result | Select-Object -Last 1).Trim()
}
$prepare = WslPath (Join-Path $PSScriptRoot 'prepare-image.sh')
$linuxDirectory = WslPath $Directory
$linuxKey = WslPath "$key.pub"
& wsl.exe -d $WslDistribution -u root -- bash $prepare $linuxDirectory $linuxKey
if ($LASTEXITCODE -ne 0) { throw 'Image preparation failed. WSL needs qemu-utils, cloud-image-utils and curl.' }
if ($PrepareOnly) { Write-Output 'Image ready; VM not created'; return }
$vm = New-VM -Name $Name -Generation 2 -MemoryStartupBytes ($MemoryGiB * 1GB) `
  -VHDPath (Join-Path $Directory 'judge.vhdx') -SwitchName $SwitchName -Path $Directory
Set-VMProcessor -VMName $Name -Count $CpuCount
Set-VMMemory -VMName $Name -DynamicMemoryEnabled $false
Set-VMFirmware -VMName $Name -EnableSecureBoot On -SecureBootTemplate MicrosoftUEFICertificateAuthority
Add-VMHardDiskDrive -VMName $Name -Path (Join-Path $Directory 'seed.vhdx')
Set-VM -VMName $Name -AutomaticStartAction StartIfRunning -AutomaticStopAction ShutDown -CheckpointType Disabled
Start-VM -VMName $Name
Write-Output "VM created: $Name. Wait for cloud-init; inspect IP using Get-VMNetworkAdapter."
Write-Output "SSH key: $key. Verify guest SSH fingerprint in VM console before provisioning."
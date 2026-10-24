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
  Write-Output 'VM exists: no changes made. Inspect with Worker.ps1 -Action status; deploy with -Action install.'
  exit 0
}
Get-VMSwitch -Name $SwitchName -ErrorAction Stop | Out-Null
$Directory = [IO.Path]::GetFullPath($Directory)
if ($Directory -notmatch '^[A-Za-z]:\\[A-Za-z0-9_\\-]+$') { throw 'Use a local directory without spaces/special characters' }
New-Item -ItemType Directory -Force $Directory | Out-Null
if ((Get-PSDrive -Name $Directory.Substring(0,1)).Free -lt 45GB) { throw 'At least 45 GiB free required' }
$key = Join-Path $Directory 'judge_ed25519'
$keygen = (Get-Command ssh-keygen.exe -ErrorAction Stop).Source

# A helper that can be run unattended: stdin is closed immediately so an interactive
# passphrase/overwrite prompt fails fast instead of blocking a provisioning run forever.
function Invoke-Capture([string]$FileName, [string]$Arguments, [int]$TimeoutMs = 30000) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FileName
  $psi.Arguments = $Arguments
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  [void]$process.Start()
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($TimeoutMs)) {
    try { $process.Kill() } catch { }
    throw "Timed out after ${TimeoutMs}ms; an interactive prompt was most likely waiting: $FileName"
  }
  return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $stdout.Result; StdErr = $stderr.Result }
}

if (-not (Test-Path -LiteralPath $key)) {
  $created = Invoke-Capture $keygen ('-t ed25519 -f "' + $key + '" -N "" -C ootv2-local-judge')
  if ($created.ExitCode -ne 0) { throw "SSH key generation failed: $($created.StdErr.Trim())" }
}
# `ssh-keygen -y` has no passphrase flag, so a passphrase key can only fail by prompting.
# Detect the bcrypt KDF marker first (no process, no prompt) and keep a hard timeout as the
# second line of defence; an unattended run must never block on ssh-keygen.
$keyText = Get-Content -LiteralPath $key -Raw
$encryptedKey = $keyText -match 'ENCRYPTED'
if (-not $encryptedKey -and $keyText -match '(?s)-----BEGIN OPENSSH PRIVATE KEY-----(.+?)-----END') {
  try {
    $rawKey = [Text.Encoding]::ASCII.GetString([Convert]::FromBase64String(($Matches[1] -replace '\s', '')))
    $encryptedKey = $rawKey.Contains('bcrypt')
  } catch {
    $encryptedKey = $true
  }
}
if ($encryptedKey) {
  throw 'The SSH key is passphrase-protected (bcrypt KDF header). Provisioning needs a key with an empty passphrase; remove it deliberately and re-run.'
}
# The public key is derived from the private key, never regenerated, so an existing
# identity survives every retry of this script.
$derived = Invoke-Capture $keygen ('-y -f "' + $key + '"')
if ($derived.ExitCode -ne 0) {
  throw "SSH key is not usable non-interactively: $($derived.StdErr.Trim())"
}
$derivedKey = $derived.StdOut.Trim()
if (-not $derivedKey.StartsWith('ssh-ed25519 ')) { throw 'SSH key is not an ed25519 key' }
$publicKeyPath = "$key.pub"
if (Test-Path -LiteralPath $publicKeyPath) {
  $existingKey = (Get-Content -LiteralPath $publicKeyPath -Raw).Trim()
  if ($existingKey -ne $derivedKey) { throw "Public key $publicKeyPath does not match the private key; fix or remove it deliberately." }
} else {
  Set-Content -LiteralPath $publicKeyPath -Value $derivedKey -Encoding ascii
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $key /inheritance:r /grant:r "${identity}:(R,W)" '*S-1-5-18:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict private key ACL' }

# Translate with wslpath instead of assuming `/mnt/<drive>`: automount can be disabled or
# remapped, and a wrong guess would silently prepare the image in the wrong directory.
# wsl.exe writes progress/errors to stderr; with $ErrorActionPreference='Stop' that raises a
# NativeCommandError that aborts this script silently. Every WSL call goes through here.
function Invoke-Wsl([string[]]$WslArgs) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & wsl.exe @WslArgs 2>&1
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE
      Output = (@($output) | ForEach-Object { "$_" }) -join "`n" }
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Resolve-WslPath([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  if ($fullPath -notmatch '^[A-Za-z]:\\') { throw "Expected an absolute local drive path: $Path" }
  # wsl.exe strips backslashes from arguments (verified: it turns `D:\VM` into `D:VM` and
  # wslpath then fails), so the Windows path is handed over with forward slashes.
  $translated = Invoke-Wsl @('-d', $WslDistribution, '--', 'wslpath', '-a', $fullPath.Replace('\', '/'))
  $linuxPath = $translated.Output.Trim()
  if ($translated.ExitCode -ne 0 -or $linuxPath -notmatch '^/') {
    throw "WSL '$WslDistribution' cannot translate ${fullPath}: $linuxPath. Check the distribution name."
  }
  return $linuxPath
}
function Assert-WslVisible([string]$LinuxPath) {
  $visible = Invoke-Wsl @('-d', $WslDistribution, '-u', 'root', '--', 'test', '-e', $LinuxPath)
  if ($visible.ExitCode -ne 0) {
    throw "WSL '$WslDistribution' cannot see $LinuxPath. Enable Windows drive automount or move the VM directory inside the distribution."
  }
}

$prepare = Resolve-WslPath (Join-Path $PSScriptRoot 'prepare-image.sh')
$linuxDirectory = Resolve-WslPath $Directory
$linuxKey = Resolve-WslPath $publicKeyPath
Assert-WslVisible $prepare
Assert-WslVisible $linuxDirectory
Assert-WslVisible $linuxKey
$prepared = Invoke-Wsl @('-d', $WslDistribution, '-u', 'root', '--', 'bash', $prepare, $linuxDirectory, $linuxKey)
if ($prepared.ExitCode -ne 0) {
  throw "Image preparation failed (exit $($prepared.ExitCode)). WSL needs qemu-utils, cloud-image-utils and curl. Output: $($prepared.Output)"
}
foreach ($disk in 'judge.vhdx', 'seed.vhdx') {
  if (-not (Test-Path -LiteralPath (Join-Path $Directory $disk))) { throw "Image preparation did not produce $disk" }
}
# Grow the root disk here: qemu-img cannot resize vhdx, and cloud-init growpart expands the
# partition to the new disk size on first boot. Fails closed when the disk stays too small.
$rootDisk = Join-Path $Directory 'judge.vhdx'
$vhd = Get-VHD -Path $rootDisk
if ($vhd.Size -lt 40GB) {
  Resize-VHD -Path $rootDisk -SizeBytes 40GB -ErrorAction Stop
  $vhd = Get-VHD -Path $rootDisk
}
if ($vhd.Size -lt 40GB) { throw "Root disk is only $([math]::Round($vhd.Size / 1GB, 1)) GiB; 40 GiB is required" }
Write-Output "root-disk: $([math]::Round($vhd.Size / 1GB, 1)) GiB"
if ($PrepareOnly) { Write-Output 'Image ready; VM not created'; exit 0 }
$vm = New-VM -Name $Name -Generation 2 -MemoryStartupBytes ($MemoryGiB * 1GB) `
  -VHDPath (Join-Path $Directory 'judge.vhdx') -SwitchName $SwitchName -Path $Directory
Set-VMProcessor -VMName $Name -Count $CpuCount
# Dynamic memory: a 16 GiB host cannot always hand out a fixed 4 GiB block while IDEs/browsers
# are open (Start-VM failed with 0x800705AA), but the judge still needs a stable ceiling.
$minMemoryGiB = [math]::Max(2, [math]::Floor($MemoryGiB / 2))
Set-VMMemory -VMName $Name -DynamicMemoryEnabled $true -MinimumBytes ($minMemoryGiB * 1GB) `
  -StartupBytes ($MemoryGiB * 1GB) -MaximumBytes ($MemoryGiB * 1GB)
Set-VMFirmware -VMName $Name -EnableSecureBoot On -SecureBootTemplate MicrosoftUEFICertificateAuthority
Add-VMHardDiskDrive -VMName $Name -Path (Join-Path $Directory 'seed.vhdx')
Set-VM -VMName $Name -AutomaticStartAction StartIfRunning -AutomaticStopAction ShutDown -CheckpointType Disabled
Start-VM -VMName $Name
Write-Output "VM created: $Name."
Write-Output "SSH key: $key"
Write-Output 'Next: open the VM console, compare the guest SSH host fingerprint, then add it to known_hosts.'
exit 0
[CmdletBinding()]
param(
  [ValidateSet('doctor','install','update','start','stop','restart','status','logs','health','version','config')]
  [string]$Action = 'status',
  [string]$ConfigPath,
  [string]$Address,
  [ValidateRange(1,2000)][int]$Tail = 100,
  [switch]$PrepareOnly,
  [ValidateSet('github','judge')][string]$Service = 'github'
)
# Single entry point for a fresh Windows machine:
#   copy worker.config.example.json -> worker.local.json, run -Action doctor, then install.
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path (Join-Path $PSScriptRoot '..') '..'))
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot 'worker.local.json' }
if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Worker config not found: $ConfigPath. Copy tools\vm\worker.config.example.json to worker.local.json and edit it."
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'node.exe not found. Install Node.js 22+ on this machine (the guest runtime is installed separately).' }
$rawConfig = & $node.Source (Join-Path $repoRoot 'tools\cli\worker-config.js') $ConfigPath
if ($LASTEXITCODE -ne 0) { throw "Invalid worker config. Run: node tools\cli\worker-config.js `"$ConfigPath`"" }
$parsed = $rawConfig | ConvertFrom-Json
if (-not $parsed.ok) { throw "Invalid worker config: $($parsed.error)" }
$cfg = $parsed.config
$keyPath = Join-Path $cfg.vmDirectory 'judge_ed25519'
$knownHostsPath = Join-Path $cfg.vmDirectory 'known_hosts'

$script:doctorFails = 0
function Write-Check([string]$Level, [string]$Name, [string]$Detail) {
  Write-Output ("{0} {1}: {2}" -f $Level, $Name, $Detail)
}
function Add-Pass([string]$Name, [string]$Detail) { Write-Check 'PASS' $Name $Detail }
function Add-Warn([string]$Name, [string]$Detail) { Write-Check 'WARN' $Name $Detail }
function Add-Fail([string]$Name, [string]$Detail) {
  $script:doctorFails += 1
  Write-Check 'FAIL' $Name $Detail
}

function Test-Administrator {
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-TargetAddress {
  if ($Address) { return $Address }
  $adapter = Get-VMNetworkAdapter -VMName $cfg.vmName -ErrorAction SilentlyContinue
  if (-not $adapter) { return $null }
  return (@($adapter.IPAddresses) | Where-Object {
      $_ -match '^\d{1,3}(\.\d{1,3}){3}$' -and $_ -notmatch '^(127\.|169\.254\.|0\.)'
    } | Select-Object -First 1)
}

function Assert-TrustedHost([string]$Target) {
  if (-not (Test-Path -LiteralPath $keyPath)) { throw "SSH key missing: $keyPath (create the VM first)." }
  if (-not (Test-Path -LiteralPath $knownHostsPath)) {
    throw "known_hosts missing: $knownHostsPath. Compare the guest host fingerprint in the VM console, then store it."
  }
  & ssh-keygen.exe -F $Target -f $knownHostsPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "No verified host key for $Target. Never disable host verification; add the fingerprint you read in the VM console."
  }
}

function Invoke-Guest([string]$Target, [string]$Command) {
  $options = @('-i', $keyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', "UserKnownHostsFile=$knownHostsPath", '-o', 'ConnectTimeout=20')
  # Out-Host keeps guest output visible when the caller captures the exit code.
  & ssh.exe @options "$($cfg.sshUser)@$Target" $Command | Out-Host
  return $LASTEXITCODE
}


function Invoke-Doctor {
  $script:doctorFails = 0
  if (Test-Administrator) { Add-Pass 'administrator' 'elevated session' }
  else { Add-Fail 'administrator' 'Hyper-V needs an elevated PowerShell' }

  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
  if ($os -and [int]$os.BuildNumber -ge 19041) { Add-Pass 'windows-build' $os.BuildNumber }
  elseif ($os) { Add-Fail 'windows-build' "build $($os.BuildNumber) is older than 19041" }

  $hyperv = Get-Module -ListAvailable -Name Hyper-V
  if ($hyperv) { Add-Pass 'hyperv-module' "version $($hyperv[0].Version)" }
  else { Add-Fail 'hyperv-module' 'enable the Hyper-V feature (Windows Pro/Enterprise) and reboot' }

  $system = Get-CimInstance Win32_ComputerSystem
  $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
  # VirtualizationFirmwareEnabled is often blank once the hypervisor is running,
  # so HypervisorPresent is the authoritative signal on an already-enabled host.
  if ($system.HypervisorPresent -eq $true) { Add-Pass 'virtualization' 'hypervisor present' }
  elseif ($cpu -and $cpu.VirtualizationFirmwareEnabled -eq $true) { Add-Pass 'virtualization' 'enabled in firmware' }
  else { Add-Fail 'virtualization' 'enable VT-x/AMD-V in firmware and Hyper-V' }
  if ($system.NumberOfLogicalProcessors -ge ($cfg.cpuCount + 2)) {
    Add-Pass 'cpu-capacity' "$($system.NumberOfLogicalProcessors) logical processors"
  } else {
    Add-Fail 'cpu-capacity' "$($system.NumberOfLogicalProcessors) logical processors is too few for $($cfg.cpuCount) vCPU"
  }
  $ramGiB = [math]::Round($system.TotalPhysicalMemory / 1GB)
  if ($ramGiB -ge ($cfg.memoryGiB + 2)) { Add-Pass 'memory-capacity' "$ramGiB GiB physical" }
  else { Add-Fail 'memory-capacity' "$ramGiB GiB physical is too little for a $($cfg.memoryGiB) GiB VM" }

  foreach ($tool in @('ssh.exe', 'scp.exe', 'tar.exe', 'ssh-keygen.exe', 'wsl.exe')) {
    if (Get-Command $tool -ErrorAction SilentlyContinue) { Add-Pass $tool 'available' }
    else { Add-Fail $tool 'missing (enable the OpenSSH Client optional feature)' }
  }
  $nodeVersion = (& $node.Source --version).TrimStart('v')
  if ([int]($nodeVersion.Split('.')[0]) -ge 22) { Add-Pass 'node' $nodeVersion }
  else { Add-Fail 'node' "$nodeVersion is below 22" }
  if (Get-Command git.exe -ErrorAction SilentlyContinue) { Add-Pass 'git' 'available' }
  else { Add-Warn 'git' 'install git to pull updates' }

  $distros = @(& wsl.exe --list --quiet 2>$null) -replace "`0", '' |
    ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if ($distros -contains $cfg.wslDistribution) { Add-Pass 'wsl-distribution' $cfg.wslDistribution }
  else { Add-Fail 'wsl-distribution' "install WSL distro '$($cfg.wslDistribution)' (image preparation only)" }

  $vm = Get-VM -Name $cfg.vmName -ErrorAction SilentlyContinue
  if ($vm) { Add-Pass 'vm' "$($vm.Name) state=$($vm.State)" } else { Add-Warn 'vm' 'not created yet (install creates it)' }
  if (Get-VMSwitch -Name $cfg.switchName -ErrorAction SilentlyContinue) { Add-Pass 'vm-switch' $cfg.switchName }
  else { Add-Fail 'vm-switch' "switch '$($cfg.switchName)' not found" }

  $drive = $cfg.vmDirectory.Substring(0, 1)
  $free = (Get-PSDrive -Name $drive -ErrorAction SilentlyContinue).Free
  if ($free -and $free -ge 45GB) { Add-Pass 'disk-space' "$([math]::Round($free / 1GB)) GiB free on $drive" }
  else { Add-Fail 'disk-space' "45 GiB free on $drive is required" }

  if (Test-Path -LiteralPath $keyPath) { Add-Pass 'ssh-key' $keyPath } else { Add-Warn 'ssh-key' 'created with the VM' }
  if (Test-Path -LiteralPath $knownHostsPath) { Add-Pass 'known-hosts' $knownHostsPath }
  else { Add-Warn 'known-hosts' 'must be filled from the VM console before install' }

  & $node.Source (Join-Path $repoRoot 'tools\cli\export-worker-env.js') '--check'
  if ($LASTEXITCODE -eq 0) { Add-Pass 'repo-env' 'worker credentials present in .env' }
  else { Add-Fail 'repo-env' '.env lacks SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY' }

  if ($script:doctorFails -gt 0) {
    Write-Output "doctor: $($script:doctorFails) blocking problem(s)"
    return
  }
  Write-Output 'doctor: OK'
}


switch ($Action) {
  'config' {
    $rawConfig
    break
  }
  'doctor' {
    Invoke-Doctor
    if ($script:doctorFails -gt 0) { exit 1 }
    exit 0
  }
  'install' {
    $vm = Get-VM -Name $cfg.vmName -ErrorAction SilentlyContinue
    if (-not $vm) {
      & (Join-Path $PSScriptRoot 'New-JudgeVM.ps1') -Name $cfg.vmName -Directory $cfg.vmDirectory `
        -SwitchName $cfg.switchName -WslDistribution $cfg.wslDistribution `
        -CpuCount $cfg.cpuCount -MemoryGiB $cfg.memoryGiB -PrepareOnly:$PrepareOnly
      if ($LASTEXITCODE -ne 0) { throw 'VM creation failed' }
      Write-Output 'VM created. Wait for cloud-init, verify the SSH host fingerprint in the console, update known_hosts, then re-run -Action install.'
      break
    }
    $Target = Resolve-TargetAddress
    if (-not $Target) { throw "No IPv4 address for $($cfg.vmName) yet. Wait for cloud-init or pass -Address." }
    Assert-TrustedHost $Target
    & (Join-Path $PSScriptRoot 'Install-Judge.ps1') -Address $Target -KeyPath $keyPath -KnownHostsPath $knownHostsPath
    if ($LASTEXITCODE -ne 0) { throw 'Install failed' }
    break
  }
  'update' {
    $Target = Resolve-TargetAddress
    if (-not $Target) { throw 'VM not reachable yet; run -Action install first.' }
    Assert-TrustedHost $Target
    & (Join-Path $PSScriptRoot 'Install-Judge.ps1') -Address $Target -KeyPath $keyPath -KnownHostsPath $knownHostsPath
    if ($LASTEXITCODE -ne 0) { throw 'Update failed; the previous release stays active if the swap broke' }
    break
  }
  default {
    $vm = Get-VM -Name $cfg.vmName -ErrorAction SilentlyContinue
    if (-not $vm) { throw "VM '$($cfg.vmName)' does not exist. Run: Worker.ps1 -Action install" }
    Write-Output "vm=$($vm.Name) state=$($vm.State) cpu=$($vm.CPUUsage) mem=$($vm.MemoryAssigned)"
    $Target = Resolve-TargetAddress
    if (-not $Target) { throw 'No guest IPv4 address yet (cloud-init may still be running).' }
    Assert-TrustedHost $Target
    $ctl = "env OOTV2_WORKER_SERVICE=$Service /srv/ootv2/current/tools/provision/workerctl.sh"
    $code = 1
    switch ($Action) {
      'status' { $code = Invoke-Guest $Target "$ctl status" }
      'version' { $code = Invoke-Guest $Target "$ctl version" }
      'health' { $code = Invoke-Guest $Target "sudo -n $ctl health" }
      'start' { $code = Invoke-Guest $Target "sudo -n $ctl start" }
      'stop' { $code = Invoke-Guest $Target "sudo -n $ctl stop" }
      'restart' { $code = Invoke-Guest $Target "sudo -n $ctl restart" }
      'logs' { $code = Invoke-Guest $Target "$ctl logs $Tail" }
    }
    if ($code -ne 0) { throw "$Action failed on the guest (exit $code)" }
    break
  }
}

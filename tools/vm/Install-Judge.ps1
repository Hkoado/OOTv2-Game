[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9.]+$')][string]$Address,
  [string]$KeyPath = 'D:\OOTv2-VM\judge_ed25519',
  [string]$KnownHostsPath = 'D:\OOTv2-VM\known_hosts'
)
$ErrorActionPreference = 'Stop'
# ssh/scp/tar write progress and warnings to stderr. With $ErrorActionPreference='Stop' that
# becomes a NativeCommandError that aborts the install silently (no exit code, empty log), so
# every native call goes through here.
function Invoke-Native([string]$FileName, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $FileName @Arguments
    return $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
}
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not (Test-Path -LiteralPath $KeyPath)) { throw "SSH private key not found: $KeyPath (create the VM first)." }
if (-not (Test-Path -LiteralPath $KnownHostsPath)) { throw 'Verify guest fingerprint from console and populate known_hosts first. Never disable SSH host verification.' }
# A known_hosts file that exists but has no entry for this guest would only fail later,
# after the credential archive has already been staged.
$null = Invoke-Native 'ssh-keygen.exe' @('-F', $Address, '-f', $KnownHostsPath)
if ($LASTEXITCODE -ne 0) {
  throw "known_hosts has no entry for $Address. Read the guest host fingerprint in the VM console and add it; never disable host verification."
}
if (-not (Test-Path (Join-Path $root '.env'))) { throw 'Repository .env is required' }
# Fail locally instead of shipping an archive the guest installer must reject.
$required = @('package.json', 'package-lock.json', 'server/githubWorker.js', 'server/worker.js',
  'server/officialWorker.js', 'server/shared/githubWorkerDeps.js', 'sandbox/linux/run-bot.sh',
  'sandbox/linux/attest.sh', 'tools/cli/worker-health.js', 'tools/provision/install-judge.sh',
  'tools/provision/deploy-release.sh', 'tools/provision/workerctl.sh',
  'tools/provision/ootv2-attest.service', 'tools/provision/ootv2-attest.timer',
  'tools/provision/ootv2-github-worker.service', 'tools/provision/ootv2-official-worker.service')
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_)) })
if ($missing.Count -gt 0) { throw "Release is incomplete, missing: $($missing -join ', ')" }
$archive = Join-Path $env:TEMP ("ootv2-release-" + [guid]::NewGuid().ToString('N') + '.tar.gz')
$workerEnv = Join-Path $env:TEMP ("ootv2-env-" + [guid]::NewGuid().ToString('N'))
# BatchMode + strict host checking + keepalive: an unattended install cannot sit on a
# dead session, and it can never fall back to password/keyboard-interactive auth.
$options = @('-i', $KeyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', "UserKnownHostsFile=$KnownHostsPath", '-o', 'ConnectTimeout=20',
  '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4')
try {
  $nodeCode = Invoke-Native 'node.exe' @((Join-Path $root 'tools\cli\export-worker-env.js'), $workerEnv)
  if ($nodeCode -ne 0) { throw 'Worker environment validation failed' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $aclCode = Invoke-Native 'icacls.exe' @($workerEnv, '/inheritance:r', '/grant:r', "${identity}:(R,W)", '*S-1-5-18:(F)')
  if ($aclCode -ne 0) { throw 'Cannot restrict temporary credential ACL' }
  # Explicit allowlist: no .env, data/, private Git history, node_modules or uploaded bots.
  $tarCode = Invoke-Native 'tar.exe' @('-czf', $archive, '-C', $root, 'package.json', 'package-lock.json',
    'server', 'src/game', 'sandbox', 'tools/cli', 'tools/production', 'tools/provision', 'examples')
  if ($tarCode -ne 0) { throw 'Release archive failed' }
  $scpCode = Invoke-Native 'scp.exe' ($options + @($archive, "ootv2@${Address}:/home/ootv2/release.tar.gz"))
  if ($scpCode -ne 0) { throw 'Release transfer failed' }
  # Secret transferred separately, to the same verified SSH host only.
  $envCode = Invoke-Native 'scp.exe' ($options + @($workerEnv, "ootv2@${Address}:/home/ootv2/worker.env"))
  if ($envCode -ne 0) { throw 'Environment transfer failed' }
  $installCode = Invoke-Native 'ssh.exe' ($options + @("ootv2@$Address",
    'set -e; chmod 600 /home/ootv2/worker.env; rm -rf /home/ootv2/staging; mkdir -p /home/ootv2/staging; tar -xzf /home/ootv2/release.tar.gz -C /home/ootv2/staging; rm -f /home/ootv2/release.tar.gz; sudo -n bash /home/ootv2/staging/tools/provision/install-judge.sh'))
  if ($installCode -ne 0) { throw 'Guest installation failed; the worker stays stopped. Check the guest log above.' }
} finally {
  Remove-Item $archive,$workerEnv -Force -ErrorAction SilentlyContinue
}
exit 0
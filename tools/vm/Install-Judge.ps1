[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9.]+$')][string]$Address,
  [string]$KeyPath = 'D:\OOTv2-VM\judge_ed25519',
  [string]$KnownHostsPath = 'D:\OOTv2-VM\known_hosts'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not (Test-Path $KnownHostsPath)) { throw 'Verify guest fingerprint from console and populate known_hosts first. Never disable SSH host verification.' }
if (-not (Test-Path (Join-Path $root '.env'))) { throw 'Repository .env is required' }
$archive = Join-Path $env:TEMP ("ootv2-release-" + [guid]::NewGuid().ToString('N') + '.tar.gz')
$workerEnv = Join-Path $env:TEMP ("ootv2-env-" + [guid]::NewGuid().ToString('N'))
$options = @('-i',$KeyPath,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',"UserKnownHostsFile=$KnownHostsPath")
try {
  & node.exe (Join-Path $root 'tools\cli\export-worker-env.js') $workerEnv
  if ($LASTEXITCODE -ne 0) { throw 'Worker environment validation failed' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $workerEnv /inheritance:r /grant:r "${identity}:(R,W)" '*S-1-5-18:(F)' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict temporary credential ACL' }
  # Explicit allowlist: no .env, data/, private Git history, node_modules or uploaded bots.
  & tar.exe -czf $archive -C $root package.json package-lock.json server src/game sandbox tools/cli tools/production tools/provision examples
  if ($LASTEXITCODE -ne 0) { throw 'Release archive failed' }
  & scp.exe @options $archive "ootv2@${Address}:/home/ootv2/release.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'Release transfer failed' }
  # Secret transferred separately, to the same verified SSH host only.
  & scp.exe @options $workerEnv "ootv2@${Address}:/home/ootv2/worker.env"
  if ($LASTEXITCODE -ne 0) { throw 'Environment transfer failed' }
  & ssh.exe @options "ootv2@$Address" 'chmod 600 /home/ootv2/worker.env; mkdir -p /home/ootv2/staging; tar -xzf /home/ootv2/release.tar.gz -C /home/ootv2/staging; sudo bash /home/ootv2/staging/tools/provision/install-judge.sh'
  if ($LASTEXITCODE -ne 0) { throw 'Guest installation failed; worker remains gated' }
} finally {
  Remove-Item $archive,$workerEnv -Force -ErrorAction SilentlyContinue
}
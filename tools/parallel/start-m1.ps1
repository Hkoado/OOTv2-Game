[CmdletBinding()]
param(
    [string]$RepoRoot = '',
    [string]$WorktreeParent = '',
    [string]$BaseBranch = 'dev',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) {
    $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $scriptDirectory)
}

function Invoke-RepoGit {
    param([string[]]$GitArgs)
    $output = & git -C $script:Root @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed ($LASTEXITCODE): $($output -join [Environment]::NewLine)"
    }
    return $output
}

$script:Root = (Resolve-Path -LiteralPath $RepoRoot).Path
$top = [string](Invoke-RepoGit -GitArgs @('rev-parse', '--show-toplevel'))
if ([IO.Path]::GetFullPath($top) -ne [IO.Path]::GetFullPath($script:Root)) {
    throw 'RepoRoot must be the repository root, not a subdirectory.'
}
$current = [string](Invoke-RepoGit -GitArgs @('branch', '--show-current'))
if ($current -ne $BaseBranch) {
    throw "Run from base branch '$BaseBranch'; current branch is '$current'. No checkout was performed."
}
$base = [string](Invoke-RepoGit -GitArgs @('rev-parse', '--verify', "refs/heads/$BaseBranch"))
$dirty = @(Invoke-RepoGit -GitArgs @('status', '--porcelain=v1', '--untracked-files=all'))
if (-not $WorktreeParent) { $WorktreeParent = Split-Path -Parent $script:Root }
$parent = (Resolve-Path -LiteralPath $WorktreeParent).Path
$repoName = Split-Path -Leaf $script:Root
$manifestPath = Join-Path $parent "$repoName-m1-parallel.json"
$jobs = @(
    [pscustomobject]@{
        agent = 'Codex'
        branch = 'parallel/m1-github-intake'
        path = Join-Path $parent "$repoName-codex-m1"
        prompt = 'docs/agents/CODEX-M1.md'
    },
    [pscustomobject]@{
        agent = 'Cline'
        branch = 'parallel/m1-serverless-regression'
        path = Join-Path $parent "$repoName-cline-m1"
        prompt = 'docs/agents/CLINE-M1.md'
    }
)

foreach ($job in $jobs) {
    if (Test-Path -LiteralPath $job.path) { throw "Target already exists: $($job.path). Nothing overwritten." }
    & git -C $script:Root show-ref --verify --quiet "refs/heads/$($job.branch)"
    if ($LASTEXITCODE -eq 0) { throw "Branch already exists: $($job.branch). No branch reused." }
    if ($LASTEXITCODE -ne 1) { throw 'Unable to check existing branches.' }
    # Prompts must exist in the shared commit, not merely as uncommitted files.
    if ($Apply) {
        $null = Invoke-RepoGit -GitArgs @('cat-file', '-e', "${base}:$($job.prompt)")
    }
}
if (Test-Path -LiteralPath $manifestPath) { throw "Manifest already exists: $manifestPath. Review the previous run first." }

Write-Host "Base: $BaseBranch @ $base"
foreach ($job in $jobs) {
    Write-Host "$($job.agent): $($job.branch) -> $($job.path)"
    Write-Host "Prompt: $($job.prompt)"
}
Write-Host "Manifest: $manifestPath"
if (-not $Apply) {
    if ($dirty.Count) { Write-Warning 'Working tree is dirty. Commit reviewed handoff files before -Apply.' }
    Write-Host 'DRY RUN: no files, branches, worktrees, installs, database calls or deployments were created.'
    return
}
if ($dirty.Count) { throw 'Working tree is dirty. Review and commit changes first; this script never stages or commits.' }

# Validate all targets before changing Git state. Fail fast, never reset/remove a partial run.
$created = @()
try {
    foreach ($job in $jobs) {
        $null = Invoke-RepoGit -GitArgs @('worktree', 'add', '-b', $job.branch, $job.path, $base)
        $created += $job.path
        $head = [string](& git -C $job.path rev-parse HEAD)
        if ($LASTEXITCODE -ne 0 -or $head -ne $base) { throw "Base verification failed: $($job.path)" }
    }
    $manifest = [ordered]@{
        createdAt = [DateTime]::UtcNow.ToString('o')
        repoRoot = $script:Root
        baseBranch = $BaseBranch
        baseCommit = $base
        jobs = $jobs
        note = 'No secrets copied. No installs, migrations, deployments or merges performed.'
    }
    $json = $manifest | ConvertTo-Json -Depth 5
    # Exclusive creation prevents accidentally replacing another run's manifest.
    $stream = [IO.File]::Open($manifestPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
} catch {
    Write-Warning "Stopped. Worktrees already created: $($created -join ', '). Inspect git worktree list; no automatic cleanup/reset."
    throw
}

Write-Host 'Created and verified both worktrees at the SAME base commit.'
Write-Host 'Open each folder separately. Ask each agent to read its prompt. Do not copy .env or share node_modules.'
Write-Host 'Agents install dependencies independently. Keep real database credentials out of default tests.'
[CmdletBinding()]
param(
    [ValidateSet('Install','Remove','Status')][string]$Mode = 'Status',
    [Parameter(Mandatory=$true)][string]$GraphRoot
)
$ErrorActionPreference = 'Stop'
$taskName = 'Wolf Forge - Verified Merge Graph Refresh'
$repository = 'UplineTonyuo/wolf-forge-platform'
$graph = (Resolve-Path -LiteralPath $GraphRoot).Path
$runtime = Join-Path $graph 'graphify-out\automation'
$configPath = Join-Path $runtime 'config.json'
$program = Join-Path $runtime 'program'
$runner = Join-Path $program 'scripts\graphify\refresh-after-merge.py'
$taskDescription = "Owner-approved Wolf Forge Graphify maintenance; runtime=$runtime"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task -and $task.Description -cne $taskDescription) { throw 'Task name collision; unrelated task preserved' }

if ($Mode -eq 'Remove') {
    if ($task) {
        if ($task.State -eq 'Running') { throw 'Task is running; wait before removing it' }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Task removal readback failed' }
    Write-Output 'Task removed. Runtime evidence, graphs, Python environment and vault files preserved.'
    return
}
if ($Mode -eq 'Status') {
    [pscustomobject]@{ registered=[bool]$task; state=if($task){[string]$task.State}else{'Not installed'}; runtime=$runtime } | ConvertTo-Json
    if ($task) { Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime,LastTaskResult,NextRunTime | ConvertTo-Json }
    if (Test-Path -LiteralPath (Join-Path $runtime 'status.json')) { Get-Content -LiteralPath (Join-Path $runtime 'status.json') -Raw -Encoding UTF8 }
    return
}

function Canonical-Path([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name,'Process')
    if ([string]::IsNullOrWhiteSpace($value)) { $value = [Environment]::GetEnvironmentVariable($Name,'User') }
    if ([string]::IsNullOrWhiteSpace($value) -or -not (Test-Path -LiteralPath $value -PathType Container)) { throw "Missing canonical binding: $Name" }
    return (Resolve-Path -LiteralPath $value).Path
}
function Assert-PlainPath([string]$Path) {
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected path refused' }
        }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}
function Save-Json([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 8) + "`n"), (New-Object Text.UTF8Encoding($false)))
    $null = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Invoke-CheckedGit([string[]]$Arguments) {
    $result = & $gitExe -C $graph @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Git preflight failed: $($Arguments[0])" }
    return $result
}

$vault = Canonical-Path 'WOLF_FORGE_OBSIDIAN_VAULT_PATH'
$memory = Canonical-Path 'WOLF_FORGE_OBSIDIAN_MEMORY_PATH'
if ($memory -ne (Join-Path $vault '02 Projects\Wolf Forge Platform\AI Memory')) { throw 'Unexpected canonical memory binding' }
foreach ($path in @($graph,$vault,$memory,$runtime,$program)) { Assert-PlainPath $path }
$gitExe = (Get-Command git.exe -ErrorAction Stop).Source
$python = Join-Path $graph 'graphify-out\trial\.venv\Scripts\python.exe'
$pythonw = Join-Path (Split-Path -Parent $python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf) -or -not (Test-Path -LiteralPath $pythonw -PathType Leaf)) { throw 'Existing pinned Python environment missing; no installation attempted' }
if ((Invoke-CheckedGit -Arguments @('remote','get-url','origin')) -cne "https://github.com/$repository.git") { throw 'Unexpected graph repository' }
if (((Invoke-CheckedGit -Arguments @('rev-parse','--show-toplevel')) -replace '/','\') -ne $graph) { throw 'Unexpected graph root' }
$null = & $gitExe -C $graph symbolic-ref -q HEAD
if ($LASTEXITCODE -ne 1) { throw 'Graph checkout must be detached' }
if (Invoke-CheckedGit -Arguments @('status','--porcelain','--untracked-files=all')) { throw 'Graph checkout contains source edits or untracked files' }
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sourceStatus = & $gitExe -C $sourceRoot status --porcelain --untracked-files=all
if ($LASTEXITCODE -ne 0 -or $sourceStatus) { throw 'Commit and review setup before installing frozen program' }
$revision = & $gitExe -C $sourceRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify setup revision' }
$files = @('scripts/graphify/refresh-after-merge.py','scripts/graphify/build-local.py',
           'scripts/graphify/stage-export.py','docs/agents/graphify-trial.md')
foreach ($name in $files) { Assert-PlainPath (Join-Path $sourceRoot $name) }
if ($task) {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') { throw 'Task is still running; wait and reinstall' }
}
if ((Test-Path -LiteralPath $runtime) -and (Get-ChildItem -LiteralPath $runtime -Force) -and -not (Test-Path -LiteralPath $configPath)) {
    throw 'Unrecognized nonempty runtime directory preserved'
}
$null = New-Item -ItemType Directory -Path $runtime -Force
Assert-PlainPath (Join-Path $runtime 'job.lock')
$lease = [IO.File]::Open((Join-Path $runtime 'job.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
    if (Test-Path -LiteralPath (Join-Path $runtime 'pending.json')) { throw 'Unfinished publication; reconcile before reinstalling' }
    if (Test-Path -LiteralPath $configPath) {
        $previous = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($previous.graph_root -ne $graph -or $previous.vault -ne $vault -or $previous.memory -ne $memory -or $previous.repository -cne $repository) { throw 'Existing installation binding mismatch' }
    }
    $exports = Join-Path (Split-Path -Parent $memory) 'Code Graph'
    $hashes = @{}
    $baseline = $null
    foreach ($name in @('GRAPH_REPORT.md','README.md','graph.html')) {
        $target = Join-Path $exports $name
        Assert-PlainPath $target
        $contents = [IO.File]::ReadAllText($target,[Text.Encoding]::UTF8)
        $match = [regex]::Match($contents.Substring(0,[Math]::Min(1000,$contents.Length)), 'Source commit: ([0-9a-f]{40})')
        if (-not $match.Success) { throw 'Existing approved export provenance missing' }
        if ($baseline -and $baseline -cne $match.Groups[1].Value) { throw 'Existing approved export SHAs disagree' }
        $baseline = $match.Groups[1].Value
        $hashes[$name] = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $statePath = Join-Path $runtime 'state.json'
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($state.published_sha -cne $baseline) { throw 'Existing checkpoint/export mismatch' }
        foreach ($name in $hashes.Keys) { if ($state.export_hashes.$name -cne $hashes[$name]) { throw 'Existing published export changed; preserve and review' } }
    } else {
        Save-Json $statePath @{published_sha=$baseline;export_hashes=$hashes;initialized_at=[DateTime]::UtcNow.ToString('o')}
    }
    $programHashes = @{}
    foreach ($name in $files) {
        $destination = Join-Path $program $name
        Assert-PlainPath $destination
        $null = New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force
        Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $destination
        $expected = (Get-FileHash -LiteralPath (Join-Path $sourceRoot $name) -Algorithm SHA256).Hash
        $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        if ($expected -cne $actual) { throw 'Frozen program copy/readback mismatch' }
        $programHashes[$name] = $actual.ToLowerInvariant()
    }
    Save-Json $configPath @{schema=1;repository=$repository;graph_root=$graph;vault=$vault;memory=$memory;runtime=$runtime;
                          python=$python;git=$gitExe;program_hashes=$programHashes;program_revision=$revision}
} finally { $lease.Dispose() }
& $python -I -B (Join-Path $program 'scripts\graphify\refresh-after-merge.py') --config $configPath --check-only
if ($LASTEXITCODE -ne 0) { throw 'Real read-only verification failed; task remains disabled/unregistered' }
$status = Get-Content -LiteralPath (Join-Path $runtime 'status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($status.state -cne 'verified') { throw 'Current main is not verified; task remains disabled/unregistered' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-I -B "' + $runner + '" --config "' + $configPath + '"'
$action = New-ScheduledTaskAction -Execute $pythonw -Argument $arguments -WorkingDirectory $graph
$periodic = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$periodic.Repetition.StopAtDurationEnd = $false
$logon = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
Register-ScheduledTask -TaskName $taskName -Description $taskDescription -Action $action -Trigger @($periodic,$logon) -Principal $principal -Settings $settings -Force | Out-Null
$saved = Get-ScheduledTask -TaskName $taskName
if ($saved.Actions.Execute -cne $pythonw -or $saved.Actions.Arguments -cne $arguments -or $saved.Settings.WakeToRun -or
    [int]$saved.Principal.RunLevel -ne 0 -or [int]$saved.Principal.LogonType -ne 3 -or
    @($saved.Triggers | Where-Object {$_.Repetition.Interval -eq 'PT5M'}).Count -ne 1) { throw 'Saved task definition mismatch' }
Write-Output "Registered and read back: $taskName; every 5 minutes and at sign-in; normal privileges; no wake."

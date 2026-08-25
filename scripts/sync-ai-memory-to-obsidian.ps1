$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repositoryRoot ".ai-memory"
$destinationPath = $env:WOLF_FORGE_OBSIDIAN_MEMORY_PATH

if ([string]::IsNullOrWhiteSpace($destinationPath)) {
    Write-Error @"
WOLF_FORGE_OBSIDIAN_MEMORY_PATH is not configured. No files were copied.
Set it to the Obsidian AI Memory directory, then run npm.cmd run memory:sync again.
"@
    exit 1
}

if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
    Write-Error "AI memory source directory does not exist: $sourcePath"
    exit 1
}

function Get-NormalizedDirectoryPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $item = Get-Item -LiteralPath $Path -Force
    $resolvedPath = $item.FullName

    if ($item.LinkType -and $item.Target) {
        $resolvedPath = [string]$item.Target
        if (-not [System.IO.Path]::IsPathRooted($resolvedPath)) {
            $resolvedPath = Join-Path $item.Parent.FullName $resolvedPath
        }
    }

    return [System.IO.Path]::GetFullPath($resolvedPath).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

$sourceResolved = Get-NormalizedDirectoryPath -Path $sourcePath
$destinationFullPath = [System.IO.Path]::GetFullPath($destinationPath).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
)

if ([string]::Equals($sourceResolved, $destinationFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Output "AI MEMORY SYNC OK (source already resolves to the Obsidian destination; no copy required)"
    exit 0
}

[System.IO.Directory]::CreateDirectory($destinationFullPath) | Out-Null

$memoryFiles = Get-ChildItem -LiteralPath $sourcePath -File -Filter "*.md" |
    Where-Object { -not $_.Name.StartsWith(".", [System.StringComparison]::Ordinal) }

foreach ($memoryFile in $memoryFiles) {
    $destinationFile = Join-Path $destinationFullPath $memoryFile.Name
    [System.IO.File]::WriteAllBytes(
        $destinationFile,
        [System.IO.File]::ReadAllBytes($memoryFile.FullName)
    )
}

Write-Output "AI MEMORY SYNC OK ($($memoryFiles.Count) top-level Markdown files copied)"

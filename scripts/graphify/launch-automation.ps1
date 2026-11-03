$ErrorActionPreference = 'Stop'
$configPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\config.json'))
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
& $config.python -I -B (Join-Path $PSScriptRoot 'refresh-after-merge.py') --config $configPath
exit $LASTEXITCODE

# Wolf Forge Graphify trial

Owner-approved Claude Code trial: October 30 through November 13, 2026. This setup preserves the existing local Graphify 0.9.90 procedure. It does not install software, enable hooks, connect a cloud service, or grant Codex a persistent Graphify skill.

## What is tracked

`scripts/graphify/` contains the build/export scripts, exact dependency pin, hashed lock and synthetic boundary tests. `.graphifyignore` records source scope and exclusions. The project-local Claude skill is the existing pinned upstream Windows skill; `.claude/CLAUDE.md` restricts its trial behavior. Generated graphs, native Obsidian exports, caches and Python environments remain untracked.

## Existing interpreter

Use the already provisioned `graphify-out/trial/.venv/Scripts/python.exe` in the dedicated detached graph checkout. Graphify is pinned to `graphifyy[sql]==0.9.90`. The lock also pins its dependencies and hashes. No installation or upgrade is needed for this trial. A future reinstall requires separate authorization; use the hashed lock and binary distributions only, without regenerating/upgrading it silently.

## Refresh and local build

Keep the setup branch separate from the graph checkout. Set `$setupRoot` to the checkout containing these committed scripts and `$graphRoot` to the existing dedicated graph checkout. Do not infer either from an Obsidian window. Verify that no other session is writing the graph checkout before proceeding. Run PowerShell:

```powershell
Set-Location -LiteralPath $graphRoot
git diff --exit-code
if ($LASTEXITCODE -ne 0) { throw 'Tracked edits: stop' }
git diff --cached --exit-code
if ($LASTEXITCODE -ne 0) { throw 'Staged edits: stop' }
git symbolic-ref --quiet --short HEAD
if ($LASTEXITCODE -ne 1) { throw 'Expected detached graph checkout: stop' }
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed' }
git switch --detach origin/main
if ($LASTEXITCODE -ne 0) { throw 'Detached refresh failed' }
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:GRAPHIFY_NO_AUTO_REFRESH = '1'
$graphPython = Join-Path $graphRoot 'graphify-out/trial/.venv/Scripts/python.exe'
& $graphPython -B (Join-Path $setupRoot 'scripts/graphify/build-local.py') --build
if ($LASTEXITCODE -ne 0) { throw 'Scoped build failed' }
& $graphPython -B (Join-Path $setupRoot 'scripts/graphify/stage-export.py')
if ($LASTEXITCODE -ne 0) { throw 'Export staging failed' }
```

The current working directory selects the source checkout; the script location selects the setup. Only `src/`, `supabase/migrations/`, `supabase/functions/`, `scripts/` and `docs/` are eligible. Git ignore rules, sensitive paths/content, symlinks and generated directories are excluded. Source hashes and SHA are recorded and rechecked. Markdown uses structural parsing; images and semantic document interpretation are skipped. Clustering uses `--no-label`, without a model. Never substitute upstream generic rebuild, watch, semantic extraction, install, hook or cloud commands.

## Query and verify

Set `$env:GRAPHIFY_NO_AUTO_REFRESH = '1'` before every CLI command; upstream otherwise may rewrite older user skills or OpenCode plugin configuration even during a query. The build script forces this setting for its child process. Run `& $graphPython -B -m graphify query "your question" --budget 1500` from the graph checkout, using the same pinned module entry point as the build. This avoids depending on a generated Windows launcher. `query`, `affected`, `path` and `explain` read its local `graphify-out/graph.json`. Every answer must be cross-checked against current source lines. A seed or file name selected after source inspection is assisted discovery, not an independent natural-language success.

The graph is a code-navigation aid. Dynamic Supabase RPC calls, framework dispatch, SQL definition history, generated types and ambiguous symbol resolution can produce omissions or misleading connections. It is not evidence of deployed database state, authorization correctness or test success. Exact string searches remain useful. Compare answer completeness and output size on real tasks; CLI timing does not measure human/agent time or token savings.

## Obsidian preview and approval

Agents query the local graph; Obsidian receives only `GRAPH_REPORT.md`, `README.md` and `graph.html` when strictly below 10,000,000 bytes. The destination is exactly `02 Projects/Wolf Forge Platform/Code Graph/` under `WOLF_FORGE_OBSIDIAN_VAULT_PATH` (process first, then Windows User environment). Existing AI Memory, Security and Obsidian configuration are read-only.

The staging command writes `graphify-out/trial/external-files.diff`, `external-files.json` and `vault-preview/` locally. Review the exact diff and obtain an explicit yes before copying. A general refresh request does not approve vault content. After that approval, from the same graph root:

```powershell
& $graphPython -B (Join-Path $setupRoot 'scripts/graphify/stage-export.py') --copy
if ($LASTEXITCODE -ne 0) { throw 'Approved copy/readback failed' }
```

Copy refuses changed staged or destination hashes and re-reads copied bytes. Unrelated files are preserved. Oversize HTML is excluded; deleting an older published HTML needs its own reviewed approval. Never copy `graph.json`, native node notes, canvas, ownership manifests, Python environments or configuration into the vault. HTML may load third-party visualization assets when opened.

## Validate the setup

```powershell
& $graphPython -B -m unittest discover -s (Join-Path $setupRoot 'scripts/graphify') -p test_setup.py -v
```

Tests use synthetic temporary files, including a temporary vault, and never write the configured vault. At trial review on November 13, retain the setup only if source-verified answers improve actual investigation work. No scheduler, automatic cleanup or subscription is enabled.

Build/export scripts refuse optimized Python (`-O` or `PYTHONOPTIMIZE`) before doing work, so their assertion-based safety checks cannot silently disappear.

Official reference: [Graphify 0.9.90](https://pypi.org/project/graphifyy/0.9.90/). The vendored skill is preserved as supplied; the scoped trial rules above take precedence.

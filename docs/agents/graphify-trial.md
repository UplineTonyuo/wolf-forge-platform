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
$env:GRAPHIFY_OUT = Join-Path $graphRoot 'graphify-out'
$graphPython = Join-Path $graphRoot 'graphify-out/trial/.venv/Scripts/python.exe'
& $graphPython -B (Join-Path $setupRoot 'scripts/graphify/build-local.py') --build
if ($LASTEXITCODE -ne 0) { throw 'Scoped build failed' }
& $graphPython -B (Join-Path $setupRoot 'scripts/graphify/stage-export.py')
if ($LASTEXITCODE -ne 0) { throw 'Export staging failed' }
```

The current working directory selects the source checkout; the script location selects the setup. The build forces `GRAPHIFY_OUT` to that checkout's absolute `graphify-out/` before parser imports and in its CLI child, so inherited overrides cannot redirect graph/cache writes. Only `src/`, `supabase/migrations/`, `supabase/functions/`, `scripts/` and `docs/` are eligible. Git ignore rules, sensitive paths/content, symlinks and generated directories are excluded. Source hashes and SHA are recorded and rechecked. Markdown uses structural parsing; images and semantic document interpretation are skipped. Clustering uses `--no-label`, without a model. Never substitute upstream generic rebuild, watch, semantic extraction, install, hook or cloud commands.

## Query and verify

Set `$env:GRAPHIFY_NO_AUTO_REFRESH = '1'` and `$env:GRAPHIFY_OUT = Join-Path $graphRoot 'graphify-out'` before every CLI command; upstream otherwise may rewrite older user skills or OpenCode plugin configuration even during a query, or use another output directory. The build script forces both settings for its child process. Run `& $graphPython -B -m graphify query "your question" --budget 1500` from the graph checkout, using the same pinned module entry point as the build. This avoids depending on a generated Windows launcher. `query`, `affected`, `path` and `explain` read its local `graphify-out/graph.json`. Every answer must be cross-checked against current source lines. A seed or file name selected after source inspection is assisted discovery, not an independent natural-language success.

The graph is a code-navigation aid. Dynamic Supabase RPC calls, framework dispatch, SQL definition history, generated types and ambiguous symbol resolution can produce omissions or misleading connections. It is not evidence of deployed database state, authorization correctness or test success. Exact string searches remain useful. Compare answer completeness and output size on real tasks; CLI timing does not measure human/agent time or token savings.

## Obsidian preview and approval

Agents query the local graph; Obsidian receives only `GRAPH_REPORT.md`, `README.md` and `graph.html` when strictly below 10,000,000 bytes. The destination is exactly `02 Projects/Wolf Forge Platform/Code Graph/` under `WOLF_FORGE_OBSIDIAN_VAULT_PATH` (process first, then Windows User environment). Existing AI Memory, Security and Obsidian configuration are read-only during investigations. The owner-approved scheduled publisher below has one narrow additional permission: append factual merge evidence to the existing `03 Implementation Log.md`.

The staging command writes `graphify-out/trial/external-files.diff`, `external-files.json` and `vault-preview/` locally. Manual copies require review of the exact diff and an explicit yes. A general refresh request does not approve vault content. The scheduled publisher has separate recurring approval only for its four allowlisted files and factual template. After approval of a manual copy, from the same graph root:

```powershell
& $graphPython -B (Join-Path $setupRoot 'scripts/graphify/stage-export.py') --copy
if ($LASTEXITCODE -ne 0) { throw 'Approved copy/readback failed' }
```

Copy refuses changed staged or destination hashes and re-reads copied bytes. Unrelated files are preserved. Missing HTML, HTML marked stale by `.graph.html.stale`, and oversize HTML are excluded from the preview; old HTML never receives a new provenance header when the generator reports it stale. Deleting an older published HTML needs its own reviewed approval. Never copy `graph.json`, native node notes, canvas, ownership manifests, Python environments or configuration into the vault. HTML may load third-party visualization assets when opened.

## Validate the setup

```powershell
& $graphPython -B -m unittest discover -s (Join-Path $setupRoot 'scripts/graphify') -p test_setup.py -v
```

Tests use synthetic temporary files, including a temporary vault, and never write the configured vault. At trial review on November 13, retain the setup only if source-verified answers improve actual investigation work. Scheduler installation is a separate owner-authorized step described below; no paid subscription is required.

Build/export scripts refuse optimized Python (`-O` or `PYTHONOPTIMIZE`) before doing work, so their assertion-based safety checks cannot silently disappear.

Official reference: [Graphify 0.9.90](https://pypi.org/project/graphifyy/0.9.90/). The vendored skill is preserved as supplied; the scoped trial rules above take precedence.

## Owner-approved verified-merge automation — 2026-11-04

The owner selected “Graph exports + factual merge log” and approved construction of the Windows setup. This grants recurring publication only to the three existing Code Graph exports and append-only factual entries in the existing canonical `AI Memory/03 Implementation Log.md`. It does not grant automatic curated memory, Decisions, Security, IDs, Raw, `.ai-memory`, Obsidian settings or deployed-control changes. The November 13 Claude skill review remains; this ordinary structural maintenance task continues until disabled.

From a clean, reviewed, committed setup checkout, using the existing dedicated detached `$graphRoot`:

```powershell
& ./scripts/graphify/manage-automation.ps1 -Mode Install -GraphRoot $graphRoot
& ./scripts/graphify/manage-automation.ps1 -Mode Status -GraphRoot $graphRoot
# Disable without deleting anything:
Disable-ScheduledTask -TaskName 'Wolf Forge - Verified Merge Graph Refresh'
# Remove the recurring task; keep runtime evidence, graphs and the environment:
& ./scripts/graphify/manage-automation.ps1 -Mode Remove -GraphRoot $graphRoot
```

No execution-policy override, elevation, install or new credential is required. Task Scheduler starts the existing environment's `pythonw.exe` directly, so no console window or PowerShell script launcher is needed. The existing Git Credential Manager credential stays in memory; requests go only to GitHub's fixed API and are read-only. No AI provider, model, embedding or cloud graph service is called. Windows runs the task as the current interactive user every five minutes and at sign-in, with no wake-from-sleep. Unchanged polls do not fetch or rebuild. Offline machines catch up after returning online; there is no claim of real-time refresh.

The exact main SHA must match a merged PR targeting main. Its latest push-to-main `security.yml` run and all seven expected jobs must have completed successfully without skips; its latest Vercel status must be successful. PR-head CI alone, older successful attempts, direct pushes, missing checks and pending/failed/cancelled runs cannot authorize a snapshot. Recheck evidence and source/main after building. During offline catch-up, publish the latest verified snapshot once and list covered merged PRs. CI evidence applies to the published SHA, not every intermediate commit. A history rewrite or more than 100 offline commits requires manual review.

Installed code and its fingerprints live under the dedicated checkout's ignored `graphify-out/automation/program/`; machine bindings, checkpoint, one status file and publication receipts live in `graphify-out/automation/`. Future source merges do not change the installed program. Python entrypoints run isolated (`-I`), so checkout modules cannot shadow the installed Graphify package. Reject incoming trees tracking any reserved `graphify-out/` paths; switch with `--no-overwrite-ignore` and verify the installed manifest again before execution. Review and rerun Install to update the program. The installer refuses dirty source, missing/mixed export provenance, conflicting checkpoints and unfinished publications. It seeds the checkpoint from the already approved export set without adding another historical merge entry.

The task owns updates to the dedicated graph checkout while enabled. Before a manual build, source refresh, environment change or program update, disable the task and wait for any running instance to finish. Keep ordinary development in lane worktrees. Queries remain scoped and must verify current source/HEAD; do not assume a graph answer represents a later checkout.

Publication requires all three fresh exports, including non-stale HTML below 10,000,000 bytes. Preserve the last complete set when generation cannot produce them. Destination hashes protect owner-edited exports. An exclusive Windows file handle protects each destination during writes; the implementation log retains every pre-existing byte and receives only SHA, numeric PR links, verification links, counts, timestamp and a unique merge marker. No PR body/title is interpreted or copied into memory.

One durable pending journal stores only generated-file before/after bytes and the factual entry/prefix hash, not a copy of memory history. After an interruption, reconcile exact saved hashes, the append marker and any provable partial write before retrying. Conflicting changes require review; never blindly overwrite or roll back another writer. Each write is flushed and read back before checkpoint advancement. Only the most recent 20 completed JSON receipts are retained; pending payloads are removed after verified completion. Unchanged checks overwrite one small status file instead of creating history copies.

Status and failures are visible through Status above and Windows Task Scheduler's Last Run Result. Pending checks stay quiet; failures preserve the previous publication and need inspection. GitHub REST is pinned to the supported `2022-11-28` schema, with a full PR lookup for actual merge-SHA evidence; a missing/changed API field fails closed rather than weakening verification. No Codex thread, model-backed notification or recurring AI session is created. Do not claim the task is installed merely because these files exist: inspect its saved action, identity, five-minute trigger, no-wake setting and an actual successful invocation.

Run all focused checks with `-m unittest discover -s scripts/graphify -p 'test_*.py' -v`. Tests use temporary vaults and synthetic GitHub responses; live verification uses `refresh-after-merge.py --config <runtime>/config.json --check-only` and writes no vault content.

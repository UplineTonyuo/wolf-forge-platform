# Wolf Forge Graphify trial

The project-local `graphify` skill is preserved from the existing Graphify 0.9.90 Windows installation. Owner approval covers Claude Code only, October 30-November 13, 2026. Read `docs/agents/graphify-trial.md` before using it.

These scoped trial instructions override the vendored skill's generic install, rebuild, semantic-extraction, hooks and cloud examples:

- No automatic install, upgrade, hook, watch, MCP/cloud registration or model extraction. Use the existing pinned local interpreter.
- Before every CLI command set `GRAPHIFY_NO_AUTO_REFRESH=1`; upstream query startup can otherwise rewrite user skills or OpenCode configuration. The committed build forces this opt-out. Do not run the setup with optimized Python.
- Set `GRAPHIFY_OUT` to the dedicated graph checkout's absolute `graphify-out/` before CLI queries; the build forces this path before parser imports and in child commands. Export previews omit missing or marked-stale HTML.
- Keep the dedicated graph checkout detached and its tracked source unchanged. Commit setup only from the separate setup branch. Never access a database, push, deploy or change application behavior as part of a graph investigation.
- Run the committed `scripts/graphify/build-local.py` from the dedicated graph checkout root. It uses local structural parsing and `--no-label` clustering. Query the local `graphify-out/graph.json`; cross-check answers against current source.
- Source scope is `src/`, `supabase/migrations/`, `supabase/functions/`, `scripts/`, `docs/`; preserve Git ignore, secret and symlink exclusions.
- Stage only the three approved summary files with `scripts/graphify/stage-export.py`. Never write the vault without explicit approval of its exact diff. AI Memory, Security and Obsidian configuration stay read-only. No automatic memory synchronization.
- Review trial usefulness on November 13. Do not treat a missing graph edge as proof that no dependency or security check exists.

Registration record: project skill `.claude/skills/graphify/SKILL.md`; source `graphifyy==0.9.90`, preserved unchanged; owner-approved trial 2026-10-30, setup preservation authorized 2026-11-03; reconciled/reviewed 2026-11-04; trigger unfamiliar-area exploration and cross-file change-impact questions; Claude only. The AGENTS.md routing table and docs/agents/skills-registry.md record this project registration and its scoped trial safeguards.

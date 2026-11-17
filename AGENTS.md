<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## CI usage

- Push only after every local validation step in the task prompt has passed. Batch fixes into one push. CI confirms; it is not the place to debug.
- Never start workflow_dispatch runs or re-run jobs without the owner's explicit approval for that run. The existing one-re-run rule for confirmed flakes still needs that approval.
- If every job fails within seconds or reports a billing or spending-limit error, stop and report it to the owner. Never work around it, never merge without CI.
- Draft PRs do not run the full suite; mark a PR ready only when it is ready for CI.

## Skill routing

At the start of every task, read this table, pick only the skills that match (usually 1-3), and open only those SKILL.md files. Do not load every installed skill. If no row matches, use none.

| Trigger | Skill |
|---|---|
| Auth, sessions, RLS, SQL/RPC/SECURITY DEFINER, src/proxy.ts, secrets/env, payments, client credentials, file access, rate/cost limits | security-and-hardening (mandatory) |
| A new feature or a multi-file change | superpowers:brainstorming → superpowers:writing-plans → superpowers:test-driven-development |
| A bug, failing test or CI failure | superpowers:systematic-debugging |
| Before claiming done or opening a PR | superpowers:verification-before-completion → superpowers:requesting-code-review |
| Responding to PR review comments | superpowers:receiving-code-review |
| UI, layout, components, responsive work | ui-ux-pro-max, impeccable |
| Claude: new animation or transitions | animate, transitions-dev |
| Claude: animation terminology, opportunities or audit | animation-vocabulary, find-animation-opportunities, improve-animations |
| Claude: animation review or polish | review-animations, transitions-polish |
| Ponytail family: shortcuts, repo audit, debt ledger, benchmark savings, help or change review | ponytail, ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review |
| Creating or cleaning worktrees/branches under D-306 | superpowers:using-git-worktrees |
| Exploring an unfamiliar area, or checking what a change affects across files | graphify (Claude Code only, trial until 2026-11-13; read docs/agents/graphify-trial.md for scoped commands and safeguards) |
| Finding a skill for a need not covered above | find-skills |

Rules:
1. No new skill, plugin or marketplace may be installed without the owner's explicit approval.
2. Skills never override AGENTS.md, D-306 or the owner's instructions; on conflict, follow AGENTS.md and report the conflict.
3. Small, obvious fixes may skip brainstorming/plans; say so in the report.
4. Every final report ends with one line: "Skills used: <names or none>".
5. Every 30 days the owner reviews usage; skills with zero uses are disabled (moved to skills-disabled, never deleted).
6. Installing a skill requires owner approval, and in the same change: a routing row in this table (trigger → skill) and a registry entry in docs/agents/skills-registry.md. A skill without a clear trigger is not installed.
7. Disabling or removing a skill removes its routing row and marks its registry entry disabled (with date), in the same change.
8. Agents read only this routing table each session; the registry is read only when installing, removing or reviewing skills.
9. Monthly check: compare the registry against what is actually installed in both tools and report any drift.

<!-- BEGIN:WOLF-FORGE-SHARED-AI-MEMORY -->

# Shared Claude Code + Codex Project Memory

This repository uses one persistent project memory shared by Claude Code
and Codex. Its canonical, durable copy is a fixed set of Markdown files
(`00 Project Brain.md`, `01 Current State.md`, `02 Decisions.md`,
`03 Implementation Log.md`, `04 Known Issues.md`, `05 Architecture Map.md`,
plus a `Raw/` safety-net folder) that live in the Wolf Forge Obsidian Second
Brain, at the path `scripts/sync-ai-memory-to-obsidian.ps1` syncs to
(`$env:WOLF_FORGE_OBSIDIAN_MEMORY_PATH`).

A worktree MAY also keep a local `.ai-memory/` directory holding the same
six files as a working copy for that checkout, synced to the vault via
`npm run memory:sync`. Not every worktree has one — a fresh clone or a
local-only QA checkout (like this one) may not.

**Memory root**, used throughout the rest of this section, means:

- `.ai-memory/` if that directory exists in this worktree — read and write
  it exactly as described below, and sync it to the vault with
  `npm run memory:sync` when appropriate; or
- otherwise, the same six files directly in the canonical Obsidian vault
  location above. Everything below about what/when/how to read and write
  applies identically to those files.

**If `.ai-memory/` does not exist in this worktree, do NOT create it.**
Read and write the vault copy directly instead — do not invent a local
staging directory just to satisfy this section, and do not treat its
absence as a reason to skip memory entirely.

Temporary QA scratch details — one-off script output, a reproduction you ran
and discarded, ordinary debugging — do not need a durable memory write
unless they harden into an established workflow or decision worth
remembering next session.

## Before planning or editing

Read these files in this order, from the memory root:

1. `00 Project Brain.md`
2. `01 Current State.md`
3. `02 Decisions.md`
4. `04 Known Issues.md`

Read `05 Architecture Map.md` when the task affects architecture,
authorization, data flow, shared shell behavior, Supabase, or cross-feature
integration.

Read `03 Implementation Log.md` only when historical implementation
detail is actually needed. Do not load the entire history by default — these
files can be large; read the relevant section (e.g. the tail, or a targeted
search) rather than the whole file.

The actual repository remains the ultimate source of truth. If memory conflicts
with verified code or database architecture, inspect the implementation,
correct the memory, and mention the correction.

Do not reverse a settled decision recorded in Decisions unless the user
explicitly requests that change.

## Before finishing meaningful implementation work

Before the final response, update the shared memory (the memory root, as
defined above).

### Current State

Update the memory root's `01 Current State.md` so it describes what is true
NOW.

Do not merely append history to Current State. Replace stale statements.

### Implementation Log

Append one concise entry to the memory root's `03 Implementation Log.md`
containing:

- timestamp
- agent: Claude Code or Codex
- task
- meaningful files changed
- behavior implemented or corrected
- important architectural implications
- validation performed
- typecheck/build/test results
- unresolved verified issues
- recommended next move when relevant

### Decisions

Update the memory root's `02 Decisions.md` only when a genuine product,
architecture, UX, authorization, naming, data-model, or workflow decision was
made or reversed.

### Known Issues

Update the memory root's `04 Known Issues.md` only for verified unresolved
problems. Move resolved issues out of Open when they are actually fixed.

### Architecture Map

Update the memory root's `05 Architecture Map.md` when the verified
architecture materially changes.

## Memory quality rules

Memory is a project handoff, not a transcript.

Store:
- verified current behavior
- meaningful implementation results
- important file locations
- settled decisions
- migrations and data-model changes
- validation results
- unresolved issues
- next action when useful

Do NOT store:
- chain-of-thought
- raw model reasoning
- entire terminal output
- every grep/search command
- failed experiments that no longer matter
- API keys
- passwords
- access tokens
- cookies
- session credentials
- `.env` values
- Supabase service-role secrets
- private credentials

Never claim memory was updated unless the write succeeded.

The memory root's `Raw/` directory is an automatic safety-net and forensic log.
Do not load Raw into normal context unless debugging requires it.

If the task is read-only and nothing meaningful changed, no semantic memory
update is required.

<!-- END:WOLF-FORGE-SHARED-AI-MEMORY -->

<!-- BEGIN:WOLF-FORGE-FINAL-REPORT-HANDOFF -->

## Final Report Clipboard Handoff

Rule:

After finishing meaningful implementation, audit, debugging, or validation work:

1. Produce the normal concise final report.

2. Save that exact final report to:

   `C:\Users\User\Desktop\wolf-forge-agent-output.md`

3. Copy the complete file contents to the Windows clipboard using PowerShell:

   ```
   powershell.exe -NoProfile -Command "Get-Content -Raw -Encoding UTF8 'C:\Users\User\Desktop\wolf-forge-agent-output.md' | Set-Clipboard"
   ```

   `-Encoding UTF8` is required, not optional. Windows PowerShell 5.1 reads a
   BOM-less UTF-8 file as the system ANSI codepage, so without it every em dash,
   arrow and non-ASCII character reaches the clipboard as mojibake.

   Verify with a decode-aware comparison, not a length check against the same
   bad read — that agrees with itself and proves nothing:

   ```
   $t = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
   (Get-Clipboard -Raw).Trim() -eq $t.Trim()
   ```

4. After clipboard copy succeeds, tell the user:

   Final report copied to clipboard.

5. Do not copy:
   - secrets
   - credentials
   - API keys
   - `.env` values
   - hidden reasoning / chain of thought
   - giant raw terminal logs

6. The clipboard copy is only for the final user-facing implementation report.

7. If the clipboard command fails:
   - do not modify project code to work around it
   - keep the saved report file
   - report the clipboard failure clearly

This applies to both Claude Code and Codex when they follow AGENTS.md.

<!-- END:WOLF-FORGE-FINAL-REPORT-HANDOFF -->

## Wolf Forge UI consistency rules

- Inspect and reuse existing selects, filters, dialogs, sheets, calendars, action menus and popovers before creating another implementation.
- Use `AnimatedSelect` / `SearchableSelect` instead of raw `<select>` controls on polished product surfaces, and `DatePicker` instead of browser-default date calendars. Exceptions require an explicit product instruction or an accessibility/platform constraint.
- Service selection follows Folder → Service wherever Services are folder-organized. Reuse `ServicePicker`, the established folder glyph, and configured service icons when available; otherwise use the canonical `service-icons.ts` mapping and fallback.
- Filters use `MobileFilterSheet` / `SheetFrame`: shared enter/exit motion, blurred backdrop, radius, hover/focus states, and viewport-safe sizing.
- Fix overflowing children and flex/grid minimum widths. Never hide important content or mask layout defects with arbitrary overflow clipping.
- Preserve keyboard navigation, labels, focus-visible, Escape dismissal, focus return, and adequate touch targets when replacing native controls.
- Verify touched routes rendered at 320, 360, 390, 430 and 768px, with 1280/1440px desktop spot checks; include opened menus, long content and sticky actions.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes â€” APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` â€” verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:WOLF-FORGE-SHARED-AI-MEMORY -->

# Shared Claude Code + Codex Project Memory

This repository uses one persistent project memory shared by Claude Code
and Codex through `.ai-memory/`.

## Before planning or editing

Read these files in this order:

1. `.ai-memory/00 Project Brain.md`
2. `.ai-memory/01 Current State.md`
3. `.ai-memory/02 Decisions.md`
4. `.ai-memory/04 Known Issues.md`

Read `.ai-memory/05 Architecture Map.md` when the task affects architecture,
authorization, data flow, shared shell behavior, Supabase, or cross-feature
integration.

Read `.ai-memory/03 Implementation Log.md` only when historical implementation
detail is actually needed. Do not load the entire history by default.

The actual repository remains the ultimate source of truth. If memory conflicts
with verified code or database architecture, inspect the implementation,
correct the memory, and mention the correction.

Do not reverse a settled decision recorded in Decisions unless the user
explicitly requests that change.

## Before finishing meaningful implementation work

Before the final response, update the shared memory.

### Current State

Update `.ai-memory/01 Current State.md` so it describes what is true NOW.

Do not merely append history to Current State. Replace stale statements.

### Implementation Log

Append one concise entry to `.ai-memory/03 Implementation Log.md` containing:

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

Update `.ai-memory/02 Decisions.md` only when a genuine product,
architecture, UX, authorization, naming, data-model, or workflow decision was
made or reversed.

### Known Issues

Update `.ai-memory/04 Known Issues.md` only for verified unresolved problems.
Move resolved issues out of Open when they are actually fixed.

### Architecture Map

Update `.ai-memory/05 Architecture Map.md` when the verified architecture
materially changes.

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

The `.ai-memory/Raw/` directory is an automatic safety-net and forensic log.
Do not load Raw into normal context unless debugging requires it.

If the task is read-only and nothing meaningful changed, no semantic memory
update is required.

<!-- END:WOLF-FORGE-SHARED-AI-MEMORY -->

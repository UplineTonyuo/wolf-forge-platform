# Team Goals Implementation Plan

> For agentic workers: use superpowers:executing-plans. The user approved this scope for local implementation; use native inline execution without another approval loop.

**Goal:** Deliver the approved small Goals feature under Team.
**Architecture:** Private Tenant-scoped goal/milestone tables with authenticated RPCs, existing user-scoped repository/service boundaries, server-authorized private photo transport and existing UI controls.
**Tech Stack:** Existing Next/React, Zod, Supabase/PostgreSQL, CSS Modules, Vitest; no new dependencies.
**Spec:** docs/superpowers/specs/2026-11-01-team-goals-design.md

## Global constraints
- Local only; no Docker, hosted migrations, push, merge or deployment.
- Protect RojanCRM, William/client records and existing Team permissions.
- Canonical Obsidian/Security notes remain read-only under D-319.
- Keep the approved scope; no comments, automation, crop editor or new task infrastructure.

## Review focus
- Forged role, foreign Tenant, client or archived membership must not reveal goals/photos.
- Stale editor must not overwrite milestone progress or a newer photo.
- Invalid/oversized photo and interrupted upload must not destroy the existing cover.
- Private goal assignment must remain meaningful and invisible to non-leadership roles.
- Empty goals, long titles, mobile layout and printing must remain usable.

### Task 1 — Domain and database boundary
Files: src/domain/goals/schema.ts, CLI-generated migration, supabase/tests/database/186_team_goals.test.sql, src/tests/team-goals.test.ts.
- [x] Write/run failing domain and authorization tests.
- [x] Add bounded schemas and derived progress; private tables and explicit RPC ACLs; role/Tenant/visibility checks, revisions, idempotent create, milestone toggles and bounded photo context.
- [x] Run isolated native SQL assertions and domain tests, recording synthetic-fixture limits.

### Task 2 — Application, photos and navigation
Files: src/repositories/goal-repository.ts, src/services/goal-service.ts, src/app/actions/goals.ts, src/app/api/team-goals/[goalId]/photo/route.ts, src/app/(internal)/team/goals/**, src/components/goals/**, existing navigation/skeleton files and generated RPC types.
- [x] Cover service/action authorization and photo failure handling; verify typed repository RPC signatures against the native catalog.
- [x] Build list/detail/edit, photo upload/replace, milestone progress and native print using existing controls.
- [x] Add internal-only navigation without changing Members permissions; destination-shaped loading.
- [x] Run focused UI/action/transport and existing navigation tests.

### Task 3 — Integration and handoff
- [x] Run scoped lint, Next route type generation, full TypeScript checking, meaningful regression checks and secret scan.
- [x] Obtain one fresh-context whole-change security/code review; fix verified issues.
- [x] Record evidence, limits, manual QA checklist and exact migration/release requirements; no deployment.
- [ ] Full app build once at least 5.5 GiB RAM is available.
- [ ] Full Supabase/Auth/Storage/PostgREST acceptance and generated database-type comparison on a separately authorized isolated backend.
- [ ] User's seven-width browser and print acceptance.

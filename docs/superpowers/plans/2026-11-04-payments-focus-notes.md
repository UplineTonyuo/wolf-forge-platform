# Payments Task Focus Implementation Plan

> Execute inline with superpowers:executing-plans; one fresh final review.

**Goal:** Bring payment code/tests and bounded canonical Obsidian metadata into the live graph without recurring AI calls.
**Architecture:** Standard-library context module, safe compact payload rendering and a live-only notes overlay; existing viewer controls and guarded publisher remain.
**Tech stack:** Existing Python, Canvas/HTML/JS, native Windows tasks. No installs.
**Spec:** docs/superpowers/specs/2026-11-04-payments-focus-notes.md

## Global constraints

- Exact five-note allowlist,2MB/file,24sections/30refs each; titles/headings/paths only, no paragraph text or Raw/log/Security indexing.
- Wolf default, Galaxy, Graphify0.9.90, source provenance and five-minute/30-second gates preserved; eight-file frozen program. No manual canonical export/checkpoint writes.

## Review focus

- Path escape, redirected notes, missing/oversize/concurrent edits; graph stays usable.
- Script-closing headings and malicious URI content remain inert; only fixed open URIs.
- Note edits change live version without changing code publication; pending publication preserves the old view.
- Code counts/edges remain distinct from note stars/references; unknown references do not invent edges.
- Payments/All plus search/layout/selection, empty states and seven widths remain usable.

### Task1 — deterministic context and live overlay

Files: new scripts/graphify/project-context.py and test_project_context.py; exporter/host/tests; manager/runner manifests.
Interfaces:payment_indices(compact_nodes)->list[int]; NotesIndex(memory,vault).snapshot(compact_nodes)->bounded metadata; render_html(payload,knowledge=None); compact_payload(html,source)->validated payload.

- [x] Add failing focus/allowlist/metadata/security/cache tests and watched RED.
- [x] Implement context, escaping/payload validation and in-memory host overlay; include eighth frozen file.
- [x] Add live-version/note-edit/old-export regressions and run focused suite; pending publication remains guarded before context reads.

### Task2 — Payments and note navigation

Files: universe.html, scoped guide/spec/plan and existing viewer tests.
- [x] Add All/Payments, note diamonds/source filter, distinct note counts, note inspector/headings/mentions and exact Open in Obsidian links. Keep layout/focus independent.
- [x] Verify real data, focus/code/test/note navigation, URI targets and seven widths; live note-refresh proof follows installation with the authorised steward update.
- [x] One fresh source review; fix material findings with regressions; scan/commit/push same PR.
- [x] Back up prior runtime/config and protected hashes, install/read back the eight-file program/tasks/live view. Preserve exports/environment.
- [x] Narrowly update/re-read Current State/Implementation Log; propose Decisions/Security evidence in PR; save handoff.

## Ledger

Startup: source030b632clean/platform origin; installed760b927; publishededdede8 matches graph checkout/metadata/state, no pending journal, taskReady, pinned0.9.90. Canonical notes read; D-319 steward governs Decisions/Security. Bounded Graphify query found invoice/payment source/tests, confirmed by current source search; graph is navigation context, not newer-code evidence.
Ruling: owner explicitly asked to build the proposed focus/note layer; use the conservative read-only metadata implementation above without another permission cycle. Preserve existing canonical names and all other task scope.

RED: eight context tests failed for the missing module; live metadata tests failed for missing constructor support. GREEN:68focused tests pass, including an added size-limit fallback regression watched fail before fix. Existing CSP/host/geometry/publication contracts pass. Baseline UI had zero Payments/notes controls. Real read-only preview:784payment code symbols,4relevant notes of5,38explicit file links. Browser caught overlapping inspector body/footer blocking cards and Escape leaving the panel open. Both reproduced, fixed at their roots, then note selection/exact URI and Escape retested successfully. No external-app launch claimed. Preview remains on9141 using an owned copy of the approved graph; native9137program remains unchanged pending final verification/review.

Final review returned two P2 findings: unbounded note read during concurrent growth, and search Escape stopping the panel reset. Both accepted and fixed in one pass. Bounded-growth test watched fail before the MAX_BYTES+1 read fix; search-focused Escape reproduced then passed in browser. Final focused suite71/71passes. Additional RED→GREEN cases cover long Markdown fences, malformed compact payloads and percent-encoded heading URIs. Browser also verifies note→code reference,78Payments test symbols, test search/selection, no-results recovery, All restoring11,920code symbols and Payments surviving Galaxy/Wolf switches. Long24-heading inspector checked at320/360/390/430/768/1280/1440px without page overflow; mobile screenshot inspected. No browser errors captured. No new review loop or unrelated product changes.

Live post-save check: note metadata version changed automatically while code source stayededdede8, without browser reload. Readback found one180-character capped historical heading; a watched failing truncation test then fixed its link to open the original file instead of a false heading target.71tests pass after that guard. Installation startup readback also observed the viewer's duplicate one-minute trigger recording0x800710E0 exactly one minute after the healthy pythonw process started. Removed the redundant once trigger; viewer retains sign-in startup plus immediate installer start. Primary five-minute task is unchanged. Final saved task/URI guard readback follows this commit.

Final installed revisiona6fe575: all eight fingerprints verified; viewerRunning/result267009, oneMSFT_TaskLogonTrigger, no wake/unlimited/restart3; maintenanceReady/result0. Exact shortened-heading fallback verified against the real Current State note, with tooltip/ellipsis. Native Payments view verifies784code/4notes; canonical graph/export/checkpoint stayeddede8 while Vercel waits. Current State revision reconciled and Implementation Log appended; both saved notes reread, original log prefix and unrelated content preserved. The prior760b927program/config backup is intact. Temporary9141preview stopped; native9137retained. No actual reboot, Obsidian protocol launch, main merge or new real-merge publication claimed. Source lane remains for review.

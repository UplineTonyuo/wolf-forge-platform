# Wolf Forge Universe Implementation Plan

**Goal:** Explore the existing Graphify snapshot as a searchable local 3D galaxy.
**Architecture:** A standard-library exporter compacts verified graph data into an offline HTML/Canvas template. The existing builder generates it and the existing frozen-program manifest covers both added files.
**Tech stack:** Python standard library; HTML, CSS, Canvas and vanilla JavaScript. No installs.
**Spec:** `docs/superpowers/specs/2026-11-04-graph-universe-design.md`.

## Constraints and review focus

- Existing graph, runtime and vault are read-only during development; publication retains exact-preview approval.
- Escape script-closing labels, reject dangling/duplicate nodes, absolute/traversal paths and mismatched snapshot provenance before any write.
- Preserve the full searchable graph, while clearly identifying sampled overview edges.
- Check empty graphs, no matches, hidden groups, keyboard/pointer interaction, reduced motion and 320–1440px layouts.
- Keep output below 10MB and all rendering offline; preserve publisher safety and frozen-file checks.

## Task 1 — safe export and 3D viewer

- [x] Write observable exporter tests for compact data, hostile labels, bad paths/endpoints/SHA, input preservation and failed-write preservation. Watch RED.
- [x] Implement `build_payload(graph, metadata)`, `render_html(payload)` and `export_universe(graph_path, metadata_path, output_path)` in `scripts/graphify/export-universe.py`; add `scripts/graphify/universe.html`.
- [x] Generate an output-only preview from the real snapshot; verify 3D navigation, search, focus, filters, controls, offline requests and accessible responsive states in a browser.

## Task 2 — reproducible refresh and handoff

- [x] Run export after clustering in `build-local.py`; add both new runtime files to the manager/runner frozen manifests and their boundary tests.
- [x] Update the existing scoped guide with viewer use and rollout boundaries; run all `scripts/graphify/test_*.py` and focused browser checks.
- [x] Independently review the branch, address material findings, commit source only and preserve lane work under D-306.
- [x] Prepare exact publication preview and readback evidence; do not claim the installed task or canonical vault changed before the applicable approval/rollout.

## Verification ledger

2026-11-04: 49/49 focused tests passed; existing 40-test baseline was green. New export/snapshot/HTML tests were watched fail before implementation. Real pinned Graphify clustering in an owned synthetic detached repository verified rejection restores the previous HTML and marks it stale, then a successful build replaces it and clears the marker; zero model tokens. Native browser checks cover 21 flows/viewport cases, including all 89 public.profiles results, source/connection focus, camera controls, empty/no-match/hidden states, hostile labels and seven sizes from320 to1440px. No browser console errors. Direct file-protocol testing was blocked by browser policy; no workaround was attempted. The HTTP preview and absence of external renderer references were verified.

Independent source review found two P2 issues: preservation across upstream clustering and inaccessible results beyond40. Both were reproduced and fixed; the preservation regression and full suite passed, and browser pagination reached all89 matches. One P3 remains deferred: after two-finger pinch, lift both fingers before beginning another drag; touch-device acceptance was not performed. No new model-backed session or deployed application verification is claimed. The canonical vault preview is staged only; installed-program update and normal verified-merge publication are separate rollout steps.

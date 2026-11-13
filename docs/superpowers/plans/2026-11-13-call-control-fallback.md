# Call control fallback and reporting protection

Owner-authorized follow-up to both P2 findings from PR128, from current origin/main a16f199. Keep the merged fullscreen behavior and the bounded obstacle collector.

- Write regressions in existing call-screen/reporting-builder suites before implementation.
- If no compact floating region fits, restore the existing full-call dialog exactly once for that minimized opening. Keep mute/end reachable and retain the selected corner for the next minimized opening. Remove the hidden-frame fallback.
- Opt the report builder action bar and wizard footer into data-call-avoid; verify actual rendered bars affect floating placement.
- UI-only: no controller/media/state-machine/server/API/service/Daily/Supabase/dependency changes.
- Reuse the existing local preview harness for seven widths/four corners, reporting bars, and an exhausted-viewport case. No new rig or production login.
- Run next typegen, typecheck, lint, focused tests and full suite serially; review, commit and push the same new branch, open a non-draft follow-up PR, append one factual log entry and save/copy the report. Stop before merge/deploy.

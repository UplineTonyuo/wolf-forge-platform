# Functional Wolf Forge PWA checkpoint

## Source composition

Canonical repository: `https://github.com/UplineTonyuo/wolf-forge-platform`. Existing canonical `origin` was reused without changing any remote. `git ls-remote origin refs/heads/main` and fetch verified main at `d377e290a50e788d0faec71851aef42f373bcb9b` on October 20, 2026 (Asia/Singapore).

Isolated worktree: `C:/Users/TrojanNiAnton/Documents/wolf-forge-platform-pwa-20261020`. Branch: `feat/pwa-functional-20261020`. Canonical main is an ancestor of accepted functional source `5e1d19422bbf78589ad7cbc1a5a2cc6f21c37cc6`; this branch starts at that exact functional source. No other feature/recovery branch was merged.

Exact Branding consumer `bf02e513c61d84fa7e7423d4cd252b771bbf1954` passed `git apply --check` and was cherry-picked with provenance as `16629ed` (18 consumer/test/handoff paths). Publication's three producer files and four RPC declarations already exist in the functional candidate. The four Auth source/copy pairs have equivalent stable patch IDs and the three shared Auth implementations match after CRLF/LF normalization, as documented in the consumer handoff. No duplicate dependency commit or generated-type transfer was added. Integration's removal of `body` minimum width is preserved.

Existing release, functional, Branding and other worktrees and their modified/untracked files were not edited. The dependency tree is an ignored junction to the existing Integration `node_modules`, after exact package/lock byte comparison; no packages were installed or upgraded.

## Installation and update behavior

- `src/app/manifest.ts`: stable same-origin ID `/`, scope `/`, standalone display, and start URL `/launch`. Fixed Wolf Forge identity uses the existing wolf mark, navy and gold; no Tenant-specific installation branding is introduced.
- `src/app/launch/route.ts`: read-only, private/no-store routing through the existing verified-session, internal-user and client-user resolvers. Missing/unassigned sessions go to ordinary login; internal members go to the existing `/` role/module landing; clients go to `/account`. Caller `next` values do not select the destination. Existing page/API authorization remains authoritative.
- Root metadata provides the Apple web-app title/icon and theme color. Four PNGs provide real 192/512px app icons, a 512px maskable icon and 180px Apple icon.
- `PwaProvider` captures the browser's install event once at the root, offers installation only on deliberate action, and waits for the actual `appinstalled` event before reporting installation. Without that event it provides iOS/iPadOS, Android, Chrome/Edge and macOS Safari guidance. Controls are in login, internal account menus and the client portal rail. They reuse the existing dialog and preserve the underlying business component tree.
- Updates use fresh online document loads on reopen/reload. There is no update timer or automatic reload. The Reload app action explicitly asks users to save edits and finish uploads before confirming; cancel leaves the current state untouched.
- No service worker, Cache Storage, IndexedDB, offline queue, push subscription, background synchronization or native wrapper is added. Private pages, API responses, messages and files retain their existing online/authenticated paths and cache policy. Installation does not confer authorization. Existing security headers, proxy, login actions, cookie policy and Auth resolvers are unchanged.

Modern installation does not require a service worker: [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable). The implementation follows installed Next 16.3.8 manifest, metadata and route-handler documentation. Installation on hosted origins requires HTTPS; `localhost`/loopback is the local test exception. Browser/device installation UI and support vary; a native prompt is never promised where it is unavailable.

### Icon provenance

Existing source `public/branding/wolf-head-mark.png`, SHA256 `0f5b4903c623a2c722e4fd011688ee5834fbf562f05fd18a86ca9f74b8b3c47d`, is unchanged. Installed Sharp trimmed empty edges, resized it proportionally inside 80% of the ordinary/Apple icon or 60% of the maskable square, and centered it on `#000d51`. No generated/replacement logo or external image was introduced. PNG dimensions are checked against manifest declarations. The maskable output was visually inspected from disk.

## Validation and limits

Source checks and production build are separate from browser/backend acceptance. Source verification covers the actual composed source plus these PWA changes, using synthetic fixtures and mocked identity/RPC results; no claim of authenticated runtime acceptance follows from them.

| Check | Result |
| --- | --- |
| Focused PWA/Branding/shell/Auth/message/attachment suites, one worker | PASS: 263/263 tests across 19 files, including all 20 PWA tests; jsdom emits its existing non-failing navigation-not-implemented diagnostic |
| TypeScript | PASS: standalone `tsc --noEmit --incremental false`; final production build also checked the entire source/test tree |
| Affected-file ESLint | All 10 PWA-touched TS/TSX files passed with `--max-warnings=0`; CSS is not claimed as ESLint-checked |
| Production build | PASS: final `npm.cmd run build -- --webpack` after Android guidance; static manifest and dynamic launch route are present in the built route table |
| Existing source/security boundaries | Proxy, header policy, Auth actions/resolvers, package/lock and migrations remain unchanged |
| Secret scan / diff check | PASS: zero findings across 1764 tracked files including the staged additions; `git diff --cached --check` passed |
| Browser install, native standalone launch and update | NOT RUN: local production-server start was rejected by automatic approval review |
| Login/MFA/logout/authenticated navigation/message/upload | NOT RUN against a backend: Docker's Linux engine is unavailable, and retained stacks have an unresolved credential hold/no reuse grant |
| Physical iOS/iPadOS/Android/macOS Safari | Unavailable; guidance has component tests only |

Automatic approval review returned only `blocked by policy` for the loopback production-server start; no detailed policy reason was supplied. The rejected attempts did not start a process. This task did not retry through an alternative launcher or weaken authentication to obtain a browser result. The build uses an unreachable loopback backend placeholder and a noncredential publishable-key placeholder, not real/shared credentials. No backend was started, borrowed, reset, seeded or migrated.

Installed system Chrome 155.0.8059.84 and Edge 155.0.4283.62 were identified. The Browser plugin/skill is unavailable; regular Playwright with a fresh test profile was the selected validation path, but browser execution against the app could not proceed without a server. No screenshot, installability report, native install/launch, runtime console check or seven-width rendered pass is claimed. Prior functional/Branding QA remains historical evidence. No app-level MFA enrollment/challenge was identified in this source; any provider/account-specific MFA acceptance still requires an authorized synthetic account/backend.

Remaining acceptance is concrete: allow an isolated loopback app server (or provide an authorized exact-source runtime) and identify a safe synthetic backend/allocation; then run normal internal/client login and applicable MFA, logout/relaunch, role navigation, representative message and upload/download, actual Branding publication refresh, and Chrome/Edge install/standalone/manual reload/offline refusal. Inspect the install dialog with long content and focus at 320/360/390/430/768/1280/1440px. Verify actual iOS/iPadOS/Android/macOS installation when those devices are available. No production deployment is needed to preserve or review this local checkpoint.

No client data, production database, production deployment, repository deletion, remote configuration or canonical vault/Security note was changed. Existing allocations and read-only memory boundaries are preserved. Raw diagnostics and local checkpoint receipt stay outside Git under `C:/Temp/wolf-forge-pwa-20261020`.

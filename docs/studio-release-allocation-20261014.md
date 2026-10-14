# Studio release allocation

Owner: this Studio release preparation task. Allocated 2026-10-14.

- Canonical source: https://github.com/UplineTonyuo/wolf-forge-platform.git
- Clone: C:/Users/TrojanNiAnton/Documents/Wolf-Forge-Studio-Release-20261014
- Local branch: release/studio-only-20261014; destination main (no push/merge authorization).
- Starting main and active Vercel production: d377e290a50e788d0faec71851aef42f373bcb9b.
- Vercel project prj_Ck85gEGOBER55bl84u03P8z4syHM, team team_dpPiEJrmZWnVTFiOhfLlVes2.
- Separate Git directory; prior recovery worktrees and their allocations remain untouched. Source node_modules reused by junction; no dependency installation.
- Backend directory: C:/Users/TrojanNiAnton/AppData/Local/Temp/wolf-forge-studio-release-backend-20261014; project Wolf-Forge-Studio-Release-20261014. Ports: API62321, DB62322, shadow62320, Studio62323, mail62324, analytics62327, pooler62329. App3022. Path, container name and ports checked unused before allocation.
- Exclusive operations lease: candidate DB operations, builds, browser QA in that sequence; no other workstream may use this backend. Synthetic data only. Hosted preview backend remains unallocated pending explicit isolated project identity.
- Production project jwynqsyirgenqlmkooah is excluded from synthetic QA. No production writes, pushes, merges or deployments.
- The isolated stack uses Docker network `wolf-forge-studio-release-loopback-20261014`, with `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`. Start with its explicit `--network-id`; verify API and database published bindings after every start. No LAN/backend exposure or firewall exception is part of this release task.
- A second detached QA worktree, `C:/Users/TrojanNiAnton/Documents/Wolf-Forge-Studio-Release-Baseline-QA-20261014`, belongs to this task at canonical `d377e29` for baseline/recovery comparison only. Its path was verified unallocated before creation. It shares this clone's Git common directory, not any active recovery worktree branch.
- Canonical Global OS and project-memory paths resolved from configured machine environment. Canonical notes currently describe adad483 WL-2.38 and remain read-only. Repository/deployment evidence is authoritative; historical QA has not been counted as new validation.

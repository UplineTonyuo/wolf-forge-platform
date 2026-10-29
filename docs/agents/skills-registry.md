# Approved skills registry

This registry records the 20 owner-approved skills in the AGENTS.md routing table. Read it when installing, disabling, removing or reviewing skills. Daily task selection uses only the routing table.

Availability records verified SKILL.md presence and exact declared names on this machine, checked on 2026-10-30. Versions come from skill frontmatter or the containing plugin manifest; "not declared" means neither declares a version. User skills live under `~/.agents/skills` for Codex and `~/.claude/skills` for Claude; project skills live under `.agents/skills` and `.claude/skills`, respectively. The superpowers package is installed in each tool's plugin cache.

| skill | source (user / project / plugin + package) | version | available in (Codex / Claude / both) | routing trigger | approved by + date | last reviewed |
|---|---|---|---|---|---|---|
| security-and-hardening | user | not declared | both | Auth, sessions, RLS, SQL/RPC/SECURITY DEFINER, src/proxy.ts, secrets/env, payments, client credentials, file access, rate/cost limits; mandatory | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| superpowers:brainstorming | plugin + superpowers | 7.0.1 | both | New feature or multi-file change: clarify the design first | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| superpowers:writing-plans | plugin + superpowers | 7.0.1 | both | New feature or multi-file change: plan the approved design | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| superpowers:test-driven-development | plugin + superpowers | 7.0.1 | both | New feature or multi-file change: implement through tests | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| superpowers:systematic-debugging | plugin + superpowers | 7.0.1 | both | Bug, failing test or CI failure | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| superpowers:verification-before-completion | plugin + superpowers | 7.0.1 | both | Before claiming done or opening a PR; verify before requesting review | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| superpowers:requesting-code-review | plugin + superpowers | 7.0.1 | both | Before claiming done or opening a PR, after verification | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| superpowers:receiving-code-review | plugin + superpowers | 7.0.1 | both | Responding to PR review comments | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| ui-ux-pro-max | user | not declared | both | UI, layout, components or responsive work | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| impeccable | project | 4.1.1 | both | UI, layout, components or responsive work; preserve the project design system | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| animate | project | not declared | Claude | Create an animation or add motion | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| transitions-dev | project | not declared | Claude | Build CSS transitions or apply motion tokens | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| animation-vocabulary | project | not declared | Claude | Identify the name of a described animation effect | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| find-animation-opportunities | project | not declared | Claude | Find places where motion would help; read-only proposals | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| improve-animations | project | not declared | Claude | Audit existing motion and plan improvements; read-only | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| review-animations | project | not declared | Claude | Explicitly requested animation review; declares disable-model-invocation: true | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| transitions-polish | project | not declared | Claude | Refine timing, easing, tokens or stagger in existing motion | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| ponytail | user | not declared | both | Leave a known shortcut or tech debt in code; use the "ponytail:" note convention | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| superpowers:using-git-worktrees | plugin + superpowers | 7.0.1 | both | Create or clean worktrees/branches under Worktree lifecycle rules (D-306) | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |
| find-skills | user | not declared | both | Find a skill for an uncovered need; ask the owner before installing anything | pre-existing, approved 2026-10-30 by owner | 2026-10-30 |

At the monthly review, compare these entries with installed skills in both tools and report missing, extra, version or availability drift. Other installed skills must be reported as drift for owner review; their presence alone does not add approval. When disabling or removing a skill, remove its routing reference and mark its registry entry disabled with the date in the same change. Keep the historical entry.

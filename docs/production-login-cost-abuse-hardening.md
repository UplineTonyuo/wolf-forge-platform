# Production login and cost-abuse hardening

Verified against HEAD `332f9f9b1ccd932c6e1312b4451f4f6a5a6b1ec6` and the preserved working tree on 2026-08-27. This document describes the reviewed implementation; deployment status belongs in `.ai-memory/01 Current State.md`.

## Public attack surface

| Surface | Auth / authorization | Normal frequency | Cost and mutation risk | Existing and selected controls | Repeated failure |
|---|---|---:|---|---|---|
| `POST /login` (`signInAction`) | Anonymous; Supabase Auth proves credentials, then server resolves INTERNAL or CLIENT assignment | A few attempts per user session | One Vercel action, BotID check, 1–3 limiter RPCs, Auth network call, then profile/role reads; session mutation | Uniform response, email 320/password 1024 pre-bound, BotID Basic, HMAC source/identity fingerprints, durable source and source+identity limits, identity-only risk observation, trusted Vercel IP forwarding | Generic response; pair cooldown after 3/min, 6/10m, 12/h; source capped 12/min and 120/h |
| `/f/[canonicalKey]` read | Anonymous; only published form projection | Human page views | Bounded DB read and transfer | RLS/read model; no application bot provider on GET | Normal controlled error |
| `submitPublicFormAction` / `app_submit_public_form` | Anonymous or authenticated; published form/token rules inside RPC | One submit per completed form | Form submission, values and activity mutation | Idempotent request UUID; 256 KiB aggregate, 300 values, 16 KiB/8,000 chars each; per-form 10/min, 60/h, 300/day; global anonymous 30/min, 300/h; optional identity 5/h, 10/day; bot-token seam exists but provider remains unconfigured | SQLSTATE `WF429`, transaction rollback, generic client-safe error |
| Gmail OAuth callback | OAuth state + PKCE; final account authorization is server-derived | Only while connecting Gmail | Token exchange and encrypted credential persistence | Signed/expiring state, PKCE, safe redirect, secret redaction | Controlled refusal; no account data disclosed |
| Direct Supabase Auth endpoints | Supabase project Auth policy | Login/token operations only | Auth invocation/email provider usage | Supabase provider token buckets; hosted signup and forwarded-IP switches require production verification | Provider-controlled generic/rate-limit response |

No password-reset UI/action exists. No public signup UI exists; account provisioning is an authorized internal workflow. Local Supabase configuration now disables open signup and requires eight-character passwords. Hosted Auth must be checked separately before promotion.

## Authenticated route and action inventory

All entries below verify the session server-side and derive the actor through Auth/RPC; database RLS and RPC authorization remain authoritative. Server Actions inherit Next's explicit 1 MiB aggregate request-body ceiling, and domain schemas apply narrower field/array bounds.

| Tier | Routes/actions | Expected use | Main cost | Abuse / idempotency posture |
|---|---|---|---|---|
| A | sign-out; notification list/read; subscription calendars; ordinary entity reads rendered by Server Components | Per navigation or user click | Small indexed reads/writes | Actor/company scoping, bounded notification page (50), RLS; sign-out invalidates the session |
| A/B | client search and global search | Interactive typing/search | Parallel indexed DB queries and response transfer | Query/result bounds; global 60/actor/min; client 30/actor/min and 120/company/min; authenticated actor and module authorization |
| B | client, project/order, service/folder, coupon, invoice and subscription CRUD; bulk project status/assign/archive | Human form submits; occasional bounded bulk use | Multiple transactional rows, activity/notification fan-out | Zod bounds, RLS/RPC authorization, request UUIDs on creates where duplicate business objects matter; bulk arrays are schema-bounded |
| B | ticket create/reply/note/status/priority/assignment | Human support workflow | Ticket/message/activity writes | Request UUID idempotency on creates/replies/notes; client create 10/h and 30/day; internal create 60/h and 300/day; replies 6/conversation/min, 200/conversation/day, 10/actor/min, 120/actor/h; notes 20/min, 500/day |
| B | Team live/sync/typing/presence and read actions | Adaptive live cadence while UI is open | Repeated Vercel invocation plus Team RPC/read transfer | Same-origin, authenticated INTERNAL-only Team RPCs, no overlapping client requests, visibility/offline pause, jitter/backoff; JSON route bodies now stream-bounded to 8/4/4/2 KiB |
| B/C | Team send/reply/forward/group/task/reaction/search/delete | Human collaborative mutation/search | Message/task writes, read-model/search work, notification fan-out | UUID idempotency on send/reply/forward/task creation; messages 30/min and 200/h; task create 20/min; search/reaction/delete 60/min; text, member, paging and search bounds |
| C | reporting draft/create/save/send/discard and recipient/service reads | Occasional staff report workflow | Large structured payloads, report rows and notification fan-out | `reports.send` authorization; sends 20/actor/hour and 30/recipient-company/hour where the company is available; sections/entries/text schema bounds; request UUIDs on create/send; database authorization and failure rollback |
| C | avatar upload/remove/profile/password change | Infrequent self-service | Vercel body handling, image validation, Storage upload/delete, audit writes, Auth call | 2 MiB decoded avatar limit and accepted media types; upload claim/persist 5/min, 15/h, 30/day; self-service group 20/min, 100/h, 300/day; password provider limits |
| C | Gmail connect/disconnect/verify routes | Rare administrator action | External OAuth/Gmail API calls | INTERNAL integration permission, same-origin on POST, signed OAuth state/PKCE, safe error/log redaction; verify 5/actor/min and 20/hour with HTTP 429 |
| C | account provisioning and Stripe-customer ensure | Rare owner/admin action | Supabase Auth Admin, multiple DB mutations, or Stripe API | Permission checks; provisioning 10/actor/hour; Stripe customer 30/actor/hour and 10/company/hour; bounded schemas, cleanup/compensation and Stripe idempotency |
| C | balance adjustments, invoice payments/refunds, store purchase and membership | Deliberate economic mutation | Locked financial rows, ledger/order/invoice/notification fan-out | Atomic RPCs, request UUID idempotency, server-derived prices/amounts, row locks; coupon probes 15/min, 100/h, 300/day; invoice pay 20/min, 100/h; purchase actor limits |
| B | public/assigned form authoring, publish/archive/assignment/correction | Human staff/client workflow | Structured form definitions and answer rows | Schema caps (500 fields/rules/service links, bounded HTML/text), request UUID idempotency on publish/archive/submit, RLS and RPC permissions |

There are no export/import, AI-generation, or bulk-file-processing endpoints in the reviewed tree.

## Wolf Forge threat model

- Brute force: BotID rejects recognized automation before application/database/Auth work. Durable source+identity failures create progressive fixed-window cooldowns.
- Credential stuffing: source attempt buckets bound one network source; identity pressure aggregates across sources for security telemetry; Supabase provider limits remain a final layer.
- Enumeration: every credential-stage refusal—unknown user, bad password, bot, limiter, malformed input or provider failure—returns the same browser message. No pre-auth profile lookup occurs.
- Distributed targeting: identity fingerprints aggregate the signal, but identity alone never denies. This detects pressure without letting an attacker lock out a victim merely by knowing their email.
- Reset flooding: not applicable because recovery is absent. If introduced, it must use the same generic response pattern, Supabase recovery limits and a durable source+identity policy.
- Bot traffic: BotID Basic is invisible and keyless for ordinary login. A visible Turnstile challenge is not imposed on every user. Supabase Turnstile remains the escalation option if direct Auth abuse is observed.
- Denial of wallet: edge bot classification precedes server work; expensive RPCs have actor limits and bounded payloads; Team scheduling pauses/backoffs and never overlaps requests. Vercel Firewall and spend alerts remain operator controls.
- Duplicate mutation: request UUIDs and unique constraints protect high-risk creates/sends/economic actions; retry returns the original domain result where supported.
- Large payload: Server Actions are capped at 1 MiB; public forms/avatar and domain fields are narrower; Team route handlers reject oversized streams before JSON parsing or Auth/DB work.
- Authenticated abuse: actor-scoped and sometimes conversation/day limits constrain high-risk actions while preserving normal business use. Server/RPC authorization is unchanged.
- Self-inflicted storms: Team's fast/warm/quiet/background scheduler uses single-flight requests, visibility/offline pausing, jitter and failure backoff. Live and background lanes are separated.

## Selected login architecture

1. `botid` Basic protects only POST requests to `/login`. Normal users see no CAPTCHA.
2. The application accepts a source only from Vercel's overwritten `x-vercel-forwarded-for` header and validates that it is exactly one IP. Local development uses a fixed loopback subject; arbitrary forwarded headers are ignored.
3. The server derives keyed SHA-256 fingerprints from the existing server secret. Raw IPs and emails never enter the counter table or security metadata.
4. A service-role-only preflight uses the existing concurrency-safe `private.rate_limit_counters`. It caps each source at 12 attempts/minute and 120/hour, and blocks a source+identity pair after 3 failures/minute, 6/10 minutes, or 12/hour.
5. Identity-wide failure counters flag 10 failures/10 minutes or 30/hour, but never deny. A correct login from another source therefore remains possible.
6. Supabase receives `Sb-Forwarded-For` only from the secret-key Auth client, so provider limits can key on the browser source once the hosted forwarding switch is enabled. Post-auth data access immediately returns to the user-scoped access-token client.
7. A successful credential proof clears only the source+identity cooldown. Source and identity risk history remains. Expired fixed-window rows are index-backed and removed by bounded opportunistic cleanup.
8. BotID or limiter failure is closed in production and generic to the browser. Logs contain event codes, stage and correlation ID—not email, password, tokens, CAPTCHA values or provider prose.

## Bot-control decision

BotID Basic is the smallest robust fit because Wolf Forge already runs on Vercel, Basic is invisible, covers the login Server Action, needs no site secret and avoids a challenge for normal users. Vercel Firewall should provide coarse pre-invocation rate/challenge rules after observing Preview traffic. Supabase Turnstile is not enabled in this code change: it would normally require a token on every Auth call and, when enabled at the Auth provider, would also cover direct Supabase Auth traffic. It is the preferred escalation if direct-provider bot traffic is confirmed; use an invisible widget and show interaction only when Cloudflare decides it is necessary.

## Remaining production/operator gates

- Verify hosted Auth has public signup disabled, the intended password policy, and appropriate email/token quotas.
- Explicitly enable Supabase `Sb-Forwarded-For` handling before relying on per-visitor provider buckets. Without it, the application limiter works but Supabase may still see shared Vercel egress.
- Review Vercel Firewall observed traffic, then add a narrow `/login` POST rate rule in log mode before challenge/deny. Avoid query-specific variants that attackers can rotate.
- Configure Spend Management notifications at 50%, 75%, 90% and 100% of the team's chosen monthly incremental budget. Do not enable automatic pause without accepting the availability tradeoff.
- Keep Function, Data Transfer, Supabase Database/Auth/Realtime and log-volume alerts separate. Included credits are not a hard ceiling.
- Do not promote until the migration exists in the target database and a Preview validates correct INTERNAL and CLIENT login with temporary QA credentials.

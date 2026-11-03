# Team voice signed upload and streaming WebM repair

The reported Team Inbox error occurs before finalization. The browser was sending POST to a signed Storage upload URL; the installed Storage SDK consumes that URL with PUT. Production edge logs on 29 October 2026 show signing POST200 at11:14:17UTC, CORS OPTIONS200 and upload POST400 at11:14:18UTC, with signed tokens and object paths withheld. This matches the old PR30 transport fix, which remained outside main rather than being reverted.

The following validation stage also still rejected a streaming WebM file when music-metadata had no Segment Duration. That is the historical KI-058 condition. Transport alone would expose that second error. The repair uses the existing bounded WebM/Opus byte-timing parser only for canonical WebM/Opus with undefined duration. It never treats the browser timer as the authoritative duration. Existing size, maximum length, MIME and timer-disagreement checks remain. Explicit invalid duration and missing Ogg/MP4 duration still fail closed.

## Changed boundaries

- Browser signed upload uses PUT; multipart audio bytes/MIME, cacheControl and x-upsert:false remain intact. HTTP/network failures are generic and do not automatically replay.
- Server media inspection reuses the existing ticket WebM/Opus timing utility; no new parser/dependency, database migration, policy change, key or permission grant.
- Tests exercise actual installed metadata parsing on synthetic duration-less WebM, byte-derived duration/limits/MIME, malformed media and upload method/body/failure behavior.
- A CI-only test uses the actual private Storage service with synthetic bytes, verifies readback through the real Team inspector and refusal to overwrite, then removes only its own randomized fixture path. It requires disposable GitHub Actions Linux, reads local CLI-generated credentials privately and refuses hosted endpoints. It never creates a Team message or contacts a real person.

## Preparation evidence

Before the repair, seven of ten new assertions failed: three showed POST instead of PUT and four hit the missing-duration rejection before their intended boundary. After the repair,67focused tests across7files passed; focused ESLint and whitespace checks passed. The separate CI test's imports/collection were checked locally without running Storage or Docker. Full CI and hosted readback are release gates; local test results are not a claim of production acceptance.

Sources: [installed-version SDK upload contract](https://github.com/supabase/supabase-js/blob/v2.112.3/packages/core/storage-js/src/packages/StorageFileApi.ts#L320), [Supabase signed uploads](https://supabase.com/docs/reference/javascript/storage-from-uploadtosignedurl).

No William/client message, real recording, existing upload, role or customer record is used for QA. The remaining voice/video-call branch and navigation/Gmail candidate work are separate. Local Docker and RojanCRM stay untouched. Detailed redacted logs, CI and rollout receipts belong in the parent task's outputs/team-voice-upload-20261029 report.

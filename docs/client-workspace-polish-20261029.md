# Client workspace improvements — 29 October 2026

This branch adds client project status filters, compact form actions, shared voice recording/playback controls, and a narrowly scoped compatibility policy for an existing frozen WordPress intake field.

## Behavior

- Projects: tap All, Pending, Getting started, Wolf Forge working, Waiting for reply, Needs information, Completed or Canceled. Counts and results update from the already-authorized project DTO without a new request or a status mutation. Canceled projects are no longer grouped under Completed.
- Forms: Save and continue later sits beside Submit Form, wraps on narrow phones, and retains distinct saving/success/error feedback. The existing handlers, encrypted capture-before-save, validation and preview/readonly behavior remain.
- Audio: shared Wolf Forge navy/gold recording strip and private player replace bulky native controls on existing supported Team/Ticket surfaces. Stop/Cancel, play/pause, keyboard seeking, timers, single active playback, explicit retry and bounded loading are supported. No private audio is fetched before Play. Initial Ticket duration is unknown until loaded because its existing DTO contains no duration; the UI shows --:-- rather than inventing a value.
- WordPress: the reported assigned form retains version 1, which disabled its password field. Version 2 is already published with encrypted collection, but assignments/order-start gates deliberately retain their original versions. A private exact-version/field/schema-hash policy enables encrypted collection without rebinding assignments or rewriting signed definitions. An optional server-projected boolean controls rendering; the database remains authoritative.

## Boundaries

The existing private Vault/reference workflow remains: passwords do not enter ordinary answers, drafts, receipts or PDFs. Current actor/company/Tenant/version/assignment authorization and late checks remain. Public forms and unrelated/social/unsupported secret fields are not automatically enabled.

The policy manifest is limited to the reviewed legacy WordPress version/field. It checks the expected original hash, enabled current counterpart, optional/null-default field, active assignment and pending frozen order-start map. Fresh databases without those production IDs skip seeding; partial/drifted matches refuse migration.

Private policy writes are serialized with encrypted collection writes; schema/history reads remain lock-free. Neither assignment IDs nor version/hash/settings/agreement/signature/history are migrated. No generalized historical-version access is added.

No local Docker, RojanCRM, customer messages, email, calls or credentials are used for QA. This work does not change existing Team recording roles or enable voice creation for native Project conversations.

## Verification and remaining gates

Focused component/repository/security regressions and a seven-width actual-component Chrome harness are available. The harness uses synthetic data and server-action/Next adapters; it is not authenticated app, provider, microphone, submission or device acceptance.

Full build/typecheck and isolated database/concurrency checks must pass on the final integrated head before rollout. Full local typecheck exceeded the deliberately small 512 MiB heap limit; no local build/server or memory cleanup was attempted.

Evidence outside this repo: outputs/client-workspace-polish-20261029 (metadata-only production version/gate reads, screenshots, visual checks, CI and final report). Do not commit raw logs or private values.

## Video-call status

The calling foundation is already committed and pushed to draft PR76 at 1aa8841f42d19264b15aaa1566973d55ccdd973a. It is not merged/live; the review gate and incoming-call/live-provider work remain. Do not revive or commit the superseded dirty Daily pilot as missing calling work (D-307/D-308).

## Rollout

After green final-head checks, separately verify the current production function sources/owners/ACLs and exact manifest. Preserve recovery definitions/metadata and existing backup. Apply only the reviewed new migration with bounded locks/statements, verify policy/function readback and unchanged business/evidence fingerprints, then release the matching app. Keep additive secure capture/guards on app rollback; revoke only the exact policy if the compatibility enablement must be withdrawn.

Never submit a real client form or send a voice message for automated QA. Device acceptance and real client-workspace checks remain owner-led.

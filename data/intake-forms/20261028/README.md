# Unpublished intake draft package

These 37 draft definitions cover the captured 59-service WOAD catalog. They are review data, not active platform records. Nothing imports, publishes, assigns or emails them automatically.

The original 25 templates/47 service links are preserved. The remaining 12 have per-service drafts: two adapted from related Press Releases/Guest Posts forms, and ten new Sprint/System forms based on the existing service descriptions. All 12 additions use the approved Company No Refund Policy and required drawn signatures. Credential prompts in the older templates remain disabled.

Before publication:
- Decide whether Press Release Stack buyers provide four finished articles or briefs the team writes from.
- Confirm which target URLs the Tier 2 Guest Post service allows.
- Review the ten new Sprint/System question sets.
- Reconcile existing published test-form assignments through the authorized form workflow; do not blindly import the complete bundle.

manifest.json records payload hashes and 59 planned service links; service-catalog.json is the captured product catalog, not a live database query. new-drafts-review.json records reference/proposed status and outstanding content decisions. drafts/ contains schema-valid create-form payloads without client answers or credentials.

Run the intake-draft-bundle Vitest suite to check schema, frozen payload hashes, exactly-one planned assignment per captured service, policy identity and disabled credential prompts. This proves the package, not actual Auth/RLS/purchase activation.

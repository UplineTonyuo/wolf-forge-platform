import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Source preservation check only; pgTAP and real concurrent sessions remain required.
const migrationPath = "supabase/migrations/20261028123000_purchase_intake_internal_notifications.sql";
const migration = readFileSync(migrationPath, "utf8");
const priorReaders = readFileSync("supabase/migrations/20261011172233_coupons_module_enforcement.sql", "utf8");
for (const name of ["app_list_my_notifications", "app_mark_notification_read", "app_mark_all_notifications_read"]) {
  const pattern = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`);
  const prior = priorReaders.match(pattern)?.[0];
  const current = migration.match(pattern)?.[0];
  assert(prior && current, `${name} is present`);
  assert.equal(current.replace(
    /    and private\.purchase_intake_notification_visible\(\n      caller_id, notification\.event_key, notification\.entity_type, notification\.entity_id\n    \)\n/, "",
  ), prior, `${name} preserves all previous authorization and contracts`);
}
const fanoutPattern = /create or replace function private\.emit_internal_notification_for_permission[\s\S]*?\$function\$;/;
const priorFanout = readFileSync("supabase/migrations/20261008230000_tenant_internal_notification_isolation.sql", "utf8").match(fanoutPattern)?.[0];
const currentFanout = migration.match(fanoutPattern)?.[0];
assert(priorFanout && currentFanout);
assert.equal(currentFanout.replace(
  /    and private\.purchase_intake_notification_visible\(\n      membership_row\.profile_id, p_event_key, p_entity_type, p_entity_id\n    \)\n/, "",
), priorFanout, "fanout preserves existing Tenant, membership, capability and deduplication guards");
assert(!/function public\.(app_purchase_service_with_balance|app_submit_form)\b/i.test(migration));
assert(!/create (?:table|extension)|push_subscriptions|studio_push_configuration/i.test(migration));
assert.equal(readdirSync("supabase/migrations").filter((name) => name.startsWith("20261028123000_")).length, 1);
const files = [
  migrationPath,
  "supabase/tests/database/169_purchase_intake_internal_notifications.test.sql",
  "supabase/tests/isolation/purchase_intake_notification_replay.spec",
];
for (const path of files) {
  const text = readFileSync(path, "utf8");
  assert(!text.startsWith("\uFEFF"), `${path} has no parser-confusing BOM`);
  assert(!/[^\S\r\n]+\r?$/m.test(text), `${path} has no trailing whitespace`);
}
// isolationtester's SQL blocks cannot contain literal closing braces, even in strings.
const spec = readFileSync(files[2], "utf8");
for (const line of spec.split("\n")) {
  assert(!line.includes("}") || /^\s*}\s*$/.test(line) || /^step "\w+" \{ commit; }\s*$/.test(line), "valid isolation block delimiter");
}
console.log("PASS notification source preservation and file checks (not SQL runtime validation)");

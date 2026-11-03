import assert from "node:assert/strict";
import { test } from "node:test";
import { endedCallWasRead } from "./check-ticket-call-transport.mjs";

test("lifecycle acceptance requires a successful authoritative empty-call read", async () => {
  assert.equal(await endedCallWasRead(Response.json({ ok: true, data: { call: null } })), true);
  assert.equal(await endedCallWasRead(Response.json({ ok: true, data: { call: { state: "ringing" } } })), false);
  for (const status of [401, 403, 503]) {
    assert.equal(await endedCallWasRead(Response.json({ ok: false }, { status })), false, `HTTP ${status} must not pass lifecycle acceptance`);
  }
  assert.equal(await endedCallWasRead(Response.json({ ok: false })), false);
  assert.equal(await endedCallWasRead(Response.json({ ok: true, data: {} })), false);
});

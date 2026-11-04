import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

if (process.env.CI !== "true") throw new Error("Calling concurrency tests run only on disposable CI");
if (process.env.GITHUB_ACTIONS !== "true" || process.platform !== "linux" || process.env.DATABASE_URL || process.env.SUPABASE_ACCESS_TOKEN) throw new Error("Requires an isolated GitHub Linux runner without hosted credentials");
const database = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const tenant = "f0f0f0f0-0000-4000-8000-000000001701";
const uid = n => `20000000-0000-4000-8000-00000000${n}`;
const ticket = n => `e1700000-0000-4000-8000-00000000${n}`;
const device = n => `72000000-0000-4000-8000-00000000${n}`;
const requestId = n => `71000000-0000-4000-8000-00000000${n}`;

class Session {
  constructor(name) {
    this.name = name; this.sequence = 0; this.pending = null; this.buffer = ""; this.errors = "";
    this.process = spawn("psql", [database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      env: { ...process.env, PGAPPNAME: name, PGCONNECT_TIMEOUT: "10" }, stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stdout.setEncoding("utf8"); this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", chunk => {
      this.buffer += chunk;
      let boundary;
      while ((boundary = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, boundary).trim(); this.buffer = this.buffer.slice(boundary + 1);
        if (!this.pending) continue;
        if (line === this.pending.marker) {
          const pending = this.pending; this.pending = null; clearTimeout(pending.timer); pending.resolve(pending.lines);
        } else if (line) this.pending.lines.push(line);
      }
    });
    this.process.stderr.on("data", chunk => { this.errors = (this.errors + chunk).slice(-4000); });
    const fail = error => { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; } };
    this.process.on("error", fail);
    this.process.on("exit", code => fail(new Error(`psql ${name} exited ${code}: ${this.errors}`)));
    this.process.stdin.on("error", fail);
  }
  query(sql) {
    assert.equal(this.pending, null, "one query at a time per physical connection");
    return new Promise((resolve, reject) => {
      const marker = `__calling_done_${++this.sequence}__`;
      const timer = setTimeout(() => { this.pending = null; reject(new Error(`Timed out: ${this.name}`)); this.process.kill(); }, 30000);
      this.pending = { marker, lines: [], resolve, reject, timer };
      this.process.stdin.write(`${sql}\nselect '${marker}';\n`);
    });
  }
  close() { this.process.stdin.end(); }
}
const actor = (n, sid = n) => `do $$begin
  perform set_config('request.jwt.claims','${JSON.stringify({ sub: uid(n), role: "authenticated", session_id: `33000000-0000-4000-8000-00000000${sid}` })}',true);
  perform set_config('request.headers','${JSON.stringify({ "x-wf-tenant": tenant })}',true);
end$$; set local role authenticated;`;
const request = (t, id, recipient = t === "1702" ? "1705" : "1704") => `select public.app_request_ticket_call('${ticket(t)}','${requestId(id)}','${device("0001")}','audio',${recipient ? `'${uid(recipient)}'` : "null"});`;
const command = (action, id, d = "0002") => `select public.app_ticket_call_command('${action}','${id}','${device(d)}');`;
const json = lines => JSON.parse(lines.at(-1));
const observer = new Session("calling-observer");
let caseNumber = 0;
async function reset() {
  await observer.query(`delete from private.ticket_calls where tenant_id='${tenant}';`);
}
async function resetCostFixtures() {
  await reset();
  await observer.query(`delete from private.rate_limit_counters where scope like 'ticket-call-%' or scope='call-push.subscription';
    delete from private.ticket_call_signal_leases;
    delete from private.ticket_call_push_devices;
    delete from private.studio_push_configuration;`);
}
const refusedRows = (count, user = "1701") => `insert into private.ticket_calls(id,request_id,ticket_id,tenant_id,initiated_by,mode,participants,state,outcome,created_at,expires_at,reconciled_at)
  select gen_random_uuid(),gen_random_uuid(),'${ticket("1701")}','${tenant}','${uid(user)}','audio',array['${uid(user)}'::uuid],
   'ended','refused',now()-interval '1 hour',now()-interval '45 minutes',now() from generate_series(1,${count});`;
const pushOrigin = "https://wolf-forge-platform-callstest-wolf-forge.vercel.app";
const pushFixture = `insert into public.tenant_domains(host,tenant_id,verified_at) values
 ('wolf-forge-platform-callstest-wolf-forge.vercel.app','${tenant}',now()) on conflict(host) do nothing;
 insert into private.studio_push_configuration(singleton,enabled,project_url,origin,tenant_id,public_key,vapid_secret_id,api_key_secret_id)
 values(true,true,'https://rsnmlcyopnxucwgfttyf.supabase.co','${pushOrigin}','${tenant}',repeat('A',87),gen_random_uuid(),gen_random_uuid());
 insert into private.ticket_call_push_devices(profile_id,tenant_id,session_id,endpoint,origin,enabled)
 select '${uid("1704")}','${tenant}','33000000-0000-4000-8000-000000001704',
 'https://fcm.googleapis.com/cost-fixture-'||n,'${pushOrigin}',false from generate_series(1,19) n;`;
const push = suffix => `select public.app_set_my_call_push_subscription('https://fcm.googleapis.com/cost-${suffix}','${pushOrigin}',true);`;
const openStream = "select public.app_ticket_call_signal_context();";
const streamLease = (action, id) => `select public.app_ticket_call_signal_lease('${action}','${id}');`;

async function oldFunction(file, signature) {
  const source = await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
  const marker = new RegExp(`create (?:or replace )?function public\\.${signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const match = marker.exec(source);
  assert.ok(match, `Baseline function exists: ${signature}`);
  const end = source.indexOf("end $$;", match.index);
  assert.ok(end > match.index);
  return source.slice(match.index, end + 8).replace(/^create (?:or replace )?function/, "create or replace function");
}
async function baseline(name, definition, check) {
  await observer.query(`begin; ${definition}`);
  try { await check(); console.log(`PASS baseline reproduction ${name}: SQL executed; all changes rolled back`); }
  finally { await observer.query("rollback;"); }
}
async function invite(t = "1701", user = "1701") {
  return json(await observer.query(`begin; ${actor(user)} ${request(t, "0001")} commit;`));
}
async function race(name, leftActor, leftSql, rightActor, rightSql, verify, expectRightFailure = false, whileBlocked = async () => {}) {
  const a = new Session(`calling-a-${++caseNumber}`); const b = new Session(`calling-b-${caseNumber}`);
  try {
    await a.query(`begin; ${actor(leftActor)}`); await b.query(`begin; ${actor(rightActor)}`);
    const aPid = Number((await a.query("select pg_backend_pid();"))[0]);
    const bPid = Number((await b.query("select pg_backend_pid();"))[0]);
    assert.notEqual(aPid, bPid, "race uses distinct database sessions");
    const left = await a.query(leftSql);
    // Observe an actual blocked backend before committing the winner.
    const rightPromise = b.query(rightSql).then(lines => ({ lines }), error => ({ error }));
    let blocked = false;
    for (let n = 0; n < 100; n++) {
      const waiting = await observer.query(`select coalesce(wait_event_type='Lock',false) from pg_stat_activity where pid=${bPid};`);
      if (waiting[0] === "t") { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(blocked, "losing transaction genuinely overlapped and waited on the winner");
    await whileBlocked();
    await a.query("commit;");
    const right = await rightPromise;
    if (expectRightFailure) assert.match(right.error?.message ?? "", expectRightFailure instanceof RegExp ? expectRightFailure : /Call already taken or ended|Call unavailable/);
    else { assert.ok(!right.error, right.error?.message); await b.query("commit;"); }
    await verify(left, right.lines);
    console.log(`PASS ${name}: two overlapping transactions; persisted winner/effects checked`);
  } finally { a.close(); b.close(); }
}
try {
  await observer.query(await readFile(new URL("../../supabase/tests/fixtures/ticket_calls.inc", import.meta.url), "utf8"));
  await observer.query(`insert into auth.sessions(id,user_id,aal,not_after) values
    ('33000000-0000-4000-8000-000000001799','${uid("1704")}','aal1',now()+interval '1 day'),
    ('33000000-0000-4000-8000-000000001798','${uid("1704")}','aal1',now()+interval '1 day');`);
  await reset();
  let call = await invite();
  await race("two-device accept", "1704", command("accept", call.id), "1704", command("accept", call.id, "0003"), async () => {
    const rows = await observer.query(`select callee_device_id from private.ticket_calls where id='${call.id}';`);
    assert.equal(rows[0], device("0002"));
    assert.equal(Number((await observer.query("select count(*) from private.ticket_call_claims;"))[0]), 2);
  }, true);

  await reset(); call = await invite();
  await race("distinct authenticated sessions", "1704", command("accept", call.id), "1704",
    `${actor("1704", "1799")} ${command("accept", call.id)}`, async () => {
      assert.equal((await observer.query(`select callee_session_id from private.ticket_calls where id='${call.id}';`))[0],
        "33000000-0000-4000-8000-000000001704");
    }, true);

  await reset(); call = await invite();
  await race("accept then cancel", "1704", command("accept", call.id), "1701", command("cancel", call.id), async () => {
    assert.equal((await observer.query(`select state from private.ticket_calls where id='${call.id}';`))[0], "ended");
    assert.equal(Number((await observer.query("select count(*) from private.ticket_call_claims;"))[0]), 0);
  });
  await reset(); call = await invite();
  await race("cancel then accept", "1701", command("cancel", call.id), "1704", command("accept", call.id), async () => {
    assert.equal((await observer.query(`select state from private.ticket_calls where id='${call.id}';`))[0], "ended");
  }, true);

  await reset(); call = await invite();
  await observer.query(`update private.ticket_calls set ring_deadline=clock_timestamp()+interval '3 seconds' where id='${call.id}';`);
  await race("accept deadline expires while blocked", "1701", command("status", call.id), "1704", command("accept", call.id), async (left) => {
    assert.equal(json(left).state, "ringing");
    assert.equal((await observer.query(`select accepted_at is null from private.ticket_calls where id='${call.id}';`))[0], "t");
    await observer.query("select private.process_ticket_call_deadlines();");
    assert.equal((await observer.query(`select outcome from private.ticket_calls where id='${call.id}';`))[0], "missed");
  }, true, () => observer.query("select pg_sleep(3.2);"));

  await reset();
  await race("opposite directions", "1701", request("1701", "0010"), "1704", request("1701", "0011", null), async (left, right) => {
    assert.equal(json(left).state, "ringing"); assert.equal(json(right).outcome, "busy");
    assert.equal(Number((await observer.query("select count(*) from private.ticket_call_reservations;"))[0]), 1);
  });
  await reset();
  await race("same participant across Tickets", "1701", request("1701", "0012"), "1702", request("1703", "0013"), async (_left, right) => {
    assert.equal(json(right).outcome, "busy");
    assert.equal(Number((await observer.query("select count(*) from private.ticket_call_claims;"))[0]), 2);
  });

  await reset();
  await observer.query(`insert into private.ticket_calls(id,request_id,ticket_id,tenant_id,initiated_by,mode,participants,state,legacy,created_at,expires_at)
    select ('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,gen_random_uuid(),'${ticket("1701")}','${tenant}',
      '${uid("1705")}','audio',array['${uid("1705")}'::uuid],'ended',true,now()-interval '20 minutes',now()-interval '5 minutes'
      from generate_series(1,19) n;
    insert into private.ticket_call_reservations select id,date_trunc('month',now())::date,1800,1800
      from private.ticket_calls where legacy and tenant_id='${tenant}';`);
  await race("last account budget admission", "1701", request("1701", "0014"), "1702", request("1704", "0015", "1703"), async (left, right) => {
    assert.equal(json(left).state, "ringing"); assert.equal(json(right).outcome, "refused");
    assert.equal(Number((await observer.query("select sum(coalesce(settled_seconds,reserved_seconds)) from private.ticket_call_reservations;"))[0]), 36000);
  });
  assert.deepEqual((await observer.query("select month||':'||seconds from private.ticket_call_month_slices('2026-10-31 23:55Z','2026-11-01 00:10Z') order by month;"))
    .map(row => { const [month, seconds] = row.split(":"); return [month, Number(seconds)]; }),
    [["2026-10-01", 600], ["2026-11-01", 1200]]);
  console.log("PASS UTC month rollover: both worst-case monthly portions accounted");

  // Reproduce the old definitions transactionally on this disposable backend.
  // Rollback restores head definitions/data; these are never installed on a hosted target.
  await resetCostFixtures(); call = await invite();
  await observer.query(`begin; ${actor("1704")} ${command("accept", call.id)} commit;`);
  const oldCommands = await oldFunction("20261103161636_ticket_call_inbox_followups.sql", "app_ticket_call_command(");
  await baseline("CALL-DOW-01", oldCommands, async () => {
    await observer.query(`update private.ticket_calls set provider_state='ready',room_claim_id=gen_random_uuid(),token_attempts=8 where id='${call.id}';`);
    const claim = json(await observer.query(`${actor("1704")} ${command("setup", call.id)}`));
    assert.equal(claim.id, call.id, "old SQL still grants a lookup claim when token attempts are exhausted");
  });
  const oldInvite = await oldFunction("20261103161636_ticket_call_inbox_followups.sql", "app_request_ticket_call(p_ticket_id uuid,p_request_id uuid,p_device_id uuid,p_mode text,p_recipient_id uuid)");
  await baseline("CALL-DOW-06", oldInvite, async () => {
    await observer.query(`insert into private.rate_limit_counters(scope,subject,window_start,expires_at,hits)
      select 'ticket-call-request','${uid("1701")}',b,b+interval '2 minutes',60
      from generate_series(date_trunc('minute',clock_timestamp()),date_trunc('minute',clock_timestamp())+interval '1 minute',interval '1 minute') b
      on conflict(scope,subject,window_start) do update set hits=excluded.hits;`);
    assert.equal(json(await observer.query(`${actor("1701")} ${request("1701", "0001")}`)).id, call.id);
  });
  await baseline("CALL-DOW-03", oldInvite, async () => {
    await observer.query(refusedRows(29));
    assert.equal(json(await observer.query(`${actor("1701")} ${request("1701", "0080")}`)).outcome, "busy");
    assert.equal(Number((await observer.query("reset role; select count(*) from private.ticket_calls;"))[0]), 31);
  });
  await resetCostFixtures();
  const oldPush = await oldFunction("20261103114405_ticket_call_interface_delivery.sql", "app_set_my_call_push_subscription(");
  await baseline("CALL-DOW-04", oldPush, async () => {
    await observer.query(pushFixture);
    await observer.query(`${actor("1704")} ${push("baseline-a")} ${push("baseline-b")}`);
    assert.equal(Number((await observer.query("reset role; select count(*) from private.ticket_call_push_devices;"))[0]), 21);
  });
  const oldContext = await oldFunction("20261103161636_ticket_call_inbox_followups.sql", "app_ticket_call_signal_context()");
  await baseline("CALL-DOW-02", oldContext, async () => {
    await observer.query(actor("1704"));
    for (let n = 0; n < 4; n++) assert.ok(json(await observer.query(openStream)).topic);
    assert.equal(Number((await observer.query("reset role; select count(*) from private.ticket_call_signal_leases;"))[0]), 0);
  });
  call = await invite();
  await observer.query(`begin; ${actor("1704")} ${command("accept", call.id)} commit;`);
  const oldEvidence = await oldFunction("20261028200140_ticket_call_evidence_history.sql", "app_ingest_ticket_call_evidence(");
  await baseline("CALL-DOW-05", oldEvidence, async () => {
    await observer.query(`update private.ticket_calls set created_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes',
     accepted_at=now()-interval '19 minutes',ring_deadline=now()-interval '19 minutes 20 seconds',
     connect_deadline=now()-interval '18 minutes 15 seconds',provider_state='ready',state='connecting' where id='${call.id}';`);
    const evidence = `jsonb_build_object('account','wolfforge','callId','${call.id}','eventId','cost-baseline','meetingId','cost-baseline',
     'endedAt',now()-interval '6 minutes','intervals',jsonb_build_array(jsonb_build_object('sessionId','baseline-caller',
     'profileId','${uid("1701")}','joinedAt',now()-interval '18 minutes','leftAt',now()-interval '8 minutes')))`;
    await observer.query(`select public.app_ingest_ticket_call_evidence(${evidence});`);
    const version = Number((await observer.query(`select version from private.ticket_calls where id='${call.id}';`))[0]);
    assert.equal((await observer.query(`select public.app_ingest_ticket_call_evidence(${evidence});`))[0], "f");
    assert.equal(Number((await observer.query(`select version from private.ticket_calls where id='${call.id}';`))[0]), version + 1);
    assert.equal(Number((await observer.query(`select count(*) from private.ticket_call_events where call_id='${call.id}' and event='provider_evidence';`))[0]), 2);
  });

  await resetCostFixtures();
  await observer.query(refusedRows(29));
  await race("last actor durable record", "1701", request("1701", "0081"), "1701", request("1701", "0082"), async () => {
    assert.equal(Number((await observer.query("select count(*) from private.ticket_calls;"))[0]), 30);
  }, /Call history limit reached/);
  await resetCostFixtures();
  await observer.query(refusedRows(119, "1705"));
  await race("last account durable record", "1701", request("1701", "0083"), "1702", request("1704", "0084", "1703"), async () => {
    assert.equal(Number((await observer.query("select count(*) from private.ticket_calls;"))[0]), 120);
  }, /Call history limit reached/);
  await resetCostFixtures();
  await observer.query(pushFixture);
  await race("last retained device", "1704", push("race-a"), "1704", push("race-b"), async () => {
    assert.equal(Number((await observer.query("select count(*) from private.ticket_call_push_devices;"))[0]), 20);
  }, /Device history limit reached/);
  await resetCostFixtures();
  await observer.query(`begin; ${actor("1704")} ${openStream} ${openStream} commit;`);
  await race("last same-session tab", "1704", openStream, "1704", openStream, async () => {
    assert.equal(Number((await observer.query("select count(*) from private.ticket_call_signal_leases;"))[0]), 3);
  }, /Call stream limit reached/);
  const lease = (await observer.query("select id from private.ticket_call_signal_leases order by id limit 1;"))[0];
  await race("disconnect versus renewal", "1704", streamLease("release", lease), "1704", streamLease("renew", lease), async (_left, right) => {
    assert.deepEqual(right, [], "psql represents a refused SQL NULL renewal as an empty row");
    assert.equal(Number((await observer.query(`select count(*) from private.ticket_call_signal_leases where id='${lease}';`))[0]), 0);
  });
  await observer.query(`begin; ${actor("1704", "1799")} ${openStream} ${openStream} ${openStream} commit;`);
  await race("last profile slot across sessions", "1704", openStream, "1704", `${actor("1704", "1798")} ${openStream}`, async () => {
    assert.equal(Number((await observer.query("select count(*) from private.ticket_call_signal_leases;"))[0]), 6);
  }, /Call stream limit reached/);

  // A refused retry must not wait for the account lock or enter its sweep.
  await resetCostFixtures(); call = await invite();
  await observer.query(`insert into private.rate_limit_counters(scope,subject,window_start,expires_at,hits)
   select 'ticket-call-request','${uid("1701")}',b,b+interval '2 minutes',60
   from generate_series(date_trunc('minute',clock_timestamp()),date_trunc('minute',clock_timestamp())+interval '1 minute',interval '1 minute') b
   on conflict(scope,subject,window_start) do update set hits=excluded.hits;`);
  const holder = new Session("cost-global-lock-holder"), denied = new Session("cost-early-denial");
  try {
    await holder.query("begin; select private.ticket_call_lock();");
    await assert.rejects(denied.query(`begin; set local statement_timeout='2s'; ${actor("1701")} ${request("1701", "0001")}`), /rate limit exceeded/);
    console.log("PASS matching retry denied while another physical session holds account lock");
  } finally { await holder.query("rollback;"); holder.close(); denied.close(); }
  await resetCostFixtures();
  await observer.query(refusedRows(30));
  const capHolder = new Session("cost-cap-lock-holder"), capDenied = new Session("cost-cap-early-denial");
  try {
    await capHolder.query("begin; select private.ticket_call_lock();");
    await assert.rejects(capDenied.query(`begin; set local statement_timeout='2s'; ${actor("1701")} ${request("1701", "0090")}`), /Call history limit reached/);
    console.log("PASS exhausted fresh-record allowance refused before held account lock");
  } finally { await capHolder.query("rollback;"); capHolder.close(); capDenied.close(); }
  await resetCostFixtures();
  const nativeOrder = 'e2040000-0000-4000-8000-000000009001';
  const nativeTask = 'e2040000-0000-4000-8000-000000009002';
  await observer.query(`insert into public.services(id,tenant_id,name) values
    ('e2040000-0000-4000-8000-000000009003','${tenant}','Synthetic native race service');
    insert into public.orders(id,tenant_id,company_id,service_id,title,status,assigned_to_profile_id) values
    ('${nativeOrder}','${tenant}','e0000000-0000-4000-8000-000000001701','e2040000-0000-4000-8000-000000009003','Synthetic native race','working','${uid('1704')}');
    insert into public.order_tasks(id,order_id,title,assigned_to_profile_id) values
    ('${nativeTask}','${nativeOrder}','Synthetic native assignee','${uid('1705')}');`);
  const nativeInvite = (id, recipient='1704') => `select public.app_request_order_call('${nativeOrder}','${requestId(id)}','${device('9001')}','audio','${uid(recipient)}');`;
  await race('native same-request replay', '1701', nativeInvite('9001'), '1701', nativeInvite('9001'), async(left,right)=>{
    assert.equal(json(left).id,json(right).id);
    assert.equal(Number((await observer.query(`select count(*) from private.ticket_calls where order_id='${nativeOrder}';`))[0]),1);
    assert.equal(Number((await observer.query('select count(*) from private.ticket_call_reservations;'))[0]),1);
  });
  await resetCostFixtures();
  await race('native disjoint-pair one-live admission', '1701', nativeInvite('9002'), '1702', nativeInvite('9003','1705'), async(left,right)=>{
    assert.equal(json(left).state,'ringing');assert.equal(json(right).outcome,'busy');
    assert.equal(Number((await observer.query('select count(*) from private.ticket_call_reservations;'))[0]),1);
    assert.equal(Number((await observer.query(`select count(*) from private.ticket_calls where order_id='${nativeOrder}' and state<>'ended';`))[0]),1);
  });
  await resetCostFixtures();
  // Separate native conversations and participants still share the account budget.
  const secondNativeOrder='e2040000-0000-4000-8000-000000009004';
  await observer.query(`insert into public.orders(id,tenant_id,company_id,service_id,title,status,assigned_to_profile_id)
    select '${secondNativeOrder}',tenant_id,company_id,service_id,'Synthetic other native race','working','${uid('1705')}' from public.orders where id='${nativeOrder}';
    insert into private.ticket_calls(id,request_id,ticket_id,tenant_id,initiated_by,mode,participants,state,legacy,created_at,expires_at)
    select gen_random_uuid(),gen_random_uuid(),'${ticket('1701')}','${tenant}','${uid('1705')}','audio',array['${uid('1705')}'::uuid],'ended',true,now()-interval '20 minutes',now()-interval '5 minutes' from generate_series(1,19);
    insert into private.ticket_call_reservations select id,date_trunc('month',now())::date,1800,1800 from private.ticket_calls where legacy and tenant_id='${tenant}';`);
  await race('native last shared account budget admission','1701',nativeInvite('9005'),'1702',
    `select public.app_request_order_call('${secondNativeOrder}','${requestId('9006')}','${device('9002')}','audio','${uid('1705')}');`,async(left,right)=>{
      assert.equal(json(left).state,'ringing');assert.equal(json(right).outcome,'refused');
      assert.equal(Number((await observer.query('select sum(coalesce(settled_seconds,reserved_seconds)) from private.ticket_call_reservations;'))[0]),36000);
    });
  await resetCostFixtures();
  await race('native task recipient revoked while request waits', '1704',
    `reset role; update public.order_tasks set assigned_to_profile_id=null where id='${nativeTask}';`,
    '1701',nativeInvite('9004','1705'),async()=>{
      assert.equal(Number((await observer.query(`select count(*) from private.ticket_calls where order_id='${nativeOrder}';`))[0]),0);
      assert.equal(Number((await observer.query('select count(*) from private.ticket_call_reservations;'))[0]),0);
    },/Call unavailable/);

  const company='e0000000-0000-4000-8000-000000001701';
  await observer.query(`update public.tenant_memberships set role_id=(select id from public.roles where name='manager') where tenant_id='${tenant}' and profile_id='${uid('1705')}';`);
  const assignManager=`select public.app_assign_client_manager('${company}','${uid('1705')}');`;
  await race('manager archival wins eligibility race','1704',
    `reset role; update public.tenant_memberships set archived_at=clock_timestamp() where tenant_id='${tenant}' and profile_id='${uid('1705')}';`,
    '1704',assignManager,async()=>{
      assert.equal(Number((await observer.query(`select count(*) from private.client_manager_assignments where company_id='${company}';`))[0]),0);
    },/Choose an active manager/);
  await observer.query(`update public.tenant_memberships set archived_at=null where tenant_id='${tenant}' and profile_id='${uid('1705')}';`);
  await race('manager concurrent assignment persists and audits once','1704',assignManager,'1704',assignManager,async()=>{
    assert.equal((await observer.query(`select manager_profile_id from private.client_manager_assignments where company_id='${company}';`))[0],uid('1705'));
    assert.equal(Number((await observer.query(`select count(*) from public.activity_events where entity_id='${company}' and metadata->>'field'='manager_profile_id';`))[0]),1);
  });
  await race('manager assignment locks eligibility through persistence','1704',assignManager,'1704',
    `reset role; update public.tenant_memberships set archived_at=clock_timestamp() where tenant_id='${tenant}' and profile_id='${uid('1705')}';`,async()=>{
      assert.equal((await observer.query(`select manager_profile_id from private.client_manager_assignments where company_id='${company}';`))[0],uid('1705'));
      assert.equal(Number((await observer.query(`select count(*) from public.activity_events where entity_id='${company}' and metadata->>'field'='manager_profile_id';`))[0]),1);
    });
  await observer.query(`update public.tenant_memberships set archived_at=null where tenant_id='${tenant}' and profile_id='${uid('1705')}';`);
  for (const [suffix, permission] of [
    ['9001', "'clients.edit'"],
    ['9002', "(select required_permission_key from public.permission_modules where module_key='clients')"],
  ]) {
    const account=`e2030000-0000-4000-8000-00000000${suffix}`;
    await observer.query(`insert into public.companies(id,tenant_id,name,status) values('${account}','${tenant}','Synthetic operator revocation account','client');`);
    await race(`manager operator authority revoked during account wait (${suffix})`,'1703',
      `reset role; update public.companies set name=name where id='${account}';
       insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
       values('${tenant}','${uid('1704')}',${permission},false)
       on conflict(tenant_id,profile_id,permission_key) do update set allowed=false;`,
      '1704',`select public.app_assign_client_manager('${account}','${uid('1705')}');`,async()=>{
        assert.equal(Number((await observer.query(`select count(*) from private.client_manager_assignments where company_id='${account}';`))[0]),0);
        assert.equal(Number((await observer.query(`select count(*) from public.activity_events where entity_id='${account}' and metadata->>'field'='manager_profile_id';`))[0]),0);
      },/permission denied|module access is denied/);
    await observer.query(`delete from public.profile_permission_overrides where tenant_id='${tenant}' and profile_id='${uid('1704')}' and permission_key=${permission};`);
  }
  await observer.query(`delete from public.notifications where recipient_profile_id='${uid('1701')}';
    insert into public.notifications(recipient_profile_id,tenant_id,company_id,audience,category,title,body,href,event_key,created_at)
    select '${uid('1701')}','${tenant}','${company}','client','client','Synthetic opening race','Synthetic activity','/account','opening-race:'||n,clock_timestamp()-interval '1 hour' from generate_series(1,151) n;`);
  const openingStamp=new Date().toISOString();
  const opening=`select public.app_open_client_notifications('${requestId('9050')}','${openingStamp}');`;
  await race('notification opening replay excludes a later arrival','1701',opening,'1701',opening,async(left,right)=>{
    assert.equal(json(left).readCount,151);assert.equal(json(right).readCount,151);
    assert.equal(Number((await observer.query(`select count(*) from public.notifications where recipient_profile_id='${uid('1701')}' and read_at is null;`))[0]),1);
  },false,()=>observer.query(`insert into public.notifications(recipient_profile_id,tenant_id,company_id,audience,category,title,body,href,event_key,created_at)
    values('${uid('1701')}','${tenant}','${company}','client','client','Synthetic later arrival','Synthetic activity','/account','opening-race:later',clock_timestamp());`));
} finally {
  await resetCostFixtures().catch(() => {});
  observer.close();
}

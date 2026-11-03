import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

if (process.env.CI !== "true") throw new Error("Calling concurrency tests run only on disposable CI");
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
const request = (t, id) => `select public.app_request_ticket_call('${ticket(t)}','${requestId(id)}','${device("0001")}','audio');`;
const command = (action, id, d = "0002") => `select public.app_ticket_call_command('${action}','${id}','${device(d)}');`;
const json = lines => JSON.parse(lines.at(-1));
const observer = new Session("calling-observer");
let caseNumber = 0;
async function reset() {
  await observer.query(`delete from private.ticket_calls where tenant_id='${tenant}';`);
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
    if (expectRightFailure) assert.match(right.error?.message ?? "", /Call already taken or ended|Call unavailable/);
    else { assert.ok(!right.error, right.error?.message); await b.query("commit;"); }
    await verify(left, right.lines);
    console.log(`PASS ${name}: two overlapping transactions; persisted winner/effects checked`);
  } finally { a.close(); b.close(); }
}
try {
  await observer.query(await readFile(new URL("../../supabase/tests/fixtures/ticket_calls.inc", import.meta.url), "utf8"));
  await observer.query(`insert into auth.sessions(id,user_id,aal,not_after) values
    ('33000000-0000-4000-8000-000000001799','${uid("1704")}','aal1',now()+interval '1 day');`);
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
  await race("opposite directions", "1701", request("1701", "0010"), "1704", request("1701", "0011"), async (left, right) => {
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
  await race("last account budget admission", "1701", request("1701", "0014"), "1702", request("1704", "0015"), async (left, right) => {
    assert.equal(json(left).state, "ringing"); assert.equal(json(right).outcome, "refused");
    assert.equal(Number((await observer.query("select sum(coalesce(settled_seconds,reserved_seconds)) from private.ticket_call_reservations;"))[0]), 36000);
  });
  assert.deepEqual((await observer.query("select month||':'||seconds from private.ticket_call_month_slices('2026-10-31 23:55Z','2026-11-01 00:10Z') order by month;"))
    .map(row => { const [month, seconds] = row.split(":"); return [month, Number(seconds)]; }),
    [["2026-10-01", 600], ["2026-11-01", 1200]]);
  console.log("PASS UTC month rollover: both worst-case monthly portions accounted");
} finally {
  await reset().catch(() => {});
  observer.close();
}

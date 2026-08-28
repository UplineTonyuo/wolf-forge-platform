/**
 * Team Communication hosted-latency ledger.
 *
 * Reconciles local QA with the deployed preview. Every measurement below runs
 * against the REAL browser transport — real HttpOnly cookies, real route
 * handlers, real RPCs — and can be re-run with WF_DB_RTT_SIMULATION_MS set so
 * each Supabase round trip costs what it costs from a Vercel function instead
 * of what it costs on loopback.
 *
 * No message body ever reaches this ledger. Only ids, timestamps and durations.
 */
import { execFileSync, spawn } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

const baseUrl = process.env.QA_BASE_URL ?? "http://localhost:3100";
const apiUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.QA_TEAM_PASSWORD;
const simulatedRtt = Number.parseInt(process.env.WF_DB_RTT_SIMULATION_MS ?? "0", 10) || 0;
const samples = Number.parseInt(process.env.QA_SAMPLES ?? "7", 10);

if (!apiUrl || !secretKey || !password) throw new Error("Local QA environment is incomplete.");

const admin = createClient<Database>(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const accounts = {
  sender: { email: "qa-team-v22-sender@example.test", name: "QA V22 Sender" },
  reader: { email: "qa-team-v22-reader@example.test", name: "QA V22 Reader" },
} as const;

const dbContainer = process.env.QA_DB_CONTAINER ?? "supabase_db_Wolf-Forge-Platform";

function querySql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { encoding: "utf8", windowsHide: true },
  ).trim();
}

/**
 * One long-lived psql session.
 *
 * `docker exec` costs 300-500 ms to attach and tear down, which is larger than
 * the latency being measured: with a fresh exec per send, the recipient could
 * be seen discovering the message BEFORE the command that sent it returned.
 * Holding one session open puts the host-clock reference within a few
 * milliseconds of the commit.
 */
class PsqlSession {
  private readonly child = spawn(
    "docker",
    ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-tAq", "-v", "ON_ERROR_STOP=1"],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );

  private buffered = "";
  private pending: ((lines: string[]) => void) | null = null;

  constructor() {
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffered += chunk;
      const marker = this.buffered.indexOf("__WF_END__");
      if (marker === -1 || !this.pending) return;
      const lines = this.buffered
        .slice(0, marker)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      this.buffered = this.buffered.slice(marker + "__WF_END__".length);
      const resolve = this.pending;
      this.pending = null;
      resolve(lines);
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      if (chunk.trim()) console.error("[psql]", chunk.trim());
    });
  }

  run(sql: string): Promise<string[]> {
    return new Promise((resolve) => {
      /*
       * Anything still buffered belongs to a statement that has already been
       * answered — psql's startup banner, or a marker that arrived between two
       * runs. Left in place it would resolve THIS run instantly with the
       * previous run's rows, which is how a send appeared to be discovered
       * before it happened.
       */
      this.buffered = "";
      this.pending = resolve;
      this.child.stdin.write(`${sql}\n\\echo __WF_END__\n`);
    });
  }

  close() {
    this.child.stdin.end();
  }
}

const ids: Record<string, string> = {};

async function removeQaUsers() {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const matches = listed.data.users.filter((user) => user.email?.startsWith("qa-team-v22-"));
  if (matches.length === 0) return;
  const list = matches.map((user) => `'${user.id}'::uuid`).join(",");
  querySql(
    [
      `delete from public.team_tasks where created_by_profile_id in (${list}) or assigned_to_profile_id in (${list});`,
      `delete from public.team_messages where author_profile_id in (${list});`,
      `delete from public.team_conversation_members where profile_id in (${list});`,
      `delete from public.team_conversations where id not in (select conversation_id from public.team_conversation_members);`,
      `delete from public.team_message_deliveries where recipient_profile_id in (${list});`,
      `delete from public.notifications where recipient_profile_id in (${list});`,
    ].join(" "),
  );
  for (const user of matches) {
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
  }
}

async function provisionFixtures() {
  await removeQaUsers();
  const roles = await admin.from("roles").select("id,name").eq("name", "admin");
  if (roles.error) throw roles.error;
  const roleId = roles.data[0]!.id;

  for (const [key, account] of Object.entries(accounts)) {
    const created = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw created.error ?? new Error("Fixture user missing.");
    ids[key] = created.data.user.id;
    const updated = await admin
      .from("profiles")
      .update({ role_id: roleId, display_name: account.name, archived_at: null, company_id: null })
      .eq("id", created.data.user.id);
    if (updated.error) throw updated.error;
  }
}

async function login(context: BrowserContext, email: string) {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("PAGE_ERROR", error.message));
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.locator('input[name="password"]').fill(password!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  return page;
}

function quote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function asActor(actorId: string, sql: string) {
  return (
    `set local role authenticated; ` +
    `select set_config('request.jwt.claims', json_build_object('sub','${actorId}','role','authenticated')::text, true); ` +
    sql
  );
}

/**
 * Sends one message as the given actor.
 *
 * The reference point is the host clock the instant psql returns, NOT the row's
 * own created_at: the Docker VM clock drifts against the host by a variable
 * ~60-200 ms, which is the same order as the latency being measured and
 * produced negative discovery times. psql returns within a few milliseconds of
 * the commit, so this understates discovery slightly and never invents it.
 */
async function sendAs(session: PsqlSession, actorId: string, conversationId: string, body: string) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const lines = await session.run(
    `begin; set local role authenticated; ` +
      `select set_config('request.jwt.claims', json_build_object('sub','${actorId}','role','authenticated')::text, true); ` +
      `select public.app_send_team_message('${requestId}'::uuid, '${conversationId}'::uuid, ${quote(body)}) ->> 'id'; ` +
      `commit;`,
  );
  const committedAt = Date.now();
  return {
    messageId: lines[lines.length - 1]!,
    committedAt,
    /* How much of the reported latency is send-side ambiguity rather than transport. */
    commitWindowMs: committedAt - startedAt,
  };
}

function startConversation(actorId: string, otherId: string) {
  const raw = querySql(
    asActor(actorId, `select public.app_start_team_conversation('${otherId}'::uuid);`),
  );
  return raw.split("\n").filter(Boolean).pop()!.trim();
}

function progress(step: string) {
  console.error(`[ledger] ${new Date().toISOString()} ${step}`);
}

function stats(values: number[]) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const at = (fraction: number) =>
    ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)]!;
  return {
    n: ordered.length,
    min: Math.round(ordered[0]!),
    median: Math.round(at(0.5)),
    p95: Math.round(at(0.95)),
    max: Math.round(ordered[ordered.length - 1]!),
  };
}

/**
 * The recipient's poller, running inside the real page so it carries the real
 * cookies. It records first-chunk arrival separately from full-response
 * completion — the one measurement that says whether streaming actually bought
 * anything, or whether the proxy held the early chunk until the slow work
 * finished.
 */
const pollerSource = String.raw`
(async (options) => {
  const log = [];
  window.__wfLedger = log;
  window.__wfSummary = () => log;
  window.__wfStop = false;

  const absorb = (entry, raw) => {
    const part = raw && raw.ok === true && raw.data ? raw.data : raw;
    const detail = part && part.detail ? part.detail : part;
    if (detail && Array.isArray(detail.typing)) {
      entry.typingCount = detail.typing.length;
    }
    const conversations = part && (part.signals || part.conversations);
    if (Array.isArray(conversations)) {
      for (const row of conversations) {
        entry.lastMessageIds[row.conversation_id] = row.last_message_id || null;
      }
    }
  };

  const post = async (body) => {
    const startedAt = Date.now();
    const response = await fetch(options.endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const entry = {
      startedAt,
      serverTiming: response.headers.get("server-timing"),
      headersAt: Date.now(),
      firstChunkAt: null,
      doneAt: null,
      typingCount: 0,
      lastMessageIds: {},
    };
    const contentType = response.headers.get("content-type") || "";
    if (contentType.indexOf("ndjson") >= 0) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      for (;;) {
        const read = await reader.read();
        if (read.value && entry.firstChunkAt === null) entry.firstChunkAt = Date.now();
        buffered += decoder.decode(read.value, { stream: !read.done });
        const lines = buffered.split(String.fromCharCode(10));
        buffered = lines.pop() || "";
        for (const line of lines) if (line) absorb(entry, JSON.parse(line));
        if (read.done) break;
      }
      if (buffered) absorb(entry, JSON.parse(buffered));
    } else {
      absorb(entry, await response.json());
      entry.firstChunkAt = Date.now();
    }
    entry.doneAt = Date.now();
    if (entry.firstChunkAt === null) entry.firstChunkAt = entry.doneAt;
    log.push(entry);
  };

  while (!window.__wfStop) {
    const tickStartedAt = Date.now();
    try {
      await post(options.body);
    } catch (error) {
      log.push({ startedAt: tickStartedAt, error: String(error) });
    }
    const remaining = options.intervalMs - (Date.now() - tickStartedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
})
`;

/**
 * Deliberately compact. The transcript itself must never cross the CDP bridge:
 * it would put message bodies in the ledger, and serializing it on every poll
 * would cost more than the latency being measured.
 */
type LedgerEntry = {
  startedAt: number;
  serverTiming: string | null;
  headersAt: number;
  firstChunkAt: number | null;
  doneAt: number | null;
  typingCount: number;
  lastMessageIds: Record<string, string | null>;
};

async function startPoller(
  page: Page,
  options: { endpoint: string; body: unknown; intervalMs: number },
) {
  /*
   * Started, not awaited. The loop only ends when __wfStop is set, so awaiting
   * the promise it returns would hang the measurement instead of running it.
   */
  await page.evaluate(
    `(() => { void (${pollerSource})(${JSON.stringify(options)}); return true; })()`,
  );
}

async function stopPoller(page: Page) {
  await page.evaluate("window.__wfStop = true");
  await page.waitForTimeout(80);
}

async function readLedger(page: Page): Promise<LedgerEntry[]> {
  return (await page.evaluate("window.__wfSummary()")) as LedgerEntry[];
}

function serverPhase(entry: LedgerEntry, name: string) {
  const match = new RegExp(`${name};dur=([\\d.]+)`).exec(entry.serverTiming ?? "");
  return match ? Number.parseFloat(match[1]!) : 0;
}

progress("provisioning");
await provisionFixtures();
progress("provisioned");
const conversationId = startConversation(ids.sender!, ids.reader!);

const browser = await chromium.launch({ headless: true });
/* A crashed measurement must not leave a browser polling a deleted account. */
process.once("exit", () => void browser.close());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void browser.close().finally(() => process.exit(1));
  });
}
/*
 * Reported, not swallowed. Registering a handler here suppresses Node's own
 * crash, so without re-raising the failure the run would exit 0 having
 * measured nothing.
 */
process.once("uncaughtException", (error) => {
  console.error("[ledger] FAILED", error);
  void browser.close().finally(() => process.exit(1));
});
const senderContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const readerContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const senderPage = await login(senderContext, accounts.sender.email);
progress("sender logged in");
const readerPage = await login(readerContext, accounts.reader.email);
progress("reader logged in");

const psql = new PsqlSession();

const typingIntervalMs = Number.parseInt(process.env.QA_LIVE_INTERVAL_MS ?? "700", 10);
const peekIntervalMs = Number.parseInt(process.env.QA_PEEK_INTERVAL_MS ?? "1200", 10);

const report: Record<string, unknown> = {
  simulatedRoundTripMs: simulatedRtt,
  typingIntervalMs,
  peekIntervalMs,
  baseUrl,
  samples,
};

// ---------------------------------------------------------------------------
// 1. Typing — sender write cost, and recipient discovery through whichever
//    synchronization path serves an open thread.
// ---------------------------------------------------------------------------
{
  const connectionId = crypto.randomUUID();
  /*
   * The open drawer's real request, not a trimmed one: it folds the slower
   * list and roster reads into the same round trip, which is exactly the
   * coupling this ledger exists to measure.
   */
  await startPoller(readerPage, {
    endpoint: process.env.QA_LIVE_ENDPOINT ?? "/api/team-live",
    body: JSON.parse(
      process.env.QA_LIVE_BODY ?? JSON.stringify({ conversationId, since: null }),
    ),
    intervalMs: typingIntervalMs,
  });
  await readerPage.waitForTimeout(1_500);

  const senderWrites: number[] = [];
  const discoveries: number[] = [];

  for (let index = 0; index < samples; index += 1) {
    const before = await readLedger(readerPage);
    const touch = (await senderPage.evaluate(
      async ([id, connection]) => {
        const startedAt = Date.now();
        const response = await fetch("/api/team-typing", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: "touch", conversationId: id, connectionId: connection }),
        });
        return {
          startedAt,
          doneAt: Date.now(),
          status: response.status,
          serverTiming: response.headers.get("server-timing"),
        };
      },
      [conversationId, connectionId],
    )) as { startedAt: number; doneAt: number; status: number; serverTiming: string | null };

    progress(`typing sample ${index} touched in ${touch.doneAt - touch.startedAt}ms`);
    if (touch.status !== 204) throw new Error(`typing touch returned ${touch.status}`);
    senderWrites.push(touch.doneAt - touch.startedAt);

    const deadline = Date.now() + 15_000;
    let detectedAt: number | null = null;
    while (Date.now() < deadline && detectedAt === null) {
      const ledger = await readLedger(readerPage);
      for (const entry of ledger.slice(before.length)) {
        if ((entry.typingCount ?? 0) > 0) {
          detectedAt = entry.firstChunkAt ?? entry.doneAt;
          break;
        }
      }
      if (detectedAt === null) await readerPage.waitForTimeout(30);
    }
    if (detectedAt === null) throw new Error("typing was never observed by the recipient");
    progress(`typing sample ${index} discovered in ${detectedAt - touch.startedAt}ms`);
    discoveries.push(detectedAt - touch.startedAt);

    await senderPage.evaluate(
      async ([id, connection]) => {
        await fetch("/api/team-typing", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: "clear", conversationId: id, connectionId: connection }),
        });
      },
      [conversationId, connectionId],
    );
    /*
     * Randomised, not fixed. A constant gap lands every sample at the same
     * phase of the poll cycle, which reports one arbitrary point instead of the
     * distribution a real keystroke would meet.
     */
    await readerPage.waitForTimeout(1_200 + Math.random() * typingIntervalMs);
  }

  const ledger = await readLedger(readerPage);
  await stopPoller(readerPage);

  const observed = ledger.filter((entry) => entry.doneAt != null);
  report.typing = {
    senderWriteMs: stats(senderWrites),
    recipientDiscoveryMs: stats(discoveries),
    responseHeadersMs: stats(observed.map((entry) => entry.headersAt - entry.startedAt)),
    firstChunkMs: stats(observed.map((entry) => entry.firstChunkAt! - entry.startedAt)),
    fullResponseMs: stats(observed.map((entry) => entry.doneAt! - entry.startedAt)),
    streamingGainMs: stats(observed.map((entry) => entry.doneAt! - entry.firstChunkAt!)),
    serverContextMs: stats(observed.map((entry) => serverPhase(entry, "team-context"))),
  };
}

// ---------------------------------------------------------------------------
// 2. Off-thread peek — committed message to the first moment the background
//    synchronization path could have discovered it.
// ---------------------------------------------------------------------------
{
  await startPoller(readerPage, {
    endpoint: process.env.QA_PEEK_ENDPOINT ?? "/api/team-live",
    body: JSON.parse(
      process.env.QA_PEEK_BODY ?? JSON.stringify({ conversationId: null, since: null }),
    ),
    intervalMs: peekIntervalMs,
  });
  /* Let the cadence settle so the first sample is not measured mid-warm-up. */
  await readerPage.waitForTimeout(peekIntervalMs + 1_000);

  const first: number[] = [];
  const warm: number[] = [];
  const commitWindows: number[] = [];

  for (let index = 0; index < samples; index += 1) {
    const before = await readLedger(readerPage);
    const sent = await sendAs(psql, ids.sender!, conversationId, `ledger-${index}`);
    commitWindows.push(sent.commitWindowMs);

    const deadline = Date.now() + 25_000;
    let detectedAt: number | null = null;
    while (Date.now() < deadline && detectedAt === null) {
      const ledger = await readLedger(readerPage);
      for (const entry of ledger.slice(before.length)) {
        if (entry.lastMessageIds?.[conversationId] === sent.messageId) {
          detectedAt = entry.firstChunkAt ?? entry.doneAt;
          break;
        }
      }
      if (detectedAt === null) await readerPage.waitForTimeout(30);
    }
    if (detectedAt === null) throw new Error("message was never discovered by the background path");
    progress(`peek sample ${index} discovered in ${detectedAt - sent.committedAt}ms`);
    /*
     * Floored at zero. A poll already in flight when the row commits reports a
     * few milliseconds either side of it; below zero the number describes clock
     * granularity between two processes, not latency.
     */
    (index === 0 ? first : warm).push(Math.max(0, detectedAt - sent.committedAt));
    await readerPage.waitForTimeout(1_000 + Math.random() * peekIntervalMs);
  }

  await stopPoller(readerPage);
  report.offThreadPeek = {
    firstMessageMs: Math.round(first[0] ?? 0),
    warmMessageMs: stats(warm),
    commitWindowMs: stats(commitWindows),
  };
}

console.log(JSON.stringify(report, null, 2));

psql.close();
await browser.close();
await removeQaUsers();

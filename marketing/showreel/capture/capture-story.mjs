// Captures the 60s client-story screens into ../captures/story/: the client portal as
// Maya Chen (Harbor Fitness) and the agency side as Alex Morgan, both real renders of
// the local app. Needs the local stack (`npx supabase start`), the local QA accounts
// (`npm run qa:local-login`), capture/seed-demo.sql then capture/seed-story.sql applied,
// LOCAL_UI_QA_BYPASS=true in .env.local, and `npm run dev` on 127.0.0.1:3000.
//
// The client signs in with the local QA client credentials through Supabase's own
// password grant (no bypass) and the session cookies are handed to the browser; the
// staff side uses the local-only QA quick access. Between the "unpaid" and "paid"
// invoice shots the local invoice is marked paid, exactly as a settled payment would.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const outDir = path.resolve(here, "../captures/story");
const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
mkdirSync(outDir, { recursive: true });

const sql = (q) => execFileSync("psql", [DB_URL, "-Atc", q], { encoding: "utf8" }).trim();
const id = {
  hero: sql("select id from orders where title = 'SEO Growth Plan · Harbor Fitness'"),
  ticket: sql("select id from tickets where subject = 'Can we reply to Google reviews from the portal?'"),
  invoice: sql("select id from invoices where invoice_number = 5100"),
  report: sql("select id from client_reports where title = 'October results · Harbor Fitness'"),
  service: sql("select id from services where name = 'SEO Growth Plan' order by created_at limit 1"),
};

async function clientCookies() {
  const env = Object.fromEntries(readFileSync(path.join(repoRoot, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  const creds = JSON.parse(readFileSync(path.join(repoRoot, ".qa-local-credentials.client.json"), "utf8"));
  const jar = [];
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => jar,
      setAll: (cookies) => { for (const c of cookies) { const i = jar.findIndex((j) => j.name === c.name); if (i >= 0) jar.splice(i, 1); if (c.value) jar.push(c); } },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error) throw error;
  return jar.map((c) => ({ name: c.name, value: c.value, domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax" }));
}

// Page-space boxes (CSS px) of the elements the composition zooms to, clicks or reveals,
// written to captures/story/boxes.json so the camera never guesses coordinates.
const BOXES = {};
const SIDEBAR = ["Dashboard", "Projects", "Inbox", "Reporting", "Investments", "Invoices"];
const TARGETS = {
  "c-home.jpg": [...SIDEBAR, "Welcome back, Maya", "1 invoice is awaiting payment", "SEO Growth Plan · Harbor Fitness"],
  "c-store.jpg": [...SIDEBAR, "Every investment Wolf Forge offers", "SEO Sprints"],
  "c-store-item.jpg": ["SEO Growth Plan", "$1,200", "Talk to your team", "Recurring investments are arranged"],
  "c-project.jpg": ["SEO Growth Plan · Harbor Fitness", "Delivery progress", "3 of 5 delivery steps complete.", "Project created from a Store purchase", "Welcome aboard, Maya!", "Could we prioritise the new Westside", "Westside is first in the sprint", "Love how easy this is", "Write a reply"],
  "c-ticket.jpg": ["Can we reply to Google reviews from the portal?", "Hi team! We got 12 new Google reviews", "Great news, Maya!"],
  "c-invoice-unpaid.jpg": ["Invoice #WF-5100", "Unpaid", "$1,200.00", "Balance due"],
  "c-invoice-paid.jpg": ["Invoice #WF-5100", "Paid", "Amount paid", "Balance due"],
  "c-report-0.jpg": ["October results", "Next"],
  "c-report-1.jpg": ["Highlights", "+38% vs September", "Westside location page", "Next"],
  "c-report-2.jpg": ["Keyword rankings", "#3 (was #11)", "Keywords in top 10", "Next"],
  "c-report-3.jpg": ["Google Business Profile", "5,120", "+64%"],
  "s-orders.jpg": ["Projects", "SEO Growth Plan · Harbor Fitness", "Jordan Reyes"],
  "s-project.jpg": ["Welcome aboard, Maya!", "Could we prioritise the new Westside", "Westside is first in the sprint", "Love how easy this is"],
  "s-inbox-team.jpg": ["New SEO Growth Plan just came in", "I will take kickoff", "On the technical audit", "Maya says thank you"],
  "s-inbox-ticket.jpg": ["Hi team! We got 12 new Google reviews", "Great news, Maya!", "Message Maya Chen"],
  "s-invoices.jpg": ["Invoices", "WF-5100"],
};
async function measure(page, file) {
  const out = {};
  for (const text of TARGETS[file] ?? []) {
    const box = await page.getByText(text, { exact: false }).first().boundingBox().catch(() => null);
    if (box) out[text] = [box.x, box.y, box.x + box.width, box.y + box.height].map((v) => Math.round(v));
  }
  BOXES[file] = out;
}

async function shoot(page, route, file, { full = false, before } = {}) {
  if (route) {
    await page.goto(`${BASE}/${route}`, { timeout: 240000 });
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  if (before) await before(page);
  await page.waitForTimeout(1800);
  await page.mouse.move(page.viewportSize().width - 5, page.viewportSize().height - 5);
  await measure(page, file);
  const png = await page.screenshot({ fullPage: full });
  await sharp(png).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toFile(path.join(outDir, file));
  console.log(file);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

// --- client portal (Maya Chen, Harbor Fitness) ---
// Reset a previous run. The ledger is append-only by design, so this local-only reset
// skips the protecting triggers.
sql(`set session_replication_role = replica;
  delete from invoice_payments where invoice_id = '${id.invoice}';
  update invoices set status = 'unpaid' where id = '${id.invoice}';`);
const cookies = await clientCookies();
const client = await browser.newContext(desktop);
await client.addCookies(cookies);
const c = await client.newPage();
await shoot(c, "account", "c-home.jpg");
await shoot(c, "account/store", "c-store.jpg");
await shoot(c, `account/store/${id.service}`, "c-store-item.jpg");
await shoot(c, `account/projects/${id.hero}`, "c-project.jpg", { full: true });
await shoot(c, `account/messages/${id.ticket}`, "c-ticket.jpg");
await shoot(c, `account/invoices/${id.invoice}`, "c-invoice-unpaid.jpg");
await shoot(c, `account/reporting/${id.report}`, "c-report-0.jpg");
for (let step = 1; step <= 3; step++) {
  await shoot(c, null, `c-report-${step}.jpg`, { before: (p) => p.getByRole("button", { name: /^Next/ }).click() });
}
const clientMobile = await browser.newContext(mobile);
await clientMobile.addCookies(cookies);
const cm = await clientMobile.newPage();
await shoot(cm, "account", "m-c-home.jpg");
await shoot(cm, `account/projects/${id.hero}`, "m-c-project.jpg");

// The client pays: settle the invoice the way a succeeded payment does.
sql(`set session_replication_role = replica;
  insert into invoice_payments (invoice_id, amount_cents, currency, status, payment_method, processor, settled_at, request_id, created_by_profile_id)
  select id, total_cents, 'USD', 'succeeded', 'card', 'stripe', now(), gen_random_uuid(), client_profile_id from invoices where id = '${id.invoice}';
  update invoices set status = 'paid' where id = '${id.invoice}';`);
await shoot(c, `account/invoices/${id.invoice}`, "c-invoice-paid.jpg");

// --- agency side (Alex Morgan, local QA quick access) ---
const staff = await (await browser.newContext(desktop)).newPage();
await shoot(staff, "orders", "s-orders.jpg");
await shoot(staff, `orders/${id.hero}`, "s-project.jpg", { full: true });
await shoot(staff, `tickets/${id.ticket}`, "s-ticket.jpg");
// The Inbox drawer holds the team chat and the ticket threads. The header button sits under
// the notifications trigger's hit area, so it is clicked through the DOM.
const openInbox = async (p) => {
  await p.waitForLoadState("load");
  for (let attempt = 0; attempt < 5; attempt++) {
    await p.waitForTimeout(2000); // the post-sign-in refresh can swallow the first click
    if (await p.locator("[aria-label='Close Inbox']").first().isVisible().catch(() => false)) return; // drawer state persists across routes
    await p.locator("button[title=Inbox]").first().evaluate((el) => el.click());
    const open = await p.getByRole("button", { name: "Tickets" }).last().waitFor({ timeout: 6000 }).then(() => true, () => false);
    if (open) return;
  }
  throw new Error("Inbox drawer did not open");
};
await shoot(staff, "orders", "s-inbox-team.jpg", {
  before: async (p) => {
    await openInbox(p); await p.waitForTimeout(1500);
    await p.getByRole("button", { name: "Messages" }).last().click(); await p.waitForTimeout(1500);
    await p.getByText("Harbor Fitness · SEO Growth").first().click();
  },
});
await shoot(staff, "orders", "s-inbox-ticket.jpg", {
  before: async (p) => {
    await openInbox(p); await p.waitForTimeout(1500);
    await p.getByRole("button", { name: "Tickets" }).last().click(); await p.waitForTimeout(1500);
    await p.getByText("Can we reply to Google reviews from the portal?").first().click();
  },
});
await shoot(staff, "invoices", "s-invoices.jpg");
await browser.close();
writeFileSync(path.join(outDir, "boxes.json"), JSON.stringify(BOXES, null, 1));

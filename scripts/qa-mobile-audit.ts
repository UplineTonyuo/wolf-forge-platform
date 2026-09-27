/**
 * Local mobile/tablet responsiveness audit harness.
 *
 * Phase A (default): fast document-overflow sweep across every discovered route
 * at the audit viewport matrix. Writes one JSONL row per measurement so a
 * timeout never loses data.
 *
 * Phase B (AUDIT_MODE=deep): for the routes listed in AUDIT_DEEP_ROUTES, also
 * collects non-contained overflow offenders and screenshots.
 *
 * Read-only against the local stack; never submits a form or triggers a
 * purchase. Run: npx tsx scripts/qa-mobile-audit.ts
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
const mode = process.env.AUDIT_MODE === "deep" ? "deep" : "sweep";
const roleFilter = process.env.AUDIT_ROLE === "client" ? "client" : process.env.AUDIT_ROLE === "owner" ? "owner" : "both";
const routeFilter = new Set((process.env.AUDIT_ROUTES ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const screenshotAll = process.env.AUDIT_SCREENSHOTS === "all";
const screenshotWidths = new Set((process.env.AUDIT_SCREENSHOT_WIDTHS ?? "320,768").split(",").map(Number));
const outDir = resolve(tmpdir(), "wf-mobile-audit");
mkdirSync(outDir, { recursive: true });
const jsonlPath = resolve(outDir, `${mode}-${roleFilter}.jsonl`);
if (existsSync(jsonlPath)) writeFileSync(jsonlPath, "");

type Role = "owner" | "client";

function credentials(role: Role): { email: string; password: string } {
  const file = role === "owner" ? ".qa-local-credentials.json" : ".qa-local-credentials.client.json";
  return JSON.parse(readFileSync(resolve(import.meta.dirname, "..", file), "utf8")) as { email: string; password: string };
}

type RouteSpec = { path: string; role: Role; label: string; surface: string; note?: string };

const COMPANY = "a51fe758-16b8-4546-b657-39796cd43512";
const ORDER = "b6aab926-e928-48c3-ad40-47262e80bd47";
const TICKET_ANY = "cfcf0375-eed9-40d6-856c-a42badd78416";
const TICKET_QA = "cc823e91-58a2-4fd5-b7c5-8086e2db0256";
const SERVICE = "5f000000-0000-4000-8000-000000000030";
const FOLDER = "5e000000-0000-4000-8000-000000000001";
const MISSING = "00000000-0000-4000-8000-000000000000";

const routes: RouteSpec[] = [
  { path: "/login", role: "owner", label: "Login", surface: "PUBLIC/AUTH" },
  { path: "/activate", role: "owner", label: "Activate", surface: "PUBLIC/AUTH" },
  { path: "/f/mobile-audit-missing", role: "owner", label: "Public form (missing)", surface: "PUBLIC/AUTH", note: "not-found state" },
  { path: "/", role: "owner", label: "Internal root", surface: "INTERNAL" },
  { path: "/dashboard", role: "owner", label: "Dashboard", surface: "INTERNAL" },
  { path: "/orders", role: "owner", label: "Projects list", surface: "INTERNAL" },
  { path: "/orders/new", role: "owner", label: "New project", surface: "INTERNAL" },
  { path: `/orders/${ORDER}`, role: "owner", label: "Project detail", surface: "INTERNAL" },
  { path: `/orders/${ORDER}/edit`, role: "owner", label: "Project edit", surface: "INTERNAL" },
  { path: `/orders/${ORDER}/files`, role: "owner", label: "Project files", surface: "INTERNAL" },
  { path: `/orders/${ORDER}/history`, role: "owner", label: "Project history", surface: "INTERNAL" },
  { path: "/tickets", role: "owner", label: "Tickets list", surface: "TICKETS/INBOX" },
  { path: `/tickets/${TICKET_ANY}`, role: "owner", label: "Ticket detail", surface: "TICKETS/INBOX" },
  { path: "/reporting", role: "owner", label: "Reporting list", surface: "INTERNAL" },
  { path: "/reporting/new", role: "owner", label: "New report", surface: "INTERNAL" },
  { path: "/clients", role: "owner", label: "Clients list", surface: "CRM" },
  { path: "/clients/new", role: "owner", label: "New client", surface: "CRM" },
  { path: `/clients/${COMPANY}`, role: "owner", label: "Client detail", surface: "CRM" },
  { path: "/todo", role: "owner", label: "Operations", surface: "INTERNAL" },
  { path: "/todo/departments", role: "owner", label: "Departments", surface: "INTERNAL" },
  { path: "/todo/departments/content", role: "owner", label: "Dept: content", surface: "INTERNAL" },
  { path: "/todo/departments/gmb-management", role: "owner", label: "Dept: GMB", surface: "INTERNAL" },
  { path: "/todo/departments/off-page-seo", role: "owner", label: "Dept: off-page", surface: "INTERNAL" },
  { path: "/todo/departments/on-page-seo", role: "owner", label: "Dept: on-page", surface: "INTERNAL" },
  { path: "/todo/departments/podcast-seo", role: "owner", label: "Dept: podcast", surface: "INTERNAL" },
  { path: "/todo/departments/technical-seo", role: "owner", label: "Dept: technical", surface: "INTERNAL" },
  { path: "/todo/departments/website-builder", role: "owner", label: "Dept: web builder", surface: "INTERNAL" },
  { path: "/todo/departments/youtube-seo", role: "owner", label: "Dept: youtube", surface: "INTERNAL" },
  { path: "/invoices", role: "owner", label: "Invoices list", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: "/invoices/new", role: "owner", label: "New invoice", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: "/subscriptions", role: "owner", label: "Subscriptions list", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: "/subscriptions/new", role: "owner", label: "New subscription", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: "/coupons", role: "owner", label: "Coupons list", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: "/coupons/new", role: "owner", label: "New coupon", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: "/investment-intent", role: "owner", label: "Investment intent", surface: "CRM" },
  { path: "/services", role: "owner", label: "Services list", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: "/services/new", role: "owner", label: "New service", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: `/services/${SERVICE}`, role: "owner", label: "Service detail", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: "/services/folders/new", role: "owner", label: "New folder", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: `/services/folders/${FOLDER}`, role: "owner", label: "Folder detail", surface: "SERVICES/ORDERS/PURCHASE" },
  { path: "/forms", role: "owner", label: "Forms list", surface: "SETTINGS" },
  { path: "/forms/new", role: "owner", label: "New form", surface: "SETTINGS" },
  { path: "/team", role: "owner", label: "Team", surface: "SETTINGS" },
  { path: "/settings", role: "owner", label: "Settings", surface: "SETTINGS" },
  { path: "/settings/billing", role: "owner", label: "Settings: billing", surface: "SETTINGS" },
  { path: "/settings/general", role: "owner", label: "Settings: general", surface: "SETTINGS" },
  { path: "/settings/integrations", role: "owner", label: "Settings: integrations", surface: "SETTINGS" },
  { path: "/settings/notifications", role: "owner", label: "Settings: notifications", surface: "SETTINGS" },
  { path: "/settings/security", role: "owner", label: "Settings: security", surface: "SETTINGS" },
  { path: "/settings/team", role: "owner", label: "Settings: team", surface: "SETTINGS" },
  { path: "/accounts/client/new", role: "owner", label: "New client account", surface: "CRM" },
  { path: "/accounts/member/new", role: "owner", label: "New member account", surface: "CRM" },
  { path: "/companies/new", role: "owner", label: "New company", surface: "CRM" },
  { path: "/account", role: "client", label: "Client dashboard", surface: "CLIENT PORTAL" },
  { path: "/account/projects", role: "client", label: "Client projects", surface: "CLIENT PORTAL" },
  { path: `/account/projects/${ORDER}`, role: "client", label: "Client project detail", surface: "CLIENT PORTAL" },
  { path: "/account/messages", role: "client", label: "Client inbox", surface: "CLIENT PORTAL" },
  { path: `/account/messages/${TICKET_QA}`, role: "client", label: "Client ticket conversation", surface: "CLIENT PORTAL" },
  { path: "/account/onboarding", role: "client", label: "Client onboarding", surface: "CLIENT PORTAL" },
  { path: "/account/reporting", role: "client", label: "Client reporting", surface: "CLIENT PORTAL" },
  { path: "/account/store", role: "client", label: "Store catalogue", surface: "CLIENT PORTAL" },
  { path: `/account/store/${SERVICE}`, role: "client", label: "Store service detail", surface: "CLIENT PORTAL" },
  { path: "/account/invoices", role: "client", label: "Client invoices", surface: "CLIENT PORTAL" },
  { path: "/account/subscriptions", role: "client", label: "Client subscriptions", surface: "CLIENT PORTAL" },
  { path: "/account/payment-method", role: "client", label: "Payment method", surface: "CLIENT PORTAL" },
  { path: "/account/profile", role: "client", label: "Client profile", surface: "CLIENT PORTAL" },
  { path: `/account/onboarding/${MISSING}`, role: "client", label: "Onboarding detail (missing)", surface: "CLIENT PORTAL", note: "not-found state" },
  { path: `/account/reporting/${MISSING}`, role: "client", label: "Report detail (missing)", surface: "CLIENT PORTAL", note: "not-found state" },
  { path: `/account/invoices/${MISSING}`, role: "client", label: "Invoice detail (missing)", surface: "CLIENT PORTAL", note: "not-found state" },
  { path: `/account/subscriptions/${MISSING}`, role: "client", label: "Subscription detail (missing)", surface: "CLIENT PORTAL", note: "not-found state" },
  { path: `/invoices/${MISSING}`, role: "owner", label: "Invoice detail (missing)", surface: "SERVICES/ORDERS/PURCHASE", note: "no local fixture" },
  { path: `/invoices/${MISSING}/edit`, role: "owner", label: "Invoice edit (missing)", surface: "SERVICES/ORDERS/PURCHASE", note: "no local fixture" },
  { path: `/subscriptions/${MISSING}`, role: "owner", label: "Subscription detail (missing)", surface: "SERVICES/ORDERS/PURCHASE", note: "no local fixture" },
  { path: `/subscriptions/${MISSING}/edit`, role: "owner", label: "Subscription edit (missing)", surface: "SERVICES/ORDERS/PURCHASE", note: "no local fixture" },
  { path: `/coupons/${MISSING}`, role: "owner", label: "Coupon detail (missing)", surface: "SERVICES/ORDERS/PURCHASE", note: "no local fixture" },
  { path: `/reporting/${MISSING}`, role: "owner", label: "Report detail (missing)", surface: "INTERNAL", note: "no local fixture" },
  { path: `/forms/${MISSING}`, role: "owner", label: "Form detail (missing)", surface: "SETTINGS", note: "no local fixture" },
  { path: `/forms/${MISSING}/assign`, role: "owner", label: "Form assign (missing)", surface: "SETTINGS", note: "no local fixture" },
  { path: `/forms/${MISSING}/submissions`, role: "owner", label: "Form submissions (missing)", surface: "SETTINGS", note: "no local fixture" },
  { path: `/forms/${MISSING}/versions/${MISSING}`, role: "owner", label: "Form version (missing)", surface: "SETTINGS", note: "no local fixture" },
  { path: `/forms/submissions/${MISSING}`, role: "owner", label: "Form submission (missing)", surface: "SETTINGS", note: "no local fixture" },
];

const viewports: Array<[number, number]> = [
  [320, 568],
  [360, 800],
  [375, 812],
  [390, 844],
  [430, 932],
  [768, 1024],
];
const requestedWidths = new Set((process.env.AUDIT_WIDTHS ?? "").split(",").map(Number).filter(Number.isFinite));
const activeViewports = requestedWidths.size === 0 ? viewports : viewports.filter(([width]) => requestedWidths.has(width));
const landscapeOnly = process.env.AUDIT_LANDSCAPE_ONLY === "1";

const landscapeSpotChecks: Array<[string, number, number]> = [
  ["/dashboard", 812, 375],
  ["/orders", 812, 375],
  [`/orders/${ORDER}`, 812, 375],
  ["/account", 812, 375],
  [`/account/projects/${ORDER}`, 812, 375],
  [`/account/messages/${TICKET_QA}`, 812, 375],
  ["/account/store", 812, 375],
];

const deepRoutes = (process.env.AUDIT_DEEP_ROUTES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const selectedDeepRoutes = deepRoutes.length > 0 ? new Set(deepRoutes) : routeFilter;

type Row = {
  mode: string;
  role: Role;
  path: string;
  label: string;
  surface: string;
  width: number;
  height: number;
  finalUrl: string;
  status: number | null;
  docOverflow: number;
  bodyOverflow: number;
  innerWidth: number;
  offenders?: Array<{ tag: string; cls: string; text: string; left: number; right: number; width: number; fixed: boolean }>;
  pageErrors: string[];
  note?: string;
};

async function blockBackgroundPosts(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const headers = request.headers();
      const path = new URL(request.url()).pathname;
      if (headers["next-action"] || path.startsWith("/api/team") || path.startsWith("/api/ticket-live")) {
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
}

async function login(browser: Browser, role: Role): Promise<BrowserContext> {
  const statePath = resolve(outDir, `state-${role}.json`);
  if (existsSync(statePath)) {
    const context = await browser.newContext({ storageState: statePath });
    await blockBackgroundPosts(context);
    return context;
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const creds = credentials(role);
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByLabel("Email").fill(creds.email);
  await page.locator('input[name="password"]').fill(creds.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
  await context.storageState({ path: statePath });
  await page.close();
  await blockBackgroundPosts(context);
  return context;
}

type NavigationResult = Pick<Row, "status" | "finalUrl" | "pageErrors">;

async function loadRoute(page: Page, route: RouteSpec): Promise<NavigationResult> {
  const pageErrors: string[] = [];
  const onError = (error: Error) => pageErrors.push(error.message.slice(0, 200));
  page.on("pageerror", onError);
  let status: number | null = null;
  let finalUrl = page.url();
  try {
    const response = await page.goto(`${baseUrl}${route.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    status = response?.status() ?? null;
    finalUrl = page.url();
    await page.waitForTimeout(400);
  } catch (error) {
    pageErrors.push(`nav:${error instanceof Error ? error.message.split("\n")[0]?.slice(0, 160) : String(error)}`);
    finalUrl = page.url();
  }
  page.off("pageerror", onError);
  return { status, finalUrl, pageErrors };
}

async function measure(page: Page, route: RouteSpec, width: number, height: number, navigation: NavigationResult): Promise<Row> {
  const pageErrors = [...navigation.pageErrors];
  await page.waitForTimeout(150);
  let doc = { docScrollWidth: 0, bodyScrollWidth: 0, clientWidth: 0, innerWidth: 0, offenders: [] as Row["offenders"] };
  try {
    doc = await page.evaluate((collectOffenders: boolean) => {
      const root = document.documentElement;
      const vw = root.clientWidth;
      const offenders: Array<{ tag: string; cls: string; text: string; left: number; right: number; width: number; fixed: boolean }> = [];
      if (collectOffenders) {
        for (const el of Array.from(document.querySelectorAll("*"))) {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.right > vw + 1 || rect.left < -1) {
            let parent = el.parentElement;
            let clippedByAncestor = false;
            while (parent && parent !== document.body) {
              const parentStyle = getComputedStyle(parent);
              if (["auto", "scroll", "hidden", "clip"].includes(parentStyle.overflowX) && parent.scrollWidth > parent.clientWidth + 1) {
                clippedByAncestor = true;
                break;
              }
              parent = parent.parentElement;
            }
            if (clippedByAncestor) continue;
            if (offenders.length < 30) {
              offenders.push({
                tag: el.tagName.toLowerCase(),
                cls: typeof el.className === "string" ? el.className.slice(0, 140) : "",
                text: (el.textContent ?? "").trim().replace(/\s+/gu, " ").slice(0, 70),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                fixed: style.position === "fixed",
              });
            }
          }
        }
      }
      return {
        docScrollWidth: root.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: vw,
        innerWidth: window.innerWidth,
        offenders,
      };
    }, mode === "deep" && selectedDeepRoutes.has(route.path));
  } catch (error) {
    pageErrors.push(`measure:${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
  }
  const row: Row = {
    mode,
    role: route.role,
    path: route.path,
    label: route.label,
    surface: route.surface,
    width,
    height,
    finalUrl: navigation.finalUrl,
    status: navigation.status,
    docOverflow: Math.max(0, doc.docScrollWidth - doc.clientWidth),
    bodyOverflow: Math.max(0, doc.bodyScrollWidth - doc.clientWidth),
    innerWidth: doc.innerWidth,
    pageErrors,
    note: route.note,
  };
  if (mode === "deep") row.offenders = doc.offenders;
  return row;
}

async function main() {
  const browser = await chromium.launch();
  const roles: Role[] = roleFilter === "both" ? ["owner", "client"] : [roleFilter];
  for (const role of roles) {
    const context = await login(browser, role);
    const page = await context.newPage();
    const roleRoutes = routes.filter((route) => route.role === role
      && (routeFilter.size === 0 || routeFilter.has(route.path))
      && (!landscapeOnly || landscapeSpotChecks.some(([path]) => path === route.path))
      && (mode === "sweep" || selectedDeepRoutes.has(route.path)));
    for (const route of roleRoutes) {
      await page.setViewportSize({ width: 375, height: 812 });
      const navigation = await loadRoute(page, route);
      let worst = 0;
      for (const [width, height] of activeViewports) {
        if (landscapeOnly) break;
        await page.setViewportSize({ width, height });
        const row = await measure(page, route, width, height, navigation);
        appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`);
        worst = Math.max(worst, row.docOverflow);
        if (mode === "deep" && screenshotWidths.has(width) && (screenshotAll || row.docOverflow > 0 || (row.offenders?.length ?? 0) > 0)) {
          const slug = `${role}-${route.label.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}-${width}x${height}`;
          try {
            await page.screenshot({ path: resolve(outDir, `deep-${slug}.png`) });
          } catch {
            // best effort
          }
        }
      }
      for (const [path, width, height] of landscapeOnly || requestedWidths.size === 0 ? landscapeSpotChecks : []) {
        if (path !== route.path) continue;
        await page.setViewportSize({ width, height });
        const row = await measure(page, route, width, height, navigation);
        appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`);
        worst = Math.max(worst, row.docOverflow);
      }
      console.log(`${role} ${route.path} worstDocOverflow=${worst}`);
    }
    await page.close();
    await context.close();
  }
  await browser.close();
  console.log(`DONE mode=${mode} -> ${jsonlPath}`);
}

await main();

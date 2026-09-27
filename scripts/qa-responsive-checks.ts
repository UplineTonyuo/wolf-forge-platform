/**
 * Focused mobile/tablet responsiveness checks for Wolf Forge.
 *
 * Read-only. Complements scripts/qa-mobile-audit.ts (document overflow) with:
 *  - tablet table colgroup vs cell alignment (KI-090 class)
 *  - touch-target sizes at mobile widths
 *  - clipped text containers (overflow hidden + scrollWidth > clientWidth)
 *  - dialog fits inside the viewport, opened through the real UI
 *  - desktop regression overflow at 1024/1280/1440
 *
 * Run: npx tsx scripts/qa-responsive-checks.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";

type Role = "owner" | "client";

function credentials(role: Role): { email: string; password: string } {
  const file = role === "owner" ? ".qa-local-credentials.json" : ".qa-local-credentials.client.json";
  return JSON.parse(readFileSync(resolve(import.meta.dirname, "..", file), "utf8")) as { email: string; password: string };
}

async function login(browser: Browser, role: Role): Promise<BrowserContext> {
  const context = await browser.newContext({
    hasTouch: process.env.CHECK_TOUCH_DEVICE === "1",
    isMobile: process.env.CHECK_TOUCH_DEVICE === "1",
  });
  const page = await context.newPage();
  const creds = credentials(role);
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByLabel("Email").fill(creds.email);
  await page.locator('input[name="password"]').fill(creds.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
  await page.close();
  return context;
}

const ORDER = "b6aab926-e928-48c3-ad40-47262e80bd47";
const TICKET = "cfcf0375-eed9-40d6-856c-a42badd78416";
const COMPANY = "a51fe758-16b8-4546-b657-39796cd43512";

const routes: Array<{ role: Role; path: string }> = [
  { role: "owner", path: "/dashboard" },
  { role: "owner", path: "/orders" },
  { role: "owner", path: `/orders/${ORDER}` },
  { role: "owner", path: "/tickets" },
  { role: "owner", path: `/tickets/${TICKET}` },
  { role: "owner", path: "/clients" },
  { role: "owner", path: `/clients/${COMPANY}` },
  { role: "owner", path: "/investment-intent" },
  { role: "owner", path: "/invoices" },
  { role: "owner", path: "/subscriptions" },
  { role: "owner", path: "/coupons" },
  { role: "owner", path: "/services" },
  { role: "owner", path: "/forms" },
  { role: "owner", path: "/team" },
  { role: "owner", path: "/reporting" },
  { role: "owner", path: "/todo/departments" },
  { role: "owner", path: "/todo/departments/content" },
  { role: "owner", path: "/todo/departments/gmb-management" },
  { role: "owner", path: "/todo/departments/off-page-seo" },
  { role: "owner", path: "/todo/departments/on-page-seo" },
  { role: "owner", path: "/todo/departments/podcast-seo" },
  { role: "owner", path: "/todo/departments/technical-seo" },
  { role: "owner", path: "/todo/departments/website-builder" },
  { role: "owner", path: "/todo/departments/youtube-seo" },
  { role: "owner", path: "/settings" },
  { role: "client", path: "/account" },
  { role: "client", path: `/account/projects/${ORDER}` },
  { role: "client", path: "/account/messages" },
  { role: "client", path: "/account/store" },
  { role: "client", path: "/account/invoices" },
  { role: "client", path: "/account/subscriptions" },
  { role: "client", path: "/account/profile" },
  { role: "client", path: "/account/payment-method" },
];

type TableDiagnostic = {
  index: number;
  tableClass: string;
  visibleCols: number | null;
  visibleTh: number;
  visibleTdFirstRow: number | null;
  issue: string;
};
type TouchProblem = { tag: string; cls: string; text: string; dimensions: string; top: number };
type ClipProblem = { tag: string; cls: string; text: string; delta: number; top: number };

/*
 * Browser-side collector, authored as a raw string on purpose: tsx/esbuild's
 * keepNames transform wraps named functions with a `__name` helper that does
 * not exist in the page context, so a normal page.evaluate callback breaks.
 */
const collectSource = `(function (collectTouch, collectClip) {
  function isVisible(el) {
    var style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  }
  var tables = [];
  var touch = [];
  var clips = [];
  Array.prototype.forEach.call(document.querySelectorAll('table'), function (table, index) {
    var rect = table.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    var colgroup = table.querySelector('colgroup');
    var cols = colgroup ? Array.prototype.slice.call(colgroup.querySelectorAll('col')) : [];
    var visibleCols = colgroup ? cols.filter(isVisible).length : null;
    var headers = Array.prototype.filter.call(table.querySelectorAll('thead th'), isVisible).length;
    var firstRow = table.querySelector('tbody tr');
    var visibleTdFirstRow = firstRow ? Array.prototype.filter.call(firstRow.querySelectorAll('td'), isVisible).length : null;
    var expectedCells = Math.max(headers, visibleTdFirstRow || 0);
    var issue = '';
    if (visibleCols !== null && expectedCells > 0 && visibleCols !== expectedCells) {
      issue = 'col/cell mismatch cols=' + visibleCols + ' cells=' + expectedCells;
    }
    tables.push({
      index: index,
      tableClass: typeof table.className === 'string' ? table.className.slice(0, 100) : '',
      visibleCols: visibleCols,
      visibleTh: headers,
      visibleTdFirstRow: visibleTdFirstRow,
      issue: issue
    });
  });
  if (collectTouch) {
    Array.prototype.forEach.call(document.querySelectorAll("a, button, [role='button'], input, select, textarea"), function (el) {
      if (!isVisible(el)) return;
      var box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      if (Math.min(box.width, box.height) < 32) {
        touch.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
          text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50) || (el.getAttribute('aria-label') || '').slice(0, 50),
          dimensions: Math.round(box.width) + 'x' + Math.round(box.height),
          top: Math.round(box.top + window.scrollY)
        });
      }
    });
  }
  if (collectClip) {
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!isVisible(el)) continue;
      var style = getComputedStyle(el);
      if (style.overflowX !== 'hidden' && style.overflowX !== 'clip') continue;
      if (style.textOverflow === 'ellipsis') continue;
      var delta = el.scrollWidth - el.clientWidth;
      if (delta <= 2) continue;
      if ((el.textContent || '').trim().length === 0) continue;
      clips.push({
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
        delta: Math.round(delta),
        top: Math.round(el.getBoundingClientRect().top + window.scrollY)
      });
      if (clips.length >= 12) break;
    }
  }
  var root = document.documentElement;
  return {
    docOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
    bodyOverflow: Math.max(0, document.body.scrollWidth - root.clientWidth),
    tables: tables,
    touch: touch,
    clips: clips
  };
})`;

type CollectResult = {
  docOverflow: number;
  bodyOverflow: number;
  tables: TableDiagnostic[];
  touch: TouchProblem[];
  clips: ClipProblem[];
};

async function snapshot(page: Page, collectTouch: boolean, collectClip: boolean): Promise<CollectResult> {
  const expression = `(${collectSource})(${JSON.stringify(collectTouch)}, ${JSON.stringify(collectClip)})`;
  return page.evaluate(expression) as Promise<CollectResult>;
}

async function main() {
  const browser = await chromium.launch();
  const contexts: Record<Role, BrowserContext> = {
    owner: await login(browser, "owner"),
    client: await login(browser, "client"),
  };
  const pages: Record<Role, Page> = {
    owner: await contexts.owner.newPage(),
    client: await contexts.client.newPage(),
  };

  const widths = (process.env.CHECK_WIDTHS ?? "768,900,1023").split(",").map(Number);
  const mobileWidths = (process.env.CHECK_MOBILE_WIDTHS ?? "320,390").split(",").map(Number);
  const desktopWidths = (process.env.CHECK_DESKTOP_WIDTHS ?? "1024,1280,1440").split(",").map(Number);
  const mode = process.env.CHECK_MODE ?? "all";
  const verbose = process.env.CHECK_VERBOSE === "1";
  const routeFilter = new Set((process.env.CHECK_ROUTES ?? "").split(",").map((value) => value.trim()).filter(Boolean));

  for (const route of routes) {
    if (routeFilter.size > 0 && !routeFilter.has(route.path)) continue;
    const page = pages[route.role];
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${baseUrl}${route.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(350);
    } catch (error) {
      console.log(`NAVFAIL ${route.role} ${route.path}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
      continue;
    }

    if (mode === "all" || mode === "tablet") {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1024 });
        await page.waitForTimeout(150);
        const result = await snapshot(page, false, false);
        const withIssues = result.tables.filter((table) => table.issue);
        if (verbose) {
          if (result.tables.length === 0) console.log(`   tables=0 @${width} ${route.path}`);
          for (const table of result.tables) {
            console.log(`   table[${table.index}] @${width} cols=${table.visibleCols} th=${table.visibleTh} td=${table.visibleTdFirstRow} cls='${table.tableClass}' ${table.issue}`);
          }
        }
        if (result.docOverflow > 0 || withIssues.length > 0) {
          console.log(`TABLET ${route.role} ${route.path} @${width} docOverflow=${result.docOverflow}`);
          for (const table of withIssues) console.log(`   table[${table.index}] ${table.tableClass} -> ${table.issue}`);
        }
      }
    }

    if (mode === "all" || mode === "touch") {
      for (const width of mobileWidths) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForTimeout(150);
        const result = await snapshot(page, true, true);
        if (result.touch.length > 0) {
          console.log(`TOUCH ${route.role} ${route.path} @${width} smallTargets=${result.touch.length}`);
          for (const problem of result.touch.slice(0, 12)) {
            console.log(`   <${problem.tag}> ${problem.dimensions} cls='${problem.cls}' text='${problem.text}'`);
          }
        }
        if (result.clips.length > 0) {
          console.log(`CLIP ${route.role} ${route.path} @${width} clippedText=${result.clips.length}`);
          for (const entry of result.clips.slice(0, 8)) {
            console.log(`   <${entry.tag}> delta=${entry.delta} cls='${entry.cls}' text='${entry.text}'`);
          }
        }
      }
    }

    if (mode === "all" || mode === "desktop") {
      for (const width of desktopWidths) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(150);
        const result = await snapshot(page, false, false);
        if (result.docOverflow > 0) {
          console.log(`DESKTOP ${route.role} ${route.path} @${width} docOverflow=${result.docOverflow}`);
        }
      }
    }
  }

  if (mode === "all" || mode === "dialogs") {
    const owner = pages.owner;
    await owner.setViewportSize({ width: 320, height: 844 });
    await owner.goto(`${baseUrl}/clients`, { waitUntil: "domcontentloaded" });
    await owner.waitForTimeout(500);
    const trigger = owner.getByRole("button", { name: "Add client or company" });
    if (await trigger.count()) {
      await trigger.click();
      await owner.waitForTimeout(500);
      const panel = owner.locator("[class*='clients-action-menu_panel']").first();
      if (await panel.count()) {
        const box = await panel.boundingBox();
        console.log(`DIALOG /clients action menu @320 box=${box ? `${Math.round(box.width)}x${Math.round(box.height)} x=${Math.round(box.x)}` : "none"}`);
      } else {
        console.log("DIALOG /clients action menu @320 panel NOT FOUND");
      }
      await owner.keyboard.press("Escape");
    } else {
      console.log("DIALOG /clients action menu @320 trigger NOT FOUND");
    }
  }

  if (mode === "all" || mode === "hit") {
    // Expanded hit areas: click just outside the visible glyph and require a toggle.
    const owner = pages.owner;
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${baseUrl}/clients`, { waitUntil: "domcontentloaded" });
    await owner.waitForTimeout(600);
    const checkbox = owner.locator(".clients-checkbox").nth(1);
    if (await checkbox.count()) {
      const before = await checkbox.isChecked();
      const box = await checkbox.boundingBox();
      if (box) {
        await owner.mouse.click(box.x + box.width / 2, box.y - 6);
        await owner.waitForTimeout(200);
        const after = await checkbox.isChecked();
        console.log(`HIT /clients checkbox outside-glyph toggle=${before !== after} (${before} -> ${after})`);
      }
    } else {
      console.log("HIT /clients checkbox NOT FOUND");
    }

    await owner.goto(`${baseUrl}/orders`, { waitUntil: "domcontentloaded" });
    await owner.waitForTimeout(600);
    const projectCheckbox = owner.locator("button[class*='checkbox']").nth(1);
    if (await projectCheckbox.count()) {
      const before = await projectCheckbox.getAttribute("aria-pressed");
      const box = await projectCheckbox.boundingBox();
      if (box) {
        await owner.mouse.click(box.x + box.width / 2, box.y - 5);
        await owner.waitForTimeout(200);
        const after = await projectCheckbox.getAttribute("aria-pressed");
        console.log(`HIT /orders project checkbox outside-glyph toggle=${before !== after} (${before} -> ${after})`);
      }
    } else {
      console.log("HIT /orders project checkbox NOT FOUND");
    }
  }

  await browser.close();
}

await main();

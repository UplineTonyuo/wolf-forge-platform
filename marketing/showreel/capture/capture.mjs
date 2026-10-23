// Captures the real app screens the showreel walks through, into ../captures/.
// Needs the local stack: `npx supabase start`, the local QA accounts
// (`npm run qa:local-login`), capture/seed-demo.sql applied to the local DB,
// LOCAL_UI_QA_BYPASS=true in .env.local, and `npm run dev` on 127.0.0.1:3000.
// Desktop pages are shot at 2x so the in-app camera can zoom without blur.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../captures");
const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DESKTOP = ["dashboard", "orders", "tickets", "clients", "invoices", "services", "team", "settings"];
const MOBILE = ["dashboard", "orders"];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function shoot(page, route, file) {
  await page.goto(`${BASE}/${route}`, { timeout: 240000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1800);
  await page.mouse.move(page.viewportSize().width - 5, page.viewportSize().height - 5);
  const png = await page.screenshot();
  await sharp(png).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toFile(path.join(outDir, file));
  console.log(file);
}
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
for (const route of DESKTOP) await shoot(desktop, route, `${route}.jpg`);
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
for (const route of MOBILE) await shoot(mobile, route, `m-${route}.jpg`);
await browser.close();

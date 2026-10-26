// Renders index.html to the silent DoItForMe MP4 (frames piped into ffmpeg), or to stills.
//
//   node marketing/doitforme/render.mjs                    -> doitforme-app-flow.mp4
//   node marketing/doitforme/render.mjs --stills 31,40      -> out/still-31.00.png, ...
//   node marketing/doitforme/render.mjs --slide 33          -> doitforme-result-slide.png
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
const FPS = 30;
const MIME = { ".html": "text/html", ".woff2": "font/woff2" };

function serve() {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(here, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(here)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const arg = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null; };

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
  await page.evaluate(() => window.ready);
  const DURATION = await page.evaluate(() => window.DURATION);
  const shoot = async (t, type = "jpeg") => {
    await page.evaluate((time) => window.seek(time), t);
    return page.screenshot(type === "png" ? { type } : { type, quality: 95 });
  };

  if (arg("--stills")) {
    for (const t of arg("--stills").split(",").map(Number)) {
      const file = path.join(outDir, `still-${t.toFixed(2)}.png`);
      await writeFile(file, await shoot(t, "png"));
      console.log(file);
    }
  } else if (arg("--slide")) {
    const file = path.join(here, "doitforme-result-slide.png");
    await writeFile(file, await shoot(Number(arg("--slide")), "png"));
    console.log(file);
  } else {
    const file = path.join(here, "doitforme-app-flow.mp4");
    const ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", file],
      { stdio: ["pipe", "inherit", "inherit"] });
    for (let f = 0; f < FPS * DURATION; f++) {
      if (!ffmpeg.stdin.write(await shoot(f / FPS))) await new Promise((r) => ffmpeg.stdin.once("drain", r));
      if (f % 150 === 0) console.log(`frame ${f}/${FPS * DURATION}`);
    }
    ffmpeg.stdin.end();
    await new Promise((r) => ffmpeg.on("close", r));
    console.log(file);
  }
  await browser.close();
  server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

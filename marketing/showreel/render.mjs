// Renders index.html to video frames with headless Chromium and pipes them into ffmpeg.
//
//   node marketing/showreel/render.mjs                  -> out/frames.mp4 (silent, full length @ 30fps)
//   node marketing/showreel/render.mjs --stills 4,12.8  -> out/still-4.00.jpg, ...
//
// Then `python3 marketing/showreel/audio/mix.py` builds the soundtrack and muxes the final MP4.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(here, "out");
const FPS = 30;

const MIME = { ".html": "text/html", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".js": "text/javascript" };

// The page references /public/... and /docs/qa/... so the server is rooted at the repo,
// with the showreel folder mounted at / for index.html and fonts/.
function serve() {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const rel = url === "/" ? "/index.html" : url;
    const candidates = [path.join(here, rel), path.join(repoRoot, rel)];
    for (const file of candidates) {
      if (!file.startsWith(repoRoot)) continue;
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
        res.end(body);
        return;
      } catch {
        // try the next root
      }
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const stillsArg = process.argv.indexOf("--stills");
  const stills = stillsArg > -1 ? process.argv[stillsArg + 1].split(",").map(Number) : null;

  await mkdir(outDir, { recursive: true });
  const server = await serve();
  const { port } = server.address();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.evaluate(() => window.ready);
  // The composition owns its length (window.DURATION in index.html).
  const DURATION = await page.evaluate(() => window.DURATION);

  const shoot = async (t) => {
    await page.evaluate((time) => window.seek(time), t);
    return page.screenshot({ type: "jpeg", quality: 95, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  };

  if (stills) {
    for (const t of stills) {
      const file = path.join(outDir, `still-${t.toFixed(2)}.jpg`);
      await writeFile(file, await shoot(t));
      console.log(file);
    }
  } else {
    const ffmpeg = spawn("ffmpeg", [
      "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-tune", "grain",
      path.join(outDir, "frames.mp4"),
    ], { stdio: ["pipe", "inherit", "inherit"] });
    const total = FPS * DURATION;
    const started = Date.now();
    for (let f = 0; f < total; f++) {
      const jpg = await shoot(f / FPS);
      if (!ffmpeg.stdin.write(jpg)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
      if (f % 60 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
    ffmpeg.stdin.end();
    await new Promise((r) => ffmpeg.on("close", r));
    console.log(path.join(outDir, "frames.mp4"));
  }
  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

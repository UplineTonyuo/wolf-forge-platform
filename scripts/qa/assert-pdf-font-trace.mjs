import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const build = process.env.WOLF_FORGE_STUDIO_QA_BUILD === "1" && process.env.VERCEL !== "1" ? ".next-studio-qa" : ".next";
const tracePath = resolve(build, "server/app/api/form-submissions/[submissionId]/pdf/route.js.nft.json");
const trace = JSON.parse(readFileSync(tracePath, "utf8"));
const files = new Set(trace.files.map((file) => resolve(dirname(tracePath), file)));
const provenance = JSON.parse(readFileSync("src/assets/pdf-fonts/provenance.json", "utf8"));
assert.equal(provenance.Files.length, 7);
for (const font of provenance.Files) {
  const file = resolve("src/assets/pdf-fonts", font.Asset);
  assert.ok(files.has(file), `PDF font absent from route trace: ${font.Asset}`);
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), font.Sha256.toLowerCase());
}
console.log("PDF route packages all seven verified font assets.");

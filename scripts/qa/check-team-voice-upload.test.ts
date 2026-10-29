import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { it } from "vitest";
import { uploadTeamVoiceBlob } from "../../src/components/team/team-http-client";
import { inspectTeamVoiceBytes } from "../../src/lib/team-voice/media-inspection";
import { streamingWebm } from "../../src/tests/fixtures/team-voice-streaming";

async function run() {
  assert.ok(process.env.GITHUB_ACTIONS === "true" && process.env.CI === "true" && process.platform === "linux", "Disposable GitHub Actions Linux runner required");
  const status = JSON.parse(execFileSync(resolve("node_modules/.bin/supabase"), ["status", "--output", "json"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }));
  const url = new URL(status.API_URL);
  assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Only isolated loopback Storage is allowed");
  const key = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
  assert.ok(typeof key === "string" && key.length > 0, "Local server credential required");
  const client = createClient(url.href, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = client.storage.from("team-voice-messages");
  const path = `qa/team-voice/${randomUUID()}/audio.webm`;
  const bytes = streamingWebm();
  try {
    const configuration = await client.storage.getBucket("team-voice-messages");
    assert.ok(!configuration.error && configuration.data.public === false, "Private bucket required");
    const signed = await bucket.createSignedUploadUrl(path, { upsert: false });
    assert.ok(!signed.error && signed.data?.signedUrl, "Synthetic signed upload setup failed");
    const uploaded = await uploadTeamVoiceBlob(signed.data.signedUrl, new Blob([bytes], { type: "audio/webm;codecs=opus" }));
    assert.ok(uploaded.ok, "Actual signed PUT upload failed");
    const info = await bucket.info(path);
    const stored = await bucket.download(path);
    assert.ok(!info.error && info.data && !stored.error && stored.data, "Synthetic object readback failed");
    const actual = new Uint8Array(await stored.data.arrayBuffer());
    assert.deepEqual(actual, bytes, "Stored synthetic bytes changed");
    const media = await inspectTeamVoiceBytes({ bytes: actual, objectSize: info.data.size ?? actual.length, objectMimeType: info.data.contentType ?? null, declaredMimeType: "audio/webm", recordedDurationMs: 16_000 });
    assert.equal(media.durationMs, 16_020, "Stored WebM duration must come from its bytes");
    const replacement = await uploadTeamVoiceBlob(signed.data.signedUrl, new Blob(["different synthetic bytes"], { type: "audio/webm" }));
    assert.ok(!replacement.ok, "Reused signed upload replaced an existing object");
    const retained = await bucket.download(path);
    assert.ok(!retained.error && retained.data, "Non-overwrite readback failed");
    assert.deepEqual(new Uint8Array(await retained.data.arrayBuffer()), bytes, "Original bytes were overwritten");
  } finally {
    const cleanup = await bucket.remove([path]);
    assert.ok(!cleanup.error, "Synthetic Storage cleanup failed");
  }
}

it("uploads synthetic Team voice through actual private Storage and inspects the stored bytes without allowing overwrite (disposable CI only)", async () => {
  try {
    await run();
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    throw new Error("Isolated Team voice provider/CLI check failed; raw provider output withheld");
  }
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "server-only": fileURLToPath(new URL("../../src/tests/stubs/server-only.ts", import.meta.url)) } },
  test: { environment: "node", include: ["scripts/qa/check-team-voice-upload.test.ts"], maxWorkers: 1, testTimeout: 30_000 },
});

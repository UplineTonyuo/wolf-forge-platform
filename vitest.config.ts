import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Component tests opt into jsdom per file with a @vitest-environment docblock.
    include: ["src/tests/**/*.test.ts", "src/tests/**/*.test.tsx"],
    restoreMocks: true,
  },
});

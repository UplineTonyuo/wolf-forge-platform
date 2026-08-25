import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      /**
       * `server-only` is resolved by Next's bundler, not by Node, so a suite
       * that imports any module carrying `import "server-only"` cannot even
       * resolve under Vitest. The stub makes it resolvable and does nothing
       * else; see `src/tests/stubs/server-only.ts`.
       */
      "server-only": fileURLToPath(new URL("./src/tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Component tests opt into jsdom per file with a @vitest-environment docblock.
    include: ["src/tests/**/*.test.ts", "src/tests/**/*.test.tsx"],
    restoreMocks: true,
  },
});

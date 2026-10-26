import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["src/app/**/*.tsx"],
    rules: {
      "react-hooks/error-boundaries": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    "dist/**",
    "coverage/**",
    "supabase/.temp/**",
    "src/lib/supabase/database.types.ts",
    // Standalone video build tooling (Playwright + ffmpeg), not app code.
    "marketing/showreel/**",
    "marketing/doitforme/**",
  ]),
]);

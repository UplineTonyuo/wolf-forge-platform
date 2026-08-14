import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Next.js rejects an entire `"use server"` module when it exposes a runtime
 * export that is not an async function ("A 'use server' file can only export
 * async functions, found object."). Every client component importing that
 * module then fails at render, so a single stray `export const` takes out whole
 * routes while the unit suites stay green -- the component tests mock the action
 * module, and an `export const` is perfectly valid TypeScript, so neither vitest
 * nor `tsc` can see it.
 *
 * This guard reads the action modules as source text, which keeps it free of
 * Next.js and Supabase server-only imports.
 */

const sourceRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return entry.isFile() && /\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

/** Drops comments so a commented-out example can never fail the guard. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
}

/** True when the module's directive prologue opens with "use server". */
function isServerActionModule(source: string): boolean {
  const body = stripComments(source.replace(/^﻿/u, "")).trimStart();
  return /^["']use server["']\s*;?/u.test(body);
}

/**
 * Reports the runtime exports Next.js would reject. Type-only exports are
 * erased before Next sees them, and an async function assigned to a const is a
 * legal async-function export, so both are allowed through.
 */
function findIllegalExports(source: string): string[] {
  return stripComments(source)
    .split(/\r?\n/u)
    .filter((line) => {
      const binding = /^export\s+(?:const|let|var)\s+[^=]+=\s*(.*)$/u.exec(line);
      if (binding) return !/^async\b/u.test(binding[1] ?? "");
      if (/^export\s+(?:class|enum)\b/u.test(line)) return true;
      if (/^export\s+function\b/u.test(line)) return true;
      return /^export\s+default\b/u.test(line) && !/^export\s+default\s+async\s/u.test(line);
    })
    .map((line) => line.trim());
}

const serverActionModules = listSourceFiles(sourceRoot)
  .filter((path) => isServerActionModule(readFileSync(path, "utf8")))
  .map((path) => relative(sourceRoot, path).replace(/\\/gu, "/"));

describe('"use server" modules', () => {
  it("finds the action modules it is meant to guard", () => {
    // Without this the guard would silently pass if detection ever broke.
    expect(serverActionModules).toContain("app/actions/orders.ts");
    expect(serverActionModules.length).toBeGreaterThanOrEqual(7);
  });

  it.each(serverActionModules)("%s exports only async functions", (module) => {
    const illegal = findIllegalExports(readFileSync(join(sourceRoot, module), "utf8"));

    expect(
      illegal,
      `${module} has runtime exports that are not async functions. Next.js rejects the whole module, breaking every route whose client components import it. Move these to a file without the "use server" directive:\n  ${illegal.join("\n  ")}`,
    ).toEqual([]);
  });
});

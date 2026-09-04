import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hardenAuthCookieOptions } from "../lib/supabase/auth-cookie-options";

/**
 * Auth-cookie policy (C2-2, D-114).
 *
 * The Supabase session cookie carries BOTH the access token and the refresh
 * token. `@supabase/ssr` defaults it to `httpOnly: false`, so before this
 * policy any script on the page could read a renewable session out of
 * `document.cookie`. These tests pin the fix in three layers:
 *
 *   policy    the helper's own behaviour, including the branch that keeps
 *             plain-http localhost working.
 *   passthrough  that it changes ONLY the two keys it owns — a helper that
 *             quietly dropped SameSite or Path would trade one hole for
 *             another, and one that altered name/path/domain would break
 *             logout, because browsers match deletions on those.
 *   wiring    that both write paths actually use it, and that nothing in the
 *             browser depends on reading these cookies.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * `process.env.NODE_ENV` is a non-configurable property under the test runtime,
 * so it cannot be redefined directly; `vi.stubEnv` is the supported seam.
 */
function setNodeEnv(value: string | undefined): void {
  vi.stubEnv("NODE_ENV", value as string);
}

const src = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(src, relativePath), "utf8");
}

/** The options `@supabase/ssr` actually produces for a session-cookie write. */
const libraryWriteOptions = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: false,
  maxAge: 400 * 24 * 60 * 60,
};

/** What the library emits for a removal: same keys, zero lifetime. */
const libraryRemovalOptions = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: false,
  maxAge: 0,
};

describe("the policy the helper owns", () => {
  it("forces HttpOnly on every write, overriding the library default", () => {
    setNodeEnv("production");
    expect(hardenAuthCookieOptions(libraryWriteOptions).httpOnly).toBe(true);

    setNodeEnv("development");
    expect(hardenAuthCookieOptions(libraryWriteOptions).httpOnly).toBe(true);
  });

  it("forces HttpOnly on removals too", () => {
    // A logout clear is still a Set-Cookie. Leaving it JS-writable would let a
    // script forge the deletion's attributes.
    setNodeEnv("production");
    expect(hardenAuthCookieOptions(libraryRemovalOptions).httpOnly).toBe(true);
  });

  it("sets Secure in production and only in production", () => {
    setNodeEnv("production");
    expect(hardenAuthCookieOptions(libraryWriteOptions).secure).toBe(true);
  });

  it("leaves Secure off in development and test so plain-http localhost works", () => {
    // Browsers refuse Secure cookies over http; Safari does so even on
    // localhost. Forcing it here would break local sign-in for no gain.
    for (const environment of ["development", "test", undefined]) {
      setNodeEnv(environment);
      expect(hardenAuthCookieOptions(libraryWriteOptions).secure).toBe(false);
    }
  });

  it("refuses a caller's attempt to opt out of either key", () => {
    setNodeEnv("production");
    const hardened = hardenAuthCookieOptions({ ...libraryWriteOptions, httpOnly: false, secure: false });

    expect(hardened.httpOnly).toBe(true);
    expect(hardened.secure).toBe(true);
  });

  it("tolerates undefined options without inventing anything", () => {
    setNodeEnv("production");
    expect(hardenAuthCookieOptions(undefined)).toEqual({ httpOnly: true, secure: true });
  });
});

describe("everything else passes through untouched", () => {
  it("preserves SameSite, Path, Domain and Max-Age exactly", () => {
    setNodeEnv("production");
    const hardened = hardenAuthCookieOptions({
      ...libraryWriteOptions,
      domain: "app.example.com",
      priority: "high",
    });

    expect(hardened.sameSite).toBe("lax");
    expect(hardened.path).toBe("/");
    expect(hardened.domain).toBe("app.example.com");
    // The 400-day lifetime is accepted (D-114): validity is enforced by token
    // expiry server-side, not by how long the cookie sits in the jar.
    expect(hardened.maxAge).toBe(400 * 24 * 60 * 60);
    expect(hardened.priority).toBe("high");
  });

  it("keeps a removal a removal", () => {
    setNodeEnv("production");
    const hardened = hardenAuthCookieOptions({ ...libraryRemovalOptions, domain: "app.example.com" });

    // Browsers match a deletion on name + path + domain. Altering any of them
    // would leave the real cookie in place while appearing to log out.
    expect(hardened.maxAge).toBe(0);
    expect(hardened.path).toBe("/");
    expect(hardened.domain).toBe("app.example.com");
  });

  it("adds no key of its own beyond the two it owns", () => {
    setNodeEnv("production");
    const before = Object.keys(libraryWriteOptions).sort();
    const after = Object.keys(hardenAuthCookieOptions(libraryWriteOptions)).sort();

    expect(after).toEqual([...new Set([...before, "httpOnly", "secure"])].sort());
  });
});

describe("both write paths are wired through it", () => {
  it("routes the proxy's response-cookie writes through the helper", () => {
    const proxy = read("proxy.ts");

    expect(proxy).toContain('from "./lib/supabase/auth-cookie-options"');
    expect(proxy).toContain("hardenAuthCookieOptions(options)");
    // A second setAll would be a second, unpoliced write path.
    expect(proxy.match(/setAll:/g)).toHaveLength(1);
    expect(proxy).not.toMatch(/response\.cookies\.set\(name,\s*value,\s*options\)/);
  });

  it("routes the Server Action cookieStore writes through the helper", () => {
    const nextServer = read("lib/supabase/next-server.ts");

    expect(nextServer).toContain('from "./auth-cookie-options"');
    expect(nextServer).toContain("hardenAuthCookieOptions(options)");
    const cookieWriteAdapters = nextServer.match(/setAll:/g) ?? [];
    const hardenedCookieWrites = nextServer.match(/hardenAuthCookieOptions\(options\)/g) ?? [];
    expect(cookieWriteAdapters.length).toBeGreaterThan(0);
    expect(hardenedCookieWrites).toHaveLength(cookieWriteAdapters.length);
    expect(nextServer).not.toMatch(/cookieStore\.set\(name,\s*value,\s*options\)/);
  });

  it("keeps the helper server-only", () => {
    expect(read("lib/supabase/auth-cookie-options.ts")).toContain('import "server-only"');
  });

  it("has no third place that constructs a Supabase server client with cookies", () => {
    // The policy is complete only because these two are the whole set.
    const callSites = walk(src).filter((file) => {
      if (!/\.tsx?$/.test(file)) return false;
      if (file.includes(`${resolve(src, "tests")}`)) return false;
      return readFileSync(file, "utf8").includes("createServerClient");
    });

    expect(callSites.map((file) => file.slice(src.length + 1).replace(/\\/g, "/")).sort()).toEqual([
      "lib/supabase/next-server.ts",
      "proxy.ts",
    ]);
  });
});

describe("nothing in the browser reads the session cookie", () => {
  it("has no browser Supabase client and no document.cookie access in src", () => {
    // HttpOnly is only free because of this. If either appears, the policy has
    // to be reconsidered rather than the invariant relaxed.
    const offenders: string[] = [];

    for (const file of walk(src)) {
      if (!/\.tsx?$/.test(file)) continue;
      // Backup artifacts carry a trailing extension and are not routable.
      if (/\.(?:failed|before)-[0-9-]+$/.test(file)) continue;
      const relative = file.slice(src.length + 1).replace(/\\/g, "/");
      if (relative.startsWith("tests/")) continue;

      // Comments are stripped first: the policy helper and this suite both
      // NAME these APIs in prose to explain why they are forbidden, and a scan
      // that cannot tell prose from code would flag its own documentation.
      const code = stripComments(readFileSync(file, "utf8"));
      if (code.includes("createBrowserClient")) offenders.push(`${relative}: createBrowserClient`);
      if (code.includes("document.cookie")) offenders.push(`${relative}: document.cookie`);
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * Removes block and line comments. Deliberately crude — it is used only to
 * decide whether an identifier appears in executable code, and erring toward
 * removing too little would produce a false POSITIVE (a failing test someone
 * investigates), never a false negative that hides a real browser reader.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(directory: string): string[] {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const full = resolve(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return [full];
  });
}

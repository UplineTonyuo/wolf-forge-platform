import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";

const { readRequestHeaders, mockReadFile } = vi.hoisted(() => ({
  readRequestHeaders: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: readRequestHeaders,
}));

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

import { ensureLocalQaSession, localUiQaBypassEnabled } from "../lib/qa/local-ui-bypass";

beforeEach(() => {
  readRequestHeaders.mockResolvedValue(new Headers({ host: "localhost:3000" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function enableLocalQaEnvironment(): void {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("LOCAL_UI_QA_BYPASS", "true");
}

function request(url: string, host?: string, forwardedHost?: string): Request {
  const headers = new Headers();
  if (host) headers.set("host", host);
  if (forwardedHost) headers.set("x-forwarded-host", forwardedHost);
  return new Request(url, { headers });
}

describe("local UI QA bypass", () => {
  it("permits the server-component path only when its request headers are loopback", async () => {
    enableLocalQaEnvironment();

    await expect(localUiQaBypassEnabled()).resolves.toBe(true);

    readRequestHeaders.mockResolvedValue(new Headers({ host: "preview.example" }));
    await expect(localUiQaBypassEnabled()).resolves.toBe(false);
  });

  it.each([
    ["localhost", "http://localhost:3000/todo/departments/podcast-seo"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000/todo/departments/podcast-seo"],
    ["[::1]:3000", "http://[::1]:3000/todo/departments/podcast-seo"],
  ])("permits the loopback host %s only in the opted-in development environment", async (host, url) => {
    enableLocalQaEnvironment();

    await expect(localUiQaBypassEnabled(request(url, host))).resolves.toBe(true);
  });

  it("fails closed when the Host header is missing or malformed", async () => {
    enableLocalQaEnvironment();

    await expect(localUiQaBypassEnabled(request("http://localhost:3000/test"))).resolves.toBe(false);
    for (const host of [
      "not a valid host",
      "localhost/path",
      "localhost?host=preview.example",
      "user@localhost",
      "localhost:99999",
    ]) {
      await expect(
        localUiQaBypassEnabled(request("http://localhost:3000/test", host)),
      ).resolves.toBe(false);
    }
  });

  it("rejects non-loopback URL, Host, and forwarded Host values", async () => {
    enableLocalQaEnvironment();

    await expect(
      localUiQaBypassEnabled(request("https://preview.example/test", "preview.example")),
    ).resolves.toBe(false);
    await expect(
      localUiQaBypassEnabled(request("http://localhost:3000/test", "preview.example")),
    ).resolves.toBe(false);
    await expect(
      localUiQaBypassEnabled(
        request("http://localhost:3000/test", "localhost:3000", "preview.example"),
      ),
    ).resolves.toBe(false);
  });

  it("rejects Preview and Production even when the flag and loopback host are present", async () => {
    vi.stubEnv("LOCAL_UI_QA_BYPASS", "true");

    for (const nodeEnv of ["production", "test"]) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      await expect(
        localUiQaBypassEnabled(request("http://localhost:3000/test", "localhost:3000")),
      ).resolves.toBe(false);
    }
  });

  it("requires an exact opt-in flag", async () => {
    vi.stubEnv("NODE_ENV", "development");

    for (const flag of [undefined, "false", "TRUE", "1"]) {
      vi.stubEnv("LOCAL_UI_QA_BYPASS", flag as string);
      await expect(
        localUiQaBypassEnabled(request("http://localhost:3000/test", "localhost:3000")),
      ).resolves.toBe(false);
    }
  });

  it("next-server.ts carries no bypass branch — getInternalContext is the unmodified real path", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../lib/supabase/next-server.ts"),
      "utf8",
    );

    expect(source).not.toContain("localUiQaBypassEnabled");
    expect(source).not.toContain("LOCAL_UI_QA_USER");
    expect(source).toContain('redirect("/login")');
    expect(source).toContain("verifyActor(client)");
    expect(source).toContain("resolveInternalUser(client, actor)");
  });
});

describe("ensureLocalQaSession", () => {
  function fakeSupabase(signInWithPassword: ReturnType<typeof vi.fn>): SupabaseClient<Database> {
    return { auth: { signInWithPassword } } as unknown as SupabaseClient<Database>;
  }

  function loopbackRequest(): Request {
    return new Request("http://localhost:3000/dashboard", {
      headers: new Headers({ host: "localhost:3000" }),
    });
  }

  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it("does nothing when bypass is ineligible for the request", async () => {
    // NODE_ENV/LOCAL_UI_QA_BYPASS are not stubbed in this test — bypass is disabled.
    const signInWithPassword = vi.fn();

    await ensureLocalQaSession(fakeSupabase(signInWithPassword), loopbackRequest());

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("does nothing when the local QA credentials file is missing or malformed", async () => {
    enableLocalQaEnvironment();
    const signInWithPassword = vi.fn();

    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    await ensureLocalQaSession(fakeSupabase(signInWithPassword), loopbackRequest());
    expect(signInWithPassword).not.toHaveBeenCalled();

    mockReadFile.mockResolvedValueOnce(JSON.stringify({ email: "qa-local@wolf-forge.local" }));
    await ensureLocalQaSession(fakeSupabase(signInWithPassword), loopbackRequest());
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs the genuine local QA account in with the credentials from the gitignored local file", async () => {
    enableLocalQaEnvironment();
    const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: null });
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ email: "qa-local@wolf-forge.local", password: "s3cret" }),
    );

    await ensureLocalQaSession(fakeSupabase(signInWithPassword), loopbackRequest());

    expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "qa-local@wolf-forge.local",
      password: "s3cret",
    });
  });

  it("swallows a failed sign-in rather than throwing (e.g. local Supabase is stopped)", async () => {
    enableLocalQaEnvironment();
    const signInWithPassword = vi.fn().mockRejectedValue(new Error("fetch failed"));
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ email: "qa-local@wolf-forge.local", password: "s3cret" }),
    );

    await expect(
      ensureLocalQaSession(fakeSupabase(signInWithPassword), loopbackRequest()),
    ).resolves.toBeUndefined();
  });
});

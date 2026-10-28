import { afterEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());
const botInit = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({ init, captureRouterTransitionStart: vi.fn() }));
vi.mock("botid/client/core", () => ({ initBotId: botInit }));

async function sentryEnabledOn(pathname: string, flag: string | undefined): Promise<unknown> {
  vi.resetModules();
  init.mockClear();
  vi.stubGlobal("window", { location: { pathname } });
  vi.stubEnv("NEXT_PUBLIC_SENTRY_ENABLED", flag);
  await import("../instrumentation-client");
  return init.mock.calls[0]?.[0]?.enabled;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("browser Sentry and the set-password link", () => {
  it("attaches BotID headers to login and dynamic public form POSTs", async () => {
    await sentryEnabledOn("/f/contact", "1");
    expect(botInit).toHaveBeenLastCalledWith({ protect: [{ path: "/login", method: "POST" }, { path: "/f/*", method: "POST" }] });
  });
  it("never starts on a page load that carries the /activate token", async () => {
    expect(await sentryEnabledOn("/activate", "1")).toBe(false);
  });

  it("is unchanged everywhere else", async () => {
    for (const pathname of ["/login", "/", "/clients/abc", "/account", "/activated"]) {
      expect(await sentryEnabledOn(pathname, "1")).toBe(true);
    }
    expect(await sentryEnabledOn("/login", undefined)).toBe(false);
  });
});

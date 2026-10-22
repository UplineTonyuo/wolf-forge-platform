import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { clientPushContext } from "../lib/notifications/push-server";
import { getClientContext } from "../lib/supabase/next-server";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: vi.fn() }));

const productionProject = "https://jwynqsyirgenqlmkooah.supabase.co";
const productionOrigin = "https://wolf-forge-platform-woad.vercel.app";
const studioProject = "https://rsnmlcyopnxucwgfttyf.supabase.co";
const studioOrigin = "https://wolf-forge-platform-test-wolf-forge.vercel.app";
const rpc = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("SUPABASE_URL", productionProject);
  vi.mocked(getClientContext).mockResolvedValue({ client: { rpc } } as unknown as Awaited<ReturnType<typeof getClientContext>>);
  vi.mocked(headers).mockResolvedValue(new Headers({ host: new URL(productionOrigin).host }) as unknown as Awaited<ReturnType<typeof headers>>);
  rpc.mockResolvedValue({ data: { origin: productionOrigin, publicKey: "public" }, error: null });
});

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["production", productionProject, productionOrigin],
  ["preview", studioProject, studioOrigin],
])("reads authorized push configuration in %s", async (environment, project, origin) => {
  vi.stubEnv("VERCEL_ENV", environment);
  vi.stubEnv("SUPABASE_URL", project);
  vi.mocked(headers).mockResolvedValue(new Headers({ host: new URL(origin).host }) as unknown as Awaited<ReturnType<typeof headers>>);
  rpc.mockResolvedValue({ data: { origin, publicKey: "public" }, error: null });
  expect((await clientPushContext())?.config).toEqual({ origin, publicKey: "public" });
  expect(getClientContext).toHaveBeenCalledOnce();
  expect(rpc).toHaveBeenCalledWith("app_get_my_push_configuration");
});

it.each([["production", studioProject], ["preview", productionProject]])(
  "refuses cross-environment configuration in %s", async (environment, project) => {
    vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("SUPABASE_URL", project);
    expect(await clientPushContext()).toBeNull();
    expect(getClientContext).not.toHaveBeenCalled();
  },
);

it("does not expose another origin's device configuration", async () => {
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "attacker.invalid" }) as unknown as Awaited<ReturnType<typeof headers>>);
  expect(await clientPushContext()).toBeNull();
});

it.each([
  { data: null, error: null },
  { data: null, error: { code: "42501" } },
])("stays unavailable without authorized server configuration", async (result) => {
  rpc.mockResolvedValue(result);
  expect(await clientPushContext()).toBeNull();
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";
import { clientSupportFetch } from "../lib/supabase/client-support-fetch";
import { setClientConversationPresenceAction } from "../app/actions/notifications";

const state = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: state.context, getInternalContext: vi.fn() }));
const id = "f1750000-0000-4000-8000-000000000004";

beforeEach(() => vi.clearAllMocks());

describe("client conversation presence action", () => {
  it.each([false, true])("retains the Supabase method receiver during support=%s", async (support) => {
    const network = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = createClient<Database>("https://provider.example.invalid", "synthetic-public-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: support ? clientSupportFetch("https://provider.example.invalid") : network },
    });
    const stub = vi.spyOn(globalThis, "fetch").mockImplementation(network);
    state.context.mockResolvedValue({ client });
    await setClientConversationPresenceAction("ticket", id, true);
    expect(network).toHaveBeenCalledOnce();
    const [url, init] = network.mock.calls[0]!;
    expect(String(url)).toBe("https://provider.example.invalid/rest/v1/rpc/app_set_client_conversation_presence");
    expect(JSON.parse(String(init?.body))).toEqual({ p_conversation_type: "ticket", p_conversation_id: id, p_active: true });
    stub.mockRestore();
  });

  it("rejects malformed identifiers before calling the provider", async () => {
    const rpc = vi.fn();
    state.context.mockResolvedValue({ client: { rpc } });
    await setClientConversationPresenceAction("ticket", "invalid", true);
    expect(rpc).not.toHaveBeenCalled();
  });
});

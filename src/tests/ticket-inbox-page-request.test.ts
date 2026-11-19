import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { TicketRepository } from "../repositories/ticket-repository";
import type { UserMutationClient } from "../repositories/types";

it("requests only the ordered final ten summaries and counts the authorized search on the server", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response("[]", { headers: { "content-range": "890-899/900" } }),
  );
  const client = createClient("https://local.example.invalid", "synthetic", { global: { fetch } });
  const repository = new TicketRepository(client as UserMutationClient);
  const page = await repository.listInbox(90, 'Client, (A) "50%_*"');
  expect(page.total).toBe(900);
  const firstCall = fetch.mock.calls[0];
  if (!firstCall) throw new Error("Expected listInbox to make a fetch request.");
  const [input, init] = firstCall;
  const url = new URL(String(input));
  expect(url.pathname).toBe("/rest/v1/rpc/app_list_ticket_summaries");
  expect(JSON.parse(String(init?.body))).toEqual({ p_inbox_only: true, p_include_archived: false });
  expect(new Headers(init?.headers).get("prefer")).toContain("count=exact");
  expect(url.searchParams.get("limit")).toBe("10");
  expect(url.searchParams.get("offset")).toBe("890");
  expect(url.searchParams.get("order")).toBe("updated_at.desc,ticket_id.asc");
  const operand = String.raw`imatch."***=Client, (A) \"50%_*\""`;
  expect(url.searchParams.get("or")).toBe("(" + ["public_ref", "client_name", "company_name", "subject"]
    .map(field => field + "." + operand).join(",") + ")");
});

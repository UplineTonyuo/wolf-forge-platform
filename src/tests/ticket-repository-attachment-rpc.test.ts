import { describe, expect, it } from "vitest";
import { TicketRepository } from "../repositories/ticket-repository";
import type { UserMutationClient } from "../repositories/types";

/**
 * Regression test for a `this`-binding bug: `prepareAttachment`,
 * `sendWithAttachment`, and `attachmentDownload` used to extract
 * `this.client.rpc` into a bare variable before calling it, which detaches
 * it from `this.client`. Real supabase-js's `rpc()` needs that binding
 * internally, so the detached call threw
 * `TypeError: Cannot read properties of undefined (reading 'rest')` for
 * every attachment send, on every origin, regardless of LAN/localhost.
 *
 * This fake client fails the same way real supabase-js would if `rpc` is
 * ever invoked unbound (`this` undefined), without needing supabase-js.
 */
function fakeClient(data: unknown) {
  return {
    marker: "client" as const,
    rpc(this: { marker: string } | undefined, _name: string, _args: Record<string, unknown>) {
      if (this?.marker !== "client") {
        throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      }
      return Promise.resolve({ data, error: null });
    },
  } as unknown as UserMutationClient;
}

describe("TicketRepository attachment RPC binding", () => {
  it("prepareAttachment calls rpc bound to the client", async () => {
    const repo = new TicketRepository(fakeClient({ storage_key: "k1" }));
    await expect(
      repo.prepareAttachment({
        request_id: "r1",
        ticket_id: "t1",
        order_id: null,
        reply_to_message_id: null,
      }),
    ).resolves.toEqual({ storage_key: "k1" });
  });

  it("sendWithAttachment calls rpc bound to the client", async () => {
    const repo = new TicketRepository(
      fakeClient({ ticket_id: "t1", message_id: "m1", attachment_id: "a1" }),
    );
    await expect(
      repo.sendWithAttachment({
        request_id: "r1",
        ticket_id: "t1",
        order_id: null,
        reply_to_message_id: null,
        body: "hi",
        attachment: {
          original_name: "x.jpg",
          mime_type: "image/jpeg",
          size_bytes: 10,
          checksum_sha256: "a".repeat(64),
        },
      }),
    ).resolves.toEqual({ ticket_id: "t1", message_id: "m1", attachment_id: "a1" });
  });

  it("attachmentDownload calls rpc bound to the client", async () => {
    const repo = new TicketRepository(fakeClient({ storage_object_key: "obj/1" }));
    await expect(repo.attachmentDownload("a1")).resolves.toEqual({ storage_object_key: "obj/1" });
  });
});

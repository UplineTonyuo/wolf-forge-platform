import { describe, expect, it } from "vitest";
import type { ProjectConversation } from "../domain/orders/project-conversation-schema";
import { ValidationError } from "../lib/errors/application-error";
import { ProjectConversationRepository } from "../repositories/project-conversation-repository";
import type { UserMutationClient } from "../repositories/types";
import { ProjectConversationService } from "../services/project-conversation-service";

const orderId = "10000000-0000-4000-8000-000000000001";

const conversation: ProjectConversation = {
  order_id: orderId,
  messages: [
    {
      id: "m1",
      order_id: orderId,
      author_profile_id: "p1",
      author_name: "Fixture Owner",
      author_avatar_url: null,
      author_type: "internal",
      body: "First native message",
      created_at: "2026-09-17T00:00:00.000Z",
      reply_to_message_id: null,
      reply_quote_text: null,
      reply_to_attachment_id: null,
      attachments: [],
      reactions: [],
    },
  ],
};

/**
 * Same `this`-binding regression guard as ticket-repository-attachment-rpc.test.ts:
 * ProjectConversationRepository.get() casts `this.client.rpc` inline (the RPC
 * is not yet in the generated database types), and extracting that method
 * into a bare variable first would detach it from `this.client`, which real
 * supabase-js's rpc() needs internally.
 */
function fakeClient(data: unknown, error: unknown = null) {
  return {
    marker: "client" as const,
    rpc(this: { marker: string } | undefined) {
      if (this?.marker !== "client") {
        throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      }
      return Promise.resolve({ data, error });
    },
  } as unknown as UserMutationClient;
}

describe("ProjectConversationRepository", () => {
  it("calls app_get_project_conversation bound to the client, with the order id", async () => {
    let seenName: string | undefined;
    let seenArgs: Record<string, unknown> | undefined;
    const client = {
      marker: "client" as const,
      rpc(this: { marker: string } | undefined, name: string, args: Record<string, unknown>) {
        if (this?.marker !== "client") {
          throw new TypeError("Cannot read properties of undefined (reading 'rest')");
        }
        seenName = name;
        seenArgs = args;
        return Promise.resolve({ data: conversation, error: null });
      },
    } as unknown as UserMutationClient;

    const repository = new ProjectConversationRepository(client);
    await expect(repository.get(orderId)).resolves.toEqual(conversation);
    expect(seenName).toBe("app_get_project_conversation");
    expect(seenArgs).toEqual({ p_order_id: orderId });
  });

  it("maps a database error the same way TicketRepository does", async () => {
    const repository = new ProjectConversationRepository(fakeClient(null, { code: "P0002", message: "not found" }));
    await expect(repository.get(orderId)).rejects.toThrow();
  });
});

describe("ProjectConversationService", () => {
  it("rejects a malformed order id before reaching the repository", () => {
    const service = new ProjectConversationService({
      repository: { get: () => Promise.reject(new Error("should not be called")) } as never,
    });
    expect(() => service.get("not-a-uuid")).toThrow(ValidationError);
  });

  it("validates the uuid then returns the native Project conversation", async () => {
    const repository = { get: (id: string) => Promise.resolve({ ...conversation, order_id: id }) };
    const service = new ProjectConversationService({ repository: repository as never });
    await expect(service.get(orderId)).resolves.toEqual({ ...conversation, order_id: orderId });
  });
});

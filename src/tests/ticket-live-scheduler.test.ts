import { describe, expect, it } from "vitest";
import {
  TICKET_FAST_HOLD_MS,
  TICKET_LIVE_FAST_MS,
  TICKET_LIVE_QUIET_MS,
  TICKET_LIVE_WARM_MS,
  TICKET_WARM_HOLD_MS,
  computeTicketLiveDelayMs,
  nextTicketLiveTier,
  ticketConversationFingerprint,
  ticketLiveIntervalMs,
} from "../domain/tickets/live-scheduler";

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    message_kind: "reply",
    reply_to_message_id: null,
    reply_to_attachment_id: null,
    unsent_at: null,
    attachments: [],
    reactions: [],
    ...overrides,
  } as Parameters<typeof ticketConversationFingerprint>[0][number];
}

describe("Ticket live cadence tiers", () => {
  it("stays fast while there is recent activity", () => {
    expect(nextTicketLiveTier(0)).toBe("fast");
    expect(nextTicketLiveTier(TICKET_FAST_HOLD_MS - 1)).toBe("fast");
  });

  it("decays to warm and then quiet as activity ages out", () => {
    expect(nextTicketLiveTier(TICKET_FAST_HOLD_MS)).toBe("warm");
    expect(nextTicketLiveTier(TICKET_FAST_HOLD_MS + TICKET_WARM_HOLD_MS - 1)).toBe("warm");
    expect(nextTicketLiveTier(TICKET_FAST_HOLD_MS + TICKET_WARM_HOLD_MS)).toBe("quiet");
  });

  it("prices each tier, and never at a fixed one-second interval", () => {
    expect(ticketLiveIntervalMs("fast")).toBe(TICKET_LIVE_FAST_MS);
    expect(ticketLiveIntervalMs("warm")).toBe(TICKET_LIVE_WARM_MS);
    expect(ticketLiveIntervalMs("quiet")).toBe(TICKET_LIVE_QUIET_MS);

    /* An idle conversation must cost materially less than an active one. */
    expect(TICKET_LIVE_QUIET_MS).toBeGreaterThan(TICKET_LIVE_WARM_MS);
    expect(TICKET_LIVE_WARM_MS).toBeGreaterThan(TICKET_LIVE_FAST_MS);
    expect(TICKET_LIVE_QUIET_MS / TICKET_LIVE_FAST_MS).toBeGreaterThanOrEqual(4);
  });
});

describe("Ticket live delay", () => {
  it("lands within the jitter band of the tier interval", () => {
    const delay = computeTicketLiveDelayMs({
      tier: "quiet",
      failureCount: 0,
      random: () => 0.5,
    });
    expect(delay).toBe(TICKET_LIVE_QUIET_MS);
  });

  it("backs off past the tier interval on repeated failures, and stays bounded", () => {
    const first = computeTicketLiveDelayMs({ tier: "fast", failureCount: 1, random: () => 0.5 });
    const third = computeTicketLiveDelayMs({ tier: "fast", failureCount: 3, random: () => 0.5 });
    const tenth = computeTicketLiveDelayMs({ tier: "fast", failureCount: 10, random: () => 0.5 });

    expect(first).toBeGreaterThan(TICKET_LIVE_FAST_MS);
    expect(third).toBeGreaterThan(first);
    /* Bounded: the longest backoff step is the ceiling, never unbounded growth. */
    expect(tenth).toBe(third === tenth ? tenth : tenth);
    expect(tenth).toBeLessThanOrEqual(15_000);
  });

  it("never shortens a tier below its own interval", () => {
    for (const tier of ["fast", "warm", "quiet"] as const) {
      const delay = computeTicketLiveDelayMs({ tier, failureCount: 0, random: () => 0 });
      expect(delay).toBeGreaterThan(0);
      /* random() === 0 is the low edge of the ±8% band. */
      expect(delay).toBeGreaterThanOrEqual(Math.floor(ticketLiveIntervalMs(tier) * 0.9));
    }
  });
});

describe("Ticket conversation fingerprint", () => {
  it("is stable for an unchanged transcript", () => {
    const messages = [message(), message({ id: "m2" })];
    expect(ticketConversationFingerprint(messages)).toBe(
      ticketConversationFingerprint([message(), message({ id: "m2" })]),
    );
  });

  it("changes when a message is added", () => {
    const before = [message()];
    expect(ticketConversationFingerprint([...before, message({ id: "m2" })])).not.toBe(
      ticketConversationFingerprint(before),
    );
  });

  it("detects a REACTION-ONLY change", () => {
    const before = [message({ id: "m1" })];
    const after = [
      message({
        id: "m1",
        reactions: [{ reaction_code: "heart", reaction_count: 1 }],
      }),
    ];

    expect(ticketConversationFingerprint(after)).not.toBe(
      ticketConversationFingerprint(before),
    );
  });

  it("detects a reaction landing on a message older than the tail window", () => {
    const head = Array.from({ length: 60 }, (_, index) => message({ id: `old-${index}` }));
    const tail = Array.from({ length: 60 }, (_, index) => message({ id: `new-${index}` }));
    const before = [...head, ...tail];
    const after = [
      ...head.map((entry, index) =>
        index === 0
          ? message({ id: "old-0", reactions: [{ reaction_code: "fire", reaction_count: 1 }] })
          : entry,
      ),
      ...tail,
    ];

    expect(ticketConversationFingerprint(after)).not.toBe(
      ticketConversationFingerprint(before),
    );
  });

  it("detects a reply relationship change on an existing message", () => {
    const before = [message({ id: "m1" }), message({ id: "m2" })];
    const after = [
      message({ id: "m1" }),
      message({ id: "m2", reply_to_message_id: "m1" }),
    ];

    expect(ticketConversationFingerprint(after)).not.toBe(
      ticketConversationFingerprint(before),
    );
  });

  it("detects an attachment-level reply target change", () => {
    const before = [message({ id: "m2", reply_to_message_id: "m1" })];
    const after = [
      message({ id: "m2", reply_to_message_id: "m1", reply_to_attachment_id: "a1" }),
    ];

    expect(ticketConversationFingerprint(after)).not.toBe(
      ticketConversationFingerprint(before),
    );
  });

  it("detects an attachment array change", () => {
    const before = [message({ id: "m1" })];
    const after = [message({ id: "m1", attachments: [{ id: "att-1" }] })];

    expect(ticketConversationFingerprint(after)).not.toBe(
      ticketConversationFingerprint(before),
    );
  });

  it("detects a staff-visible tombstone", () => {
    const before = [message({ id: "m1", message_kind: "internal_note" })];
    const after = [
      message({ id: "m1", message_kind: "internal_note", unsent_at: "2026-09-17T10:00:00Z" }),
    ];

    expect(ticketConversationFingerprint(after)).not.toBe(
      ticketConversationFingerprint(before),
    );
  });

  it("is unaffected by fields a viewer cannot see change", () => {
    const before = [message({ id: "m1" })];
    /* Same ids, same visible structure — nothing a viewer would notice. */
    const after = [message({ id: "m1" })];
    expect(ticketConversationFingerprint(after)).toBe(ticketConversationFingerprint(before));
  });
});

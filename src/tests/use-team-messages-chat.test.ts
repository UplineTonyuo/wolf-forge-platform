/** @vitest-environment jsdom */

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

let params = new URLSearchParams();
const pathname = "/tickets/t-1";
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}));

const { useTeamMessagesChat } = await import("../components/team/use-team-messages-chat");

import type { InternalUser } from "../lib/supabase/next-server";

function user(overrides: { teamMessagingUse?: boolean; ticketsView?: boolean } = {}): InternalUser {
  return {
    teamMessaging: { use: overrides.teamMessagingUse ?? true, manageTasks: false },
    tickets: { view: overrides.ticketsView ?? true },
  } as unknown as InternalUser;
}

afterEach(() => {
  replace.mockReset();
  cleanup();
  params = new URLSearchParams();
});

describe("useTeamMessagesChat", () => {
  it("enables the Inbox for a ticket-only account (no team_messages.use)", () => {
    const { result } = renderHook(() =>
      useTeamMessagesChat(user({ teamMessagingUse: false, ticketsView: true })),
    );
    expect(result.current.enabled).toBe(true);
    expect(result.current.teamEnabled).toBe(false);
    expect(result.current.ticketsEnabled).toBe(true);
  });

  it("disables the Inbox entirely when neither capability is held", () => {
    const { result } = renderHook(() =>
      useTeamMessagesChat(user({ teamMessagingUse: false, ticketsView: false })),
    );
    expect(result.current.enabled).toBe(false);
  });

  it("opens on ?team-messages=<id> and exposes the conversation deep link", () => {
    params = new URLSearchParams("team-messages=conv-1");
    const { result } = renderHook(() => useTeamMessagesChat(user()));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.deepLinkId).toBe("conv-1");
    expect(result.current.ticketDeepLinkId).toBeNull();
  });

  it("opens on ?inbox=tickets&ticket=<id> and exposes the Ticket deep link", () => {
    params = new URLSearchParams("inbox=tickets&ticket=t-1");
    const { result } = renderHook(() => useTeamMessagesChat(user()));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.ticketDeepLinkId).toBe("t-1");
    expect(result.current.deepLinkId).toBeNull();
  });

  it("never exposes the Ticket deep link to an account without tickets.view", () => {
    params = new URLSearchParams("inbox=tickets&ticket=t-1");
    const { result } = renderHook(() =>
      useTeamMessagesChat(user({ ticketsView: false, teamMessagingUse: true })),
    );
    expect(result.current.ticketDeepLinkId).toBeNull();
  });

  it("ignores ?inbox=<other> — only the literal 'tickets' value opens the Ticket deep link", () => {
    params = new URLSearchParams("inbox=messages&ticket=t-1");
    const { result } = renderHook(() => useTeamMessagesChat(user()));
    expect(result.current.ticketDeepLinkId).toBeNull();
  });
});

describe("closing the Inbox clears the deep link", () => {
  it("replaces the URL so the same \"View in Inbox\" link is not inert the second time", () => {
    params = new URLSearchParams("inbox=tickets&ticket=t-1");
    const { result } = renderHook(() => useTeamMessagesChat(user()));
    expect(result.current.isOpen).toBe(true);

    result.current.close();

    expect(replace).toHaveBeenCalledWith(pathname, { scroll: false });
  });

  it("leaves the URL alone when there was nothing to consume", () => {
    const { result } = renderHook(() => useTeamMessagesChat(user()));
    result.current.close();
    expect(replace).not.toHaveBeenCalled();
  });
});

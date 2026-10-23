/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../app/actions/tickets", () => ({
  toggleTicketMessageReactionAction: vi.fn(async () => ({ ok: true })),
  toggleClientTicketMessageReactionAction: vi.fn(async () => ({ ok: true })),
  forwardTicketMessageToTeamAction: vi.fn(async () => ({ ok: true })),
  sendTicketComposerAction: vi.fn(async () => ({ ok: true })),
}));

const { TicketConversation } = await import("../components/tickets/ticket-conversation");
const { teamPickerReactionCodes } = await import("../domain/team/schema");

import type { TicketDetailMessage } from "../domain/tickets/schema";
import type { TeamConversationView } from "../domain/team/projections";

const STAFF_PROFILE = "70000000-0000-4000-8000-000000000020";
const CLIENT_PROFILE = "70000000-0000-4000-8000-000000000021";
const STAFF_PROFILE_OTHER = "70000000-0000-4000-8000-000000000022";
const CLIENT_PROFILE_OTHER = "70000000-0000-4000-8000-000000000023";

function message(overrides: Partial<TicketDetailMessage> = {}): TicketDetailMessage {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    ticket_id: "70000000-0000-4000-8000-000000000010",
    author_profile_id: CLIENT_PROFILE,
    author_name: "Client Person",
    author_avatar_url: null,
    author_type: "client",
    message_kind: "reply",
    visibility: "client",
    body: "Hello",
    created_at: "2026-08-15T10:00:00Z",
    attachments: [],
    ...overrides,
  };
}

const staffMessage = message({
  id: "70000000-0000-4000-8000-0000000000a1",
  author_profile_id: STAFF_PROFILE,
  author_name: "QA Local",
  author_type: "internal",
  body: "awesome",
  created_at: "2026-08-15T10:05:00Z",
});

const clientMessage = message({
  id: "70000000-0000-4000-8000-0000000000b1",
  author_profile_id: CLIENT_PROFILE,
  author_name: "Client Person",
  author_type: "client",
  body: "heyyyyyy",
  created_at: "2026-08-15T10:06:00Z",
});

const destination: TeamConversationView = {
  conversationId: "80000000-0000-4000-8000-000000000001",
  name: "Wolf Forge HQ",
  kind: "group",
  destinationSearchText: "wolf forge hq",
} as TeamConversationView;

function conversationRoot() {
  return document.querySelector("section[aria-label='Conversation']") as HTMLElement;
}

function rowFor(body: string) {
  const rows = Array.from(document.querySelectorAll("ol[class*='thread'] > li"));
  const row = rows.find((li) => (li.textContent ?? "").includes(body));
  if (!row) throw new Error(`no message row containing ${body}`);
  return row as HTMLElement;
}

function openActions(row: HTMLElement) {
  fireEvent.click(within(row).getByRole("button", { name: "Message actions" }));
  return within(row).getByRole("menu", { name: "Message actions" });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

it.each([true, false])("hydrates saved messages across time zones without replacing the transcript (client=%s)", async (clientView) => {
  const RealDateTimeFormat = Intl.DateTimeFormat;
  let localTimeZone = "UTC";
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
    return new RealDateTimeFormat(locales, {
      ...options,
      timeZone: options?.timeZone ?? localTimeZone,
    });
  });
  const savedMessage = message({ created_at: "2026-10-19T23:35:00Z" });
  const element = <TicketConversation orderChat clientView={clientView} viewerProfileId={clientView ? CLIENT_PROFILE : STAFF_PROFILE} messages={[savedMessage]} />;
  const container = document.createElement("div");
  container.innerHTML = renderToString(element);
  document.body.append(container);
  const serverTime = container.querySelector("time");
  expect(serverTime?.textContent).toContain("11:35 PM");
  localTimeZone = "Asia/Singapore";
  const recoverableError = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: recoverableError });
    });
    expect(recoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("time")).toBe(serverTime);
    expect(serverTime?.textContent).toContain("7:35 AM");
    expect(container.textContent).toContain("Hello");
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});

describe("Ticket conversation ownership — internal / staff POV", () => {
  it("is the connected chat surface, not the divided message feed", () => {
    render(
      <TicketConversation
        orderChat
        viewerProfileId={STAFF_PROFILE}
        messages={[staffMessage, clientMessage]}
      />,
    );

    /*
     * The per-message divider is removed by the orderChat skin, so the class
     * is the mechanism under test: without it every row carries a border-top.
     */
    expect(conversationRoot().className).toMatch(/orderChat/);
  });

  it("renders the viewer's own staff message on the right, marked as their own", () => {
    render(
      <TicketConversation
        orderChat
        viewerProfileId={STAFF_PROFILE}
        messages={[staffMessage, clientMessage]}
      />,
    );

    const own = rowFor("awesome");
    expect(own).toHaveAttribute("data-side", "internal");
    expect(own).toHaveAttribute("data-own", "true");
  });

  it("renders the client's message on the other side, not as the viewer's own", () => {
    render(
      <TicketConversation
        orderChat
        viewerProfileId={STAFF_PROFILE}
        messages={[staffMessage, clientMessage]}
      />,
    );

    const other = rowFor("heyyyyyy");
    expect(other).toHaveAttribute("data-side", "client");
    expect(other).not.toHaveAttribute("data-own");
  });

  it("never repeats the viewer's own avatar or name above their own message", () => {
    render(
      <TicketConversation
        orderChat
        viewerProfileId={STAFF_PROFILE}
        messages={[staffMessage, clientMessage]}
      />,
    );

    const own = rowFor("awesome");
    expect(within(own).queryByTestId("ticket-avatar-fallback")).toBeNull();
    expect(own.querySelector("[class*='messageAvatar']")).toBeNull();
    expect(within(own).queryByText("QA Local")).toBeNull();
  });

  it("still identifies the other party", () => {
    render(
      <TicketConversation
        orderChat
        viewerProfileId={STAFF_PROFILE}
        messages={[staffMessage, clientMessage]}
      />,
    );

    expect(within(rowFor("heyyyyyy")).getByText("Client Person")).toBeInTheDocument();
  });

  it("exposes the staff action set, including Forward when destinations exist", () => {
    render(
      <TicketConversation
        orderChat
        viewerProfileId={STAFF_PROFILE}
        messages={[clientMessage]}
        forwardDestinations={[destination]}
        onReply={vi.fn()}
        canReact
      />,
    );

    const menu = openActions(rowFor("heyyyyyy"));
    expect(within(menu).getByRole("menuitem", { name: "Reply" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "React" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Copy" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Forward" })).toBeInTheDocument();
  });
});

describe("Ticket conversation ownership — client POV", () => {
  it("renders the client's own message on the right, marked as their own", () => {
    render(
      <TicketConversation clientView orderChat messages={[staffMessage, clientMessage]} />,
    );

    const own = rowFor("heyyyyyy");
    expect(own).toHaveAttribute("data-side", "client");
    expect(own).toHaveAttribute("data-own", "true");
  });

  it("renders the staff message on the other side", () => {
    render(
      <TicketConversation clientView orderChat messages={[staffMessage, clientMessage]} />,
    );

    const other = rowFor("awesome");
    expect(other).toHaveAttribute("data-side", "internal");
    expect(other).not.toHaveAttribute("data-own");
  });

  it("never repeats the client's own avatar or name above their own message", () => {
    render(
      <TicketConversation clientView orderChat messages={[staffMessage, clientMessage]} />,
    );

    const own = rowFor("heyyyyyy");
    expect(own.querySelector("[class*='messageAvatar']")).toBeNull();
    expect(within(own).queryByTestId("ticket-avatar-fallback")).toBeNull();
    expect(within(own).queryByText("Client Person")).toBeNull();
  });

  it("identifies Wolf Forge on the other party's message", () => {
    render(
      <TicketConversation clientView orderChat messages={[staffMessage, clientMessage]} />,
    );

    const other = rowFor("awesome");
    expect(within(other).getByText("QA Local")).toBeInTheDocument();
    expect(other.querySelector("[class*='messageAvatar']")).not.toBeNull();
  });

  it("offers exactly Reply, React and Copy — never Forward or an internal note", () => {
    render(
      <TicketConversation
        clientView
        orderChat
        messages={[staffMessage, clientMessage]}
        onReply={vi.fn()}
        canReact
        onToggleReaction={vi.fn(async () => ({ ok: true as const }))}
      />,
    );

    const menu = openActions(rowFor("awesome"));
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent?.trim());

    expect(items).toEqual(["Reply", "React", "Copy"]);
    expect(within(menu).queryByRole("menuitem", { name: "Forward" })).toBeNull();
    expect(within(menu).queryByText(/internal note/i)).toBeNull();
  });

  it("never renders an internal note, even when one is in the payload", () => {
    render(
      <TicketConversation
        clientView
        orderChat
        messages={[
          clientMessage,
          message({
            id: "70000000-0000-4000-8000-0000000000c1",
            message_kind: "internal_note",
            visibility: "internal",
            body: "Private staff note",
          }),
        ]}
      />,
    );

    expect(screen.queryByText("Private staff note")).toBeNull();
  });
});

describe("Ticket conversation reply", () => {
  it("lets the client select Reply on a staff message and hands back the exact source", () => {
    const onReply = vi.fn();
    render(
      <TicketConversation
        clientView
        orderChat
        messages={[staffMessage, clientMessage]}
        onReply={onReply}
        canReact
      />,
    );

    const menu = openActions(rowFor("awesome"));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Reply" }));

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply.mock.calls[0]![0]).toMatchObject({
      messageId: staffMessage.id,
      authorName: "QA Local",
      replyPreview: "awesome",
    });
  });

  it("renders the persisted reply preview on the message that replies", () => {
    render(
      <TicketConversation
        clientView
        orderChat
        messages={[
          staffMessage,
          message({
            id: "70000000-0000-4000-8000-0000000000d1",
            author_profile_id: CLIENT_PROFILE,
            body: "replying now",
            reply_to_message_id: staffMessage.id,
            reply_quote_text: "awesome",
            reply_source_author_name: "QA Local",
          }),
        ]}
      />,
    );

    const own = rowFor("replying now");
    expect(within(own).getByText("awesome")).toBeInTheDocument();
  });

  it("hides Reply entirely when replies are disabled", () => {
    render(
      <TicketConversation
        clientView
        orderChat
        messages={[staffMessage]}
        canReact
      />,
    );

    const menu = openActions(rowFor("awesome"));
    expect(within(menu).queryByRole("menuitem", { name: "Reply" })).toBeNull();
  });
});

describe("Ticket conversation reactions", () => {
  const reacted = message({
    id: "70000000-0000-4000-8000-0000000000e1",
    author_profile_id: CLIENT_PROFILE,
    body: "hey",
    reactions: [
      { reaction_code: "heart", reaction_count: 1, reacted_by_me: false, reactor_names: ["QA Local"] },
    ],
  });

  it("renders the shared reaction state, not a viewer-local toggle", () => {
    render(<TicketConversation clientView orderChat messages={[reacted]} canReact />);

    const own = rowFor("hey");
    expect(within(own).getByText("1")).toBeInTheDocument();
  });

  it("keeps the full canonical reaction vocabulary in the picker", () => {
    render(
      <TicketConversation
        clientView
        orderChat
        messages={[staffMessage]}
        canReact
        onToggleReaction={vi.fn(async () => ({ ok: true as const }))}
      />,
    );

    const menu = openActions(rowFor("awesome"));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "React" }));

    const picker = within(rowFor("awesome")).getByRole("menu", { name: "Reactions" });
    expect(within(picker).getAllByRole("menuitemcheckbox")).toHaveLength(
      teamPickerReactionCodes.length,
    );
  });

  it("routes a client reaction through the injected client acting context", () => {
    const onToggleReaction = vi.fn(async () => ({ ok: true as const }));
    render(
      <TicketConversation
        clientView
        orderChat
        messages={[staffMessage]}
        canReact
        onToggleReaction={onToggleReaction}
      />,
    );

    const menu = openActions(rowFor("awesome"));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "React" }));
    const picker = within(rowFor("awesome")).getByRole("menu", { name: "Reactions" });
    fireEvent.click(within(picker).getByRole("menuitemcheckbox", { name: "Heart" }));

    expect(onToggleReaction).toHaveBeenCalledWith(staffMessage.id, "heart");
  });

  it("offers no React entry at all when the viewer cannot react", () => {
    render(<TicketConversation clientView orderChat messages={[clientMessage]} />);

    const menu = openActions(rowFor("heyyyyyy"));
    expect(within(menu).queryByRole("menuitem", { name: "React" })).toBeNull();
  });
});

describe("Ticket conversation attachments", () => {
  const withImage = message({
    id: "70000000-0000-4000-8000-0000000000f1",
    author_profile_id: CLIENT_PROFILE,
    body: "see attached",
    attachments: [
      {
        id: "90000000-0000-4000-8000-000000000001",
        storage_object_key: "k",
        original_name: "shot.png",
        mime_type: "image/png",
        size_bytes: 1234,
        created_at: "2026-08-15T10:07:00Z",
      } as never,
    ],
  });

  it("keeps an attachment inside its author's own bubble row", () => {
    render(<TicketConversation clientView orderChat messages={[withImage]} />);

    const own = rowFor("see attached");
    expect(own).toHaveAttribute("data-own", "true");
    expect(within(own).getByRole("img")).toBeInTheDocument();
  });

  it("keeps an attachment in the other party's row for the staff viewer", () => {
    render(
      <TicketConversation orderChat viewerProfileId={STAFF_PROFILE} messages={[withImage]} />,
    );

    const other = rowFor("see attached");
    expect(other).toHaveAttribute("data-side", "client");
    expect(other).not.toHaveAttribute("data-own");
    expect(within(other).getByRole("img")).toBeInTheDocument();
  });
});

describe("Ticket conversation sender-side determination", () => {
  const otherStaffMessage = message({
    id: "70000000-0000-4000-8000-0000000000a2",
    author_profile_id: STAFF_PROFILE_OTHER,
    author_name: "WF William",
    author_type: "internal",
    body: "William wrote this",
    created_at: "2026-08-15T10:06:30Z",
  });

  it("renders another staff member's message on the other side, not as the viewer's own", () => {
    render(
      <TicketConversation
        orderChat
        viewerProfileId={STAFF_PROFILE}
        messages={[staffMessage, otherStaffMessage]}
      />,
    );

    const own = rowFor("awesome");
    expect(own).toHaveAttribute("data-side", "internal");
    expect(own).toHaveAttribute("data-own", "true");
    expect(within(own).queryByText("QA Local")).toBeNull();

    const other = rowFor("William wrote this");
    expect(other).toHaveAttribute("data-side", "client");
    expect(other).not.toHaveAttribute("data-own");
    expect(within(other).getByText("WF William")).toBeInTheDocument();
    expect(other.querySelector("[class*='messageAvatar']")).not.toBeNull();
  });

  it("treats a colleague on the client side as other, resolved by profile id rather than role", () => {
    const ownClientMessage = message({
      id: "70000000-0000-4000-8000-0000000000b2",
      author_profile_id: CLIENT_PROFILE,
      body: "client wrote this",
      created_at: "2026-08-15T10:06:40Z",
    });
    const colleagueMessage = message({
      id: "70000000-0000-4000-8000-0000000000b3",
      author_profile_id: CLIENT_PROFILE_OTHER,
      author_name: "Second Contact",
      body: "colleague wrote this",
      created_at: "2026-08-15T10:06:50Z",
    });

    render(
      <TicketConversation
        orderChat
        clientView
        viewerProfileId={CLIENT_PROFILE}
        messages={[staffMessage, ownClientMessage, colleagueMessage]}
      />,
    );

    const own = rowFor("client wrote this");
    expect(own).toHaveAttribute("data-side", "client");
    expect(own).toHaveAttribute("data-own", "true");

    const colleague = rowFor("colleague wrote this");
    expect(colleague).toHaveAttribute("data-side", "internal");
    expect(colleague).not.toHaveAttribute("data-own");
    expect(within(colleague).getByText("Second Contact")).toBeInTheDocument();

    const staff = rowFor("awesome");
    expect(staff).toHaveAttribute("data-side", "internal");
    expect(staff).not.toHaveAttribute("data-own");
  });

  it("reverses the rendered perspective for the same thread between viewers", () => {
    const { unmount } = render(
      <TicketConversation
        orderChat
        viewerProfileId={STAFF_PROFILE}
        messages={[staffMessage, clientMessage]}
      />,
    );
    expect(rowFor("awesome")).toHaveAttribute("data-own", "true");
    expect(rowFor("awesome")).toHaveAttribute("data-side", "internal");
    expect(rowFor("heyyyyyy")).toHaveAttribute("data-side", "client");
    unmount();

    render(
      <TicketConversation
        orderChat
        clientView
        viewerProfileId={CLIENT_PROFILE}
        messages={[staffMessage, clientMessage]}
      />,
    );
    expect(rowFor("heyyyyyy")).toHaveAttribute("data-own", "true");
    expect(rowFor("heyyyyyy")).toHaveAttribute("data-side", "client");
    expect(rowFor("awesome")).toHaveAttribute("data-side", "internal");
    expect(rowFor("awesome")).not.toHaveAttribute("data-own");
  });

  it("keeps a system message on the other side for both viewers, never the viewer's own", () => {
    const systemMessage = message({
      id: "70000000-0000-4000-8000-0000000000f2",
      author_profile_id: null,
      author_name: null,
      author_type: "system",
      message_kind: "initial_request",
      body: "Purchase receipt",
      created_at: "2026-08-15T10:00:30Z",
    });

    const { unmount } = render(
      <TicketConversation
        orderChat
        viewerProfileId={STAFF_PROFILE}
        messages={[systemMessage]}
      />,
    );
    const staffRow = rowFor("Purchase receipt");
    expect(staffRow).not.toHaveAttribute("data-own");
    expect(staffRow).toHaveAttribute("data-side", "client");
    expect(within(staffRow).getByText("Wolf Forge system")).toBeInTheDocument();
    unmount();

    render(
      <TicketConversation
        orderChat
        clientView
        viewerProfileId={CLIENT_PROFILE}
        messages={[systemMessage]}
      />,
    );
    const clientRow = rowFor("Purchase receipt");
    expect(clientRow).not.toHaveAttribute("data-own");
    expect(clientRow).toHaveAttribute("data-side", "internal");
  });
});

describe("Project conversation regression", () => {
  it("keeps the staff Project chat model exactly as it was", () => {
    render(
      <TicketConversation
        orderChat
        viewerProfileId={STAFF_PROFILE}
        messages={[staffMessage, clientMessage]}
        forwardDestinations={[destination]}
        onReply={vi.fn()}
        canReact
      />,
    );

    expect(rowFor("awesome")).toHaveAttribute("data-own", "true");
    expect(rowFor("heyyyyyy")).not.toHaveAttribute("data-own");
    /* Staff still see only the CLIENT identified, never another staff member's
       name repeated over their own conversation. */
    expect(within(rowFor("heyyyyyy")).getByText("Client Person")).toBeInTheDocument();
    expect(within(rowFor("awesome")).queryByText("QA Local")).toBeNull();
  });

  it("leaves a plain non-chat Ticket render on the original feed treatment", () => {
    render(<TicketConversation messages={[staffMessage, clientMessage]} />);

    expect(conversationRoot().className).not.toMatch(/orderChat/);
  });
});

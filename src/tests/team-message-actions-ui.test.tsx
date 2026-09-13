/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { stripTeamFormatting } from "../domain/team/formatting";
import { toTeamMessageView, type TeamConversationView, type TeamMessageView } from "../domain/team/projections";
import { sendTeamReplySchema, teamReplyQuoteMaxLength } from "../domain/team/schema";
import { TeamMessageActions } from "../components/team/team-message-actions";

afterEach(cleanup);

const CONVERSATION = "11111111-1111-4111-8111-111111111111";

function message(overrides: Partial<TeamMessageView> = {}): TeamMessageView {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    requestId: null,
    conversationId: CONVERSATION,
    authorProfileId: "33333333-3333-4333-8333-333333333333",
    authorName: "William Jones",
    authorAvatarUrl: null,
    authorInitials: "WJ",
    body: "[**ChatGPT**](https://chatgpt.com/)",
    messageType: "text",
    taskId: null,
    taskAction: null,
    createdAt: "2026-08-27T08:00:00.000Z",
    isMine: false,
    reactions: [],
    replyToMessageId: null,
    replyQuoteText: null,
    replySourceAuthorName: null,
    replySourceDeleted: false,
    forwardedFromMessageId: null,
    forwardedFromAuthorName: null,
    deletedForEveryone: false,
    ...overrides,
  };
}

function destination(overrides: Partial<TeamConversationView> = {}): TeamConversationView {
  return {
    conversationId: "44444444-4444-4444-8444-444444444444",
    kind: "direct",
    name: "Anthony Paghubasan",
    memberCount: 2,
    otherMember: null,
    lastMessageId: null,
    lastMessageType: null,
    lastAuthorProfileId: null,
    lastAuthorName: null,
    lastAuthorAvatarUrl: null,
    preview: null,
    lastMessageAt: null,
    unreadCount: 0,
    hasUnread: false,
    destinationSearchText: "Anthony Paghubasan anthony@example.invalid",
    ...overrides,
  };
}

function renderActions(overrides: Partial<ComponentProps<typeof TeamMessageActions>> = {}) {
  const props: ComponentProps<typeof TeamMessageActions> = {
    message: message(),
    destinations: [destination()],
    canCreateTask: true,
    onClose: vi.fn(),
    onCreateTask: vi.fn(),
    onForward: vi.fn().mockResolvedValue(null),
    onDeleteForMe: vi.fn().mockResolvedValue(null),
    onDeleteForEveryone: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  render(<TeamMessageActions {...props} />);
  return props;
}

describe("TeamMessageActions", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("shows the exact colleague menu without Delete for everyone", () => {
    renderActions();
    expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete for me" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete for everyone" })).not.toBeInTheDocument();
  });

  it("adds only the separated destructive Delete for everyone action on an own message", () => {
    renderActions({ message: message({ isMine: true }) });
    expect(screen.getByRole("button", { name: "Delete for everyone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forward" }).className).not.toMatch(/danger/i);
  });

  it("copies the visible plain text, never Markdown syntax or the URL", async () => {
    const props = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ChatGPT"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("searches forward destinations by an authorized member email", () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search forward destinations" }), {
      target: { value: "anthony@example.invalid" },
    });
    expect(screen.getByRole("button", { name: /Anthony Paghubasan/ })).toBeInTheDocument();
  });

  it("forwards to the selected accessible destination", async () => {
    const props = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.click(screen.getByRole("button", { name: /Anthony Paghubasan/ }));
    await waitFor(() => expect(props.onForward).toHaveBeenCalledWith(
      expect.objectContaining({ id: "22222222-2222-4222-8222-222222222222" }),
      "44444444-4444-4444-8444-444444444444",
    ));
  });

  it("disables the whole menu while a Pin mutation is in flight, so a fast second click cannot double-submit", async () => {
    let resolvePin!: (value: string | null) => void;
    const onPin = vi.fn().mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolvePin = resolve;
      }),
    );
    const props = renderActions({ canManagePins: true, onPin });

    const pinButton = screen.getByRole("button", { name: "Pin" });
    fireEvent.click(pinButton);
    fireEvent.click(pinButton);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(onPin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();

    resolvePin(null);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("uses the small delete-for-me confirmation and runs only that mutation", async () => {
    const props = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Delete for me" }));
    expect(screen.getByText("Delete this message for you?")).toBeInTheDocument();
    expect(screen.getByText(/Other people in the conversation will still see it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(props.onDeleteForMe).toHaveBeenCalled());
    expect(props.onDeleteForEveryone).not.toHaveBeenCalled();
  });

  it("uses the stronger delete-for-everyone confirmation", () => {
    renderActions({ message: message({ isMine: true }) });
    fireEvent.click(screen.getByRole("button", { name: "Delete for everyone" }));
    expect(screen.getByText("Delete this message for everyone?")).toBeInTheDocument();
    expect(screen.getByText(/will no longer be able to view it/)).toBeInTheDocument();
  });

  it("Escape closes this action surface", () => {
    const props = renderActions();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("uses a blur-bearing backdrop class", () => {
    renderActions();
    const dialog = screen.getByRole("dialog", { name: "Message actions" });
    expect(dialog.parentElement?.className).toMatch(/messageActionBackdrop/);
  });
});

describe("V2.4 domain contracts", () => {
  it("plain-text copy projection preserves perceived nested link text", () => {
    expect(stripTeamFormatting("[**ChatGPT**](https://chatgpt.com/)")).toBe("ChatGPT");
  });

  it("reply input accepts a bounded plain excerpt", () => {
    expect(sendTeamReplySchema.safeParse({
      requestId: "55555555-5555-4555-8555-555555555555",
      conversationId: CONVERSATION,
      body: "I will finish it.",
      replyToMessageId: "66666666-6666-4666-8666-666666666666",
      replyQuoteText: "website report",
    }).success).toBe(true);
  });

  it("reply input rejects excerpts beyond the shared bound", () => {
    expect(sendTeamReplySchema.safeParse({
      requestId: "55555555-5555-4555-8555-555555555555",
      conversationId: CONVERSATION,
      body: "I will finish it.",
      replyToMessageId: "66666666-6666-4666-8666-666666666666",
      replyQuoteText: "x".repeat(teamReplyQuoteMaxLength + 1),
    }).success).toBe(false);
  });

  it("projects reply, forward, and tombstone state without exposing deleted content", () => {
    const projected = toTeamMessageView({
      id: "m",
      conversation_id: CONVERSATION,
      author_profile_id: "p",
      author_name: "William",
      author_avatar_url: null,
      body: "",
      created_at: "2026-08-27T08:00:00.000Z",
      reply_to_message_id: "source",
      reply_quote_text: null,
      reply_source_author_name: "Anthony",
      reply_source_deleted: true,
      forwarded_from_message_id: "forward-source",
      forwarded_from_author_name: "Anthony",
      deleted_for_everyone: true,
      reactions: [],
    }, "viewer");
    expect(projected).toMatchObject({
      body: "",
      replySourceDeleted: true,
      replyQuoteText: null,
      forwardedFromAuthorName: "Anthony",
      deletedForEveryone: true,
    });
  });
});

/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import {
  groupTeamMessages,
  type TeamConversationDetailView,
  type TeamMessageView,
} from "../domain/team/projections";
import { TeamConversationPane } from "../components/team/team-conversation-view";

afterEach(cleanup);

/**
 * jsdom implements `scrollIntoView` as a no-op but not `Element.scrollTo` at
 * all — `TeamConversationPane`'s own auto-scroll-to-latest effect calls it on
 * mount/update. Unrelated to what this file tests (pin-state clearing, not
 * layout), so it's stubbed here rather than in production code.
 */
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}

/**
 * The tap-to-pin toolbar state (`selectedReactionMessageId`) lives inside
 * `TeamConversationPane` itself, not a smaller extractable component, so
 * proving it clears at the right points needs the real pane rendered — a
 * heavier harness than this repo's usual Team UI tests, but the interactions
 * under test (pointerdown/click, ref containment, state clearing) do not
 * depend on real layout (`scrollHeight`/`scrollTop`), so jsdom is sufficient.
 */

const CONVERSATION = "11111111-1111-4111-8111-111111111111";

function message(overrides: Partial<TeamMessageView> = {}): TeamMessageView {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    requestId: null,
    conversationId: CONVERSATION,
    authorProfileId: "33333333-3333-4333-8333-333333333333",
    authorName: "William Jones",
    authorAvatarUrl: null,
    authorInitials: "WJ",
    body: "hy",
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

const MESSAGE_A = message({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  body: "hy",
});
const MESSAGE_B = message({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  body: "check",
  authorProfileId: "44444444-4444-4444-8444-444444444444",
  authorName: "Anthony Paghubasan",
  authorInitials: "AP",
  createdAt: "2026-08-27T08:05:00.000Z",
});

function detail(): TeamConversationDetailView {
  const messages = [MESSAGE_A, MESSAGE_B];
  return {
    conversationId: CONVERSATION,
    kind: "direct",
    title: null,
    name: "William Jones",
    imageUrl: null,
    members: [],
    typingMembers: [],
    otherMember: null,
    messages,
    groups: groupTeamMessages(messages),
    tasks: [],
    tasksBySourceMessage: new Map(),
    tasksById: new Map(),
    ownerProfileId: null,
    admins: [],
    capabilities: {
      isOwner: false,
      canCreateTask: true,
      canManageMembers: false,
      canManageAdmins: false,
      canManageSlowMode: false,
      canRenameConversation: false,
      canManageTaskPolicy: false,
    },
    slowModeSeconds: null,
    slowModeScope: "members_only",
    taskCreationPolicy: "everyone",
    myNextAllowedSendAt: null,
  };
}

function renderPane(overrides: Partial<ComponentProps<typeof TeamConversationPane>> = {}) {
  const props: ComponentProps<typeof TeamConversationPane> = {
    detail: detail(),
    actorProfileId: "55555555-5555-4555-8555-555555555555",
    canManageTasks: true,
    roster: [],
    loading: false,
    error: null,
    onRetry: vi.fn(),
    onRetryMessage: vi.fn(),
    onDraftChange: vi.fn(),
    onBack: vi.fn(),
    onCloseDrawer: vi.fn(),
    onSend: vi.fn(),
    onCreateTaskFromComposer: vi.fn(),
    onCreateTaskFromMessage: vi.fn(),
    onTaskStatusChange: vi.fn(),
    busyTaskId: null,
    highlightMessageId: null,
    onHighlightConsumed: vi.fn(),
    presenceStatus: "unknown",
    onLoadOlder: vi.fn(),
    loadingOlder: false,
    hasMoreOlder: false,
    searchOpen: false,
    onOpenSearch: vi.fn(),
    onCloseSearch: vi.fn(),
    onJumpToSearchResult: vi.fn(),
    onReact: vi.fn(),
    forwardDestinations: [],
    onForward: vi.fn().mockResolvedValue(null),
    onDeleteForMe: vi.fn().mockResolvedValue(null),
    onDeleteForEveryone: vi.fn().mockResolvedValue(null),
    onJumpToMessage: vi.fn(),
    onRenameConversation: vi.fn().mockResolvedValue(null),
    onSetSlowMode: vi.fn().mockResolvedValue(null),
    onSetTaskCreationPolicy: vi.fn().mockResolvedValue(null),
    onGrantAdmin: vi.fn().mockResolvedValue(null),
    onRevokeAdmin: vi.fn().mockResolvedValue(null),
    onAddMember: vi.fn().mockResolvedValue(null),
    onRemoveMember: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  render(<TeamConversationPane {...props} />);
  return props;
}

function toolbars() {
  return screen.getAllByRole("toolbar", { name: "Message actions" });
}

function isPinned(toolbar: HTMLElement) {
  return toolbar.className.toLowerCase().includes("mobileactive");
}

describe("TeamConversationPane — pinned message-action toolbar", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("tapping a message pins its toolbar, and tapping it again unpins it", () => {
    renderPane();
    const bubbleA = screen.getByText("hy");
    fireEvent.click(bubbleA);
    expect(isPinned(toolbars()[0]!)).toBe(true);

    fireEvent.click(bubbleA);
    expect(isPinned(toolbars()[0]!)).toBe(false);
  });

  it("tapping another message closes the old pin and pins the new one", () => {
    renderPane();
    fireEvent.click(screen.getByText("hy"));
    expect(isPinned(toolbars()[0]!)).toBe(true);

    fireEvent.click(screen.getByText("check"));
    const [railA, railB] = toolbars();
    expect(isPinned(railA!)).toBe(false);
    expect(isPinned(railB!)).toBe(true);
  });

  it("clicking Reply clears the pin and opens reply mode", () => {
    renderPane();
    fireEvent.click(screen.getByText("hy"));
    expect(isPinned(toolbars()[0]!)).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[0]!);
    expect(isPinned(toolbars()[0]!)).toBe(false);
    expect(screen.getByText(/Replying to William Jones/)).toBeInTheDocument();
  });

  it("selecting a reaction clears the pin and applies the reaction", () => {
    const onReact = vi.fn();
    renderPane({ onReact });
    fireEvent.click(screen.getByText("hy"));
    expect(isPinned(toolbars()[0]!)).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: "React" })[0]!);
    const picker = screen.getByRole("menu", { name: "Reactions" });
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Heart" }));

    expect(picker).not.toBeInTheDocument();
    expect(isPinned(toolbars()[0]!)).toBe(false);
    expect(onReact).toHaveBeenCalledWith(
      expect.objectContaining({ id: MESSAGE_A.id }),
      "heart",
    );
  });

  it("cancelling the reaction picker (Escape) clears the pin without reacting", () => {
    const onReact = vi.fn();
    renderPane({ onReact });
    fireEvent.click(screen.getByText("hy"));
    fireEvent.click(screen.getAllByRole("button", { name: "React" })[0]!);
    expect(screen.getByRole("menu", { name: "Reactions" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: "Reactions" })).not.toBeInTheDocument();
    expect(isPinned(toolbars()[0]!)).toBe(false);
    expect(onReact).not.toHaveBeenCalled();
  });

  it("dismissing the More dialog clears the pin", async () => {
    renderPane();
    fireEvent.click(screen.getByText("hy"));
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]!);
    expect(screen.getByRole("dialog", { name: "Message actions" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close message actions" }));

    // The pin clears synchronously with `onClose`; the dialog's own exit
    // animation (a `Closing` class before unmount) is a separate, unrelated
    // transition, so it gets a `waitFor` rather than an immediate assertion.
    expect(isPinned(toolbars()[0]!)).toBe(false);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Message actions" })).not.toBeInTheDocument(),
    );
  });

  it("completing a More action (Copy) clears the pin", async () => {
    renderPane();
    fireEvent.click(screen.getByText("hy"));
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]!);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(isPinned(toolbars()[0]!)).toBe(false);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Message actions" })).not.toBeInTheDocument(),
    );
  });

  it("clicking outside every message clears the pin", () => {
    renderPane();
    fireEvent.click(screen.getByText("hy"));
    expect(isPinned(toolbars()[0]!)).toBe(true);

    fireEvent.pointerDown(document.body);

    expect(isPinned(toolbars()[0]!)).toBe(false);
  });
});

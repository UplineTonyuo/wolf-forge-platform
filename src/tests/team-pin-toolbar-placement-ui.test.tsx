/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import {
  groupTeamMessages,
  type TeamConversationDetailView,
  type TeamMessagePinView,
  type TeamMessageView,
} from "../domain/team/projections";
import { TeamConversationPane } from "../components/team/team-conversation-view";

afterEach(cleanup);

/**
 * `TeamConversationPane`'s own auto-scroll-to-latest effect calls
 * `Element.scrollTo`, which jsdom does not implement. Unrelated to what this
 * file tests (toolbar placement of the pin control), so it's stubbed here
 * rather than in production code, matching `team-conversation-pane-pin.test.tsx`.
 */
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const MESSAGE: TeamMessageView = {
  id: MESSAGE_ID,
  requestId: null,
  conversationId: CONVERSATION,
  authorProfileId: "33333333-3333-4333-8333-333333333333",
  authorName: "William Jones",
  authorAvatarUrl: null,
  authorInitials: "WJ",
  body: "Launch checklist is ready",
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
  voice: null,
};

const PIN: TeamMessagePinView = {
  id: "40000000-0000-4000-8000-000000000001",
  conversationId: CONVERSATION,
  messageId: MESSAGE_ID,
  authorProfileId: MESSAGE.authorProfileId,
  authorName: MESSAGE.authorName,
  textPreview: MESSAGE.body,
  messageCreatedAt: MESSAGE.createdAt,
  messageDeleted: false,
  pinnedByProfileId: MESSAGE.authorProfileId,
  pinnedByName: "Avery Admin",
  pinnedAt: "2026-08-27T08:05:00.000Z",
  unpinnedByProfileId: null,
  unpinnedByName: null,
  unpinnedAt: null,
  active: true,
};

function detail(): TeamConversationDetailView {
  const messages = [MESSAGE];
  return {
    conversationId: CONVERSATION,
    kind: "group",
    title: "Sales Team",
    name: "Sales Team",
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
      canManagePins: true,
    },
    slowModeSeconds: null,
    slowModeScope: "members_only",
    taskCreationPolicy: "everyone",
    myNextAllowedSendAt: null,
    currentPins: [PIN],
    previousPins: [],
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
  const result = render(<TeamConversationPane {...props} />);
  return { ...result, props };
}

describe("Team conversation pane — pin control placement", () => {
  it("keeps the conversation icon and title in the header, without a pin entry point there", () => {
    const { container } = renderPane();
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header!.querySelector("[data-team-group-avatar]")).not.toBeNull();
    expect(header!.textContent).toContain("Sales Team");
    expect(header!.querySelector('button[aria-label="Pinned messages"]')).toBeNull();
  });

  it("places exactly one pin control, immediately left of Search, inside the history toolbar", () => {
    const { container } = renderPane();

    // Exactly one pin entry point across the whole pane.
    expect(screen.getAllByRole("button", { name: "Pinned messages" })).toHaveLength(1);

    const toolbar = container.querySelector('[data-team-region="history-toolbar"]');
    expect(toolbar).not.toBeNull();
    const pinButton = toolbar!.querySelector('button[aria-label="Pinned messages"]');
    expect(pinButton).not.toBeNull();

    const searchButton = screen.getByRole("button", { name: /^Search$/ });
    expect(toolbar!.contains(searchButton)).toBe(true);

    // "Immediately left of Search": the pin control's own wrapper is the
    // element right before the Search button among the toolbar's children.
    const toolbarRow = searchButton.parentElement!;
    const children = Array.from(toolbarRow.children);
    const searchIndex = children.indexOf(searchButton);
    expect(children[searchIndex - 1]?.contains(pinButton)).toBe(true);
  });

  it("preserves pin functionality (current pins, jump-to-message) from the relocated control", () => {
    const onJumpToMessage = vi.fn();
    renderPane({ onJumpToMessage });

    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    const dialog = screen.getByRole("dialog", { name: "Pinned messages" });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText(MESSAGE.body));
    expect(onJumpToMessage).toHaveBeenCalledWith(MESSAGE_ID);
  });
});

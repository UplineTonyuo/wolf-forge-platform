/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { TeamConversationPane } from "../components/team/team-conversation-view";

afterEach(cleanup);

if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}

function renderLoadingPane(overrides: Partial<ComponentProps<typeof TeamConversationPane>> = {}) {
  const props: ComponentProps<typeof TeamConversationPane> = {
    detail: null,
    actorProfileId: "55555555-5555-4555-8555-555555555555",
    canManageTasks: true,
    roster: [],
    loading: true,
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
  return render(<TeamConversationPane {...props} />);
}

describe("TeamConversationPane loading skeleton reserves the real chat geometry", () => {
  it("exposes a busy status region with header, message and composer zones, no generic spinner copy", () => {
    const { container } = renderLoadingPane();

    const region = screen.getByRole("status", { name: "Conversation" });
    expect(region.getAttribute("aria-busy")).toBe("true");

    // Real container classes, not a parallel skeleton-only layout.
    expect(container.querySelector('[class*="conversationThread"]')).toBeTruthy();
    expect(container.querySelector('[class*="paneHeader"]')).toBeTruthy();
    expect(container.querySelector('[class*="messageScroll"]')).toBeTruthy();
    expect(container.querySelector('[class*="composerBox"]')).toBeTruthy();

    // Both message sides are represented (mine + theirs), not one uniform column.
    expect(container.querySelectorAll('[class*="messageGroupMine"]').length).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('[class*="messageGroup"]:not([class*="messageGroupMine"])')
        .length,
    ).toBeGreaterThan(0);

    expect(screen.queryByText(/loading conversation\.\.\./iu)).toBeNull();
    expect(container.textContent).not.toMatch(/spinner|loading messages/iu);
  });

  it("does not render the skeleton once a real detail is provided", () => {
    renderLoadingPane({ loading: false });
    expect(screen.queryByRole("status", { name: "Conversation" })).toBeNull();
  });
});

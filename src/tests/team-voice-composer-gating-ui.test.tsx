/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import {
  groupTeamMessages,
  type TeamConversationDetailView,
  type TeamMessageView,
} from "../domain/team/projections";
import { TeamConversationPane } from "../components/team/team-conversation-view";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// See team-conversation-pane-pin.test.tsx: TeamConversationPane's own
// auto-scroll effect calls Element.scrollTo, which jsdom doesn't implement.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
}

// The mic control's own visibility gate (browser support) is orthogonal to
// the Owner/Admin capability gate this file tests, so recording APIs are
// stubbed as present in every case here.
function stubMediaRecordingSupport() {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [], getAudioTracks: () => [] }) },
  });
}

const CONVERSATION = "11111111-1111-4111-8111-111111111111";

const MESSAGE: TeamMessageView = {
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
};

function detail(canSendVoice: boolean | undefined): TeamConversationDetailView {
  const messages = [MESSAGE];
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
      isOwner: canSendVoice ?? false,
      canCreateTask: true,
      canManageMembers: false,
      canManageAdmins: false,
      canManageSlowMode: false,
      canRenameConversation: false,
      canManageTaskPolicy: false,
      canSendVoice,
    },
    slowModeSeconds: null,
    slowModeScope: "members_only",
    taskCreationPolicy: "everyone",
    myNextAllowedSendAt: null,
  };
}

function renderPane(canSendVoice: boolean | undefined) {
  const props: ComponentProps<typeof TeamConversationPane> = {
    detail: detail(canSendVoice),
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
  };
  render(<TeamConversationPane {...props} />);
}

describe("Voice control composer gating", () => {
  it("gives Owner/Admin (canSendVoice) the microphone control in the composer", () => {
    stubMediaRecordingSupport();
    renderPane(true);
    expect(screen.getByRole("button", { name: "Record voice message" })).toBeInTheDocument();
    // Normal text messaging stays fully usable alongside it.
    expect(screen.getByRole("button", { name: "Task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("gives a regular member (canSendVoice undefined) no microphone control", () => {
    stubMediaRecordingSupport();
    renderPane(undefined);
    expect(screen.queryByRole("button", { name: "Record voice message" })).not.toBeInTheDocument();
    // Text messaging is unaffected by the absence of voice.
    expect(screen.getByRole("button", { name: "Task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("keeps composer order as Task, Microphone, Send", () => {
    stubMediaRecordingSupport();
    renderPane(true);
    const row = screen.getByRole("button", { name: "Record voice message" }).closest("[class*='composerRow']");
    expect(row).not.toBeNull();
    const labels = Array.from(row!.querySelectorAll("button"))
      .map((button) => button.getAttribute("aria-label") ?? button.textContent)
      .filter((label): label is string => Boolean(label));
    const taskIndex = labels.findIndex((label) => label.includes("Task") || label === "Task");
    const micIndex = labels.indexOf("Record voice message");
    const sendIndex = labels.indexOf("Send message");
    expect(taskIndex).toBeGreaterThanOrEqual(0);
    expect(taskIndex).toBeLessThan(micIndex);
    expect(micIndex).toBeLessThan(sendIndex);
  });
});

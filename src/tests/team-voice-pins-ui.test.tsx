/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { TeamMessagePinView, TeamMessageView } from "../domain/team/projections";
import { TeamMessageActions } from "../components/team/team-message-actions";
import { TeamPinsPanel } from "../components/team/team-pins-panel";

afterEach(cleanup);

const CONVERSATION = "10000000-0000-4000-8000-000000000001";
const MESSAGE = "20000000-0000-4000-8000-000000000001";

const message: TeamMessageView = {
  id: MESSAGE, requestId: null, conversationId: CONVERSATION,
  authorProfileId: "30000000-0000-4000-8000-000000000001", authorName: "Avery Admin",
  authorAvatarUrl: null, authorInitials: "AA", body: "Launch checklist is ready",
  messageType: "text", taskId: null, taskAction: null, createdAt: "2026-09-01T08:00:00.000Z",
  isMine: false, reactions: [], replyToMessageId: null, replyQuoteText: null,
  replySourceAuthorName: null, replySourceDeleted: false, forwardedFromMessageId: null,
  forwardedFromAuthorName: null, deletedForEveryone: false, voice: null,
};

const pin: TeamMessagePinView = {
  id: "40000000-0000-4000-8000-000000000001", conversationId: CONVERSATION,
  messageId: MESSAGE, authorProfileId: message.authorProfileId, authorName: message.authorName,
  textPreview: message.body, messageCreatedAt: message.createdAt, messageDeleted: false,
  pinnedByProfileId: message.authorProfileId, pinnedByName: "Avery Admin",
  pinnedAt: "2026-09-01T08:05:00.000Z", unpinnedByProfileId: null,
  unpinnedByName: null, unpinnedAt: null, active: true,
};

function actions(canManagePins: boolean, overrides: Partial<ComponentProps<typeof TeamMessageActions>> = {}) {
  render(<TeamMessageActions
    message={message} destinations={[]} canCreateTask={false} canManagePins={canManagePins}
    currentPin={null} onClose={vi.fn()} onCreateTask={vi.fn()}
    onForward={vi.fn().mockResolvedValue(null)} onDeleteForMe={vi.fn().mockResolvedValue(null)}
    onDeleteForEveryone={vi.fn().mockResolvedValue(null)} onPin={vi.fn().mockResolvedValue(null)}
    onUnpin={vi.fn().mockResolvedValue(null)} {...overrides}
  />);
}

describe("Team pin UI permissions", () => {
  it("does not offer pinning to an ordinary member", () => {
    actions(false);
    expect(screen.queryByRole("button", { name: "Pin" })).not.toBeInTheDocument();
  });

  it("offers pin and unpin only for supported text messages to a privileged viewer", () => {
    actions(true);
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
    cleanup();
    actions(true, { currentPin: pin });
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
    cleanup();
    actions(true, { message: { ...message, messageType: "voice", voice: { storagePath: "safe", durationMs: 1000, sizeBytes: 100, mimeType: "audio/webm", expiresAt: null, expiredAt: null } } });
    expect(screen.queryByRole("button", { name: "Pin" })).not.toBeInTheDocument();
  });
});

describe("Pinned messages surface", () => {
  it("shows current and previous history, jumps safely, and supports Escape", async () => {
    const onJump = vi.fn();
    const previous = { ...pin, id: "50000000-0000-4000-8000-000000000001", active: false, unpinnedAt: "2026-09-01T09:00:00.000Z", unpinnedByName: "Olivia Owner" };
    render(<TeamPinsPanel current={[pin]} previous={[previous]} canManage={false} onJump={onJump} onUnpin={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Pinned messages" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Pinned messages" })).toBeInTheDocument();
    expect(screen.getByText("Previous pins")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Launch checklist is ready")[0]!);
    expect(onJump).toHaveBeenCalledWith(MESSAGE);
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pinned messages" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("is read-only for members and exposes unpin to owner/admin", () => {
    const onUnpin = vi.fn().mockResolvedValue(null);
    const { rerender } = render(<TeamPinsPanel current={[pin]} previous={[]} canManage={false} onJump={vi.fn()} onUnpin={onUnpin} />);
    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    expect(screen.queryByRole("button", { name: "Unpin message" })).not.toBeInTheDocument();
    rerender(<TeamPinsPanel current={[pin]} previous={[]} canManage onJump={vi.fn()} onUnpin={onUnpin} />);
    expect(screen.getByRole("button", { name: "Unpin message" })).toBeInTheDocument();
  });

  it("marks the trigger active while open, and closes via the X control or an outside click", () => {
    render(<TeamPinsPanel current={[pin]} previous={[]} canManage={false} onJump={vi.fn()} onUnpin={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Pinned messages" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close pinned messages" }));
    expect(screen.queryByRole("dialog", { name: "Pinned messages" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Pinned messages" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Pinned messages" })).not.toBeInTheDocument();
  });

  it("shows a single compact empty state when nothing is pinned yet", () => {
    render(<TeamPinsPanel current={[]} previous={[]} canManage={false} onJump={vi.fn()} onUnpin={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    expect(screen.getByText("No messages pinned yet.")).toBeInTheDocument();
    expect(screen.queryByText("Previous pins")).not.toBeInTheDocument();
  });

  it("clamps the popover so it stays within the conversation container's right edge", () => {
    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect");
    rectSpy.mockImplementation(function (this: Element) {
      if (this.tagName === "BUTTON") {
        return { left: 900, right: 930, top: 40, bottom: 70, width: 30, height: 30, x: 900, y: 40, toJSON() {} } as DOMRect;
      }
      return { left: 0, right: 960, top: 0, bottom: 800, width: 960, height: 800, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    const host = document.createElement("div");
    host.setAttribute("data-team-region", "message-thread");
    document.body.appendChild(host);

    render(<TeamPinsPanel current={[pin]} previous={[]} canManage={false} onJump={vi.fn()} onUnpin={vi.fn()} />, { container: host });
    fireEvent.click(screen.getByRole("button", { name: "Pinned messages" }));
    const dialog = screen.getByRole("dialog", { name: "Pinned messages" });
    const left = dialog.style.getPropertyValue("--pins-left");
    expect(parseFloat(left)).toBeLessThan(0);

    rectSpy.mockRestore();
    host.remove();
  });
});

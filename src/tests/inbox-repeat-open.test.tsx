// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeamMessagesDrawer } from "../components/team/team-messages-drawer";
vi.mock("../app/actions/team-messages");
vi.mock("../app/actions/tickets");
vi.mock("../components/team/use-team-sync-controller", () => ({ useTeamSyncController: () => ({ refreshNow: vi.fn() }) }));
vi.mock("../components/team/use-ticket-inbox-list", () => ({ useTicketInboxList: () => ({ tickets: [], error: null, unavailable: false, refreshNow: vi.fn() }) }));
function Harness() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open Inbox</button>
    <TeamMessagesDrawer open={open} onClose={() => setOpen(false)} actorProfileId="10000000-0000-4000-8000-000000000001" actorName="Synthetic Manager"
      canManageTasks={false} canUseTeamMessages={false} ticketCapabilities={{ view: false, create: false, reply: false, edit: false, assign: false, internalNotes: false, archive: false }}
      initialConversationId={null} initialTicketId={null} onUnreadChange={() => {}} onRequestOpen={() => setOpen(true)} />
  </>;
}
beforeEach(() => { vi.useFakeTimers(); document.body.style.overflow = "auto"; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.style.overflow = ""; });
it("repeated open/Escape/close restores the lock and focus without requesting a page scroll", async () => {
  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "Open Inbox" });
  const focus = vi.spyOn(trigger, "focus");
  for (let n = 0; n < 3; n++) {
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getAllByRole("dialog", { name: "Inbox" })).toHaveLength(1);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { vi.advanceTimersByTime(210); });
    expect(screen.queryByRole("dialog", { name: "Inbox" })).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  }
});
it("reopening during the closing animation keeps one overlay and releases its lock on unmount", async () => {
  const view = render(<Harness />);
  const trigger = screen.getByRole("button", { name: "Open Inbox" });
  trigger.focus(); fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(trigger);
  await act(async () => { vi.advanceTimersByTime(210); });
  expect(screen.getAllByRole("dialog", { name: "Inbox" })).toHaveLength(1);
  expect(document.body.style.overflow).toBe("hidden");
  view.unmount();
  expect(document.body.style.overflow).toBe("auto");
});

/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClientNotificationBell } from "../components/account/client-notification-bell";
import { WorkspaceCommandBar } from "../components/shell/workspace-command-bar";
import { notifyTicketAccessUnavailable } from "../components/tickets/ticket-access-boundary";

const getClientNotificationsAction = vi.hoisted(() => vi.fn());
const getWalletNotificationsAction = vi.hoisted(() => vi.fn());

vi.mock("../app/actions/notifications", () => ({
  getClientNotificationsAction,
  getWalletNotificationsAction,
}));
vi.mock("../lib/notifications/browser-notification-feedback", () => ({
  unlockNotificationAudio: vi.fn().mockResolvedValue(undefined),
  playNotificationChime: vi.fn(),
}));
vi.mock("../components/team/use-team-messages-chat", () => ({ useTeamMessagesChat: () => ({}) }));
vi.mock("../components/team/team-messages-trigger", () => ({ TeamMessagesTrigger: () => null }));
vi.mock("../components/team/mobile-team-messages-lever", () => ({ MobileTeamMessagesLever: () => null }));
vi.mock("../components/shell/global-search", () => ({ GlobalSearch: () => null }));
vi.mock("../components/dashboard/dashboard-date-trigger", () => ({ DashboardDateTrigger: () => null }));
vi.mock("../components/shell/workspace-quick-action", () => ({ WorkspaceQuickAction: () => null }));
vi.mock("../components/shell/account-menu", () => ({ AccountMenu: () => null }));

beforeEach(() => {
  vi.useFakeTimers();
  getClientNotificationsAction.mockReset();
  getWalletNotificationsAction.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "hidden");
});

const bells = [
  {
    name: "client",
    action: getClientNotificationsAction,
    renderBell: () => render(<ClientNotificationBell />),
  },
  {
    name: "internal",
    action: getWalletNotificationsAction,
    renderBell: () => render(<WorkspaceCommandBar user={{} as Parameters<typeof WorkspaceCommandBar>[0]["user"]} />),
  },
];

for (const bell of bells) {
  it(`${bell.name} bell invalidates Ticket cache on domain denial and ignores Ticket rows from a pre-denial response`, async () => {
    const base = { companyId: null, body: "Cached history", reason: null, createdAt: "2026-10-10T12:00:00Z", href: "/account", kind: "credit", audience: "client", readAt: null };
    const response = { ok: true, notifications: [
      { ...base, id: "protected", category: "ticket", title: "Protected delayed Ticket" },
      { ...base, id: "receipt", category: "payment", title: "Independent cached receipt" },
    ] };
    bell.action.mockResolvedValue(response);
    const user = { modules: { tickets: true, projects: true }, tickets: { view: true } } as unknown as Parameters<typeof WorkspaceCommandBar>[0]["user"];
    const view = render(bell.name === "client" ? <ClientNotificationBell /> : <WorkspaceCommandBar user={user} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Notifications" })); });
    let resolve!: (value: typeof response) => void;
    bell.action.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    act(() => notifyTicketAccessUnavailable("protected-ticket"));
    expect(view.queryByText("Protected delayed Ticket")).toBeNull();
    expect(view.getByText("Independent cached receipt")).toBeTruthy();
    await act(async () => { resolve(response); });
    expect(view.queryByText("Protected delayed Ticket")).toBeNull();
    expect(view.getByLabelText("1 unread notifications")).toBeTruthy();
  });
  it(`${bell.name} bell hides cached Ticket entities and counts while a refresh is stalled, preserving independent notifications`, async () => {
    const base = { companyId: null, body: "Independent history", reason: null, createdAt: "2026-10-10T12:00:00Z", href: "/account", kind: "credit", audience: "client", readAt: null };
    bell.action.mockResolvedValue({ ok: true, notifications: [
      { ...base, id: "t1", category: "ticket", title: "Protected Ticket title" },
      { ...base, id: "t2", category: "store", entityType: "ticket", title: "Protected alternate category" },
      { ...base, id: "p1", category: "payment", title: "Independent financial receipt" },
      { ...base, id: "i1", category: "store", entityType: "service_interest", title: "Independent Intent history" },
      { ...base, id: "o1", category: "payment", entityType: "order", title: "Protected Project activity" },
      { ...base, id: "ot1", category: "project", entityType: "order_task", title: "Protected Project task" },
      { ...base, id: "tm1", category: "team", entityType: "team_message", title: "Independent Team forward" },
    ] });
    const user = (available: boolean) => ({ modules: { tickets: available, projects: available }, tickets: { view: available } }) as unknown as Parameters<typeof WorkspaceCommandBar>[0]["user"];
    const element = (available: boolean) => bell.name === "client"
      ? <ClientNotificationBell ticketsAvailable={available} projectsAvailable={available} />
      : <WorkspaceCommandBar user={user(available)} />;
    const view = render(element(true));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Notifications" })); });
    expect(view.getByText("Protected Ticket title")).toBeTruthy();
    expect(view.getByLabelText("7 unread notifications")).toBeTruthy();
    bell.action.mockImplementation(() => new Promise(() => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    view.rerender(element(false));
    expect(view.queryByText("Protected Ticket title")).toBeNull();
    expect(view.queryByText("Protected alternate category")).toBeNull();
    expect(view.queryByText("Protected Project activity")).toBeNull();
    expect(view.queryByText("Protected Project task")).toBeNull();
    expect(view.getByText("Independent financial receipt")).toBeTruthy();
    expect(view.getByText("Independent Intent history")).toBeTruthy();
    expect(view.getByText("Independent Team forward")).toBeTruthy();
    expect(view.getByLabelText("3 unread notifications")).toBeTruthy();
  });
  it(`${bell.name} bell skips overlap and hidden replay, then resumes on visibility and interval`, async () => {
    const result = { ok: true, notifications: [] };
    let resolveFirst!: (value: typeof result) => void;
    bell.action
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(result);

    bell.renderBell();
    await act(async () => { await Promise.resolve(); });
    expect(bell.action).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(bell.action).toHaveBeenCalledTimes(1);

    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(bell.action).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { resolveFirst(result); await Promise.resolve(); });
    expect(bell.action).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(bell.action).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(bell.action).toHaveBeenCalledTimes(3);
  });

  it(`${bell.name} bell coalesces an open during an in-flight request`, async () => {
    const result = { ok: true, notifications: [] };
    let resolveFirst!: (value: typeof result) => void;
    bell.action
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(result);

    const view = bell.renderBell();
    await act(async () => { await Promise.resolve(); });
    expect(bell.action).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Notifications" })); });
    expect(bell.action).toHaveBeenCalledTimes(1);

    await act(async () => { resolveFirst(result); await Promise.resolve(); });
    expect(bell.action).toHaveBeenCalledTimes(2);
  });

  it(`${bell.name} bell polls again after a rejected request`, async () => {
    const result = { ok: true, notifications: [] };
    let rejectFirst!: (reason: Error) => void;
    bell.action
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValue(result);

    const view = bell.renderBell();
    await act(async () => { await Promise.resolve(); });
    expect(bell.action).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Notifications" })); });
    expect(bell.action).toHaveBeenCalledTimes(1);

    await act(async () => { rejectFirst(new Error("network failed")); await Promise.resolve(); });
    expect(bell.action).toHaveBeenCalledTimes(2);
    expect(view.queryByText("Refreshing...")).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(bell.action).toHaveBeenCalledTimes(3);
  });
}

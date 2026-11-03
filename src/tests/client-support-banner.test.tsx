// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientSupportBanner } from "../components/account/client-support-banner";
import type { ClientSupportProof } from "../domain/auth/client-support";

const mocks = vi.hoisted(() => ({ router: { replace: vi.fn() }, end: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("../app/actions/client-support", () => ({ endClientSupportAction: mocks.end }));

const now = new Date("2026-10-31T00:00:00Z");
const support: ClientSupportProof = {
  id: "10000000-0000-4000-8000-000000000001",
  administratorId: "10000000-0000-4000-8000-000000000002",
  clientId: "10000000-0000-4000-8000-000000000003",
  tenantId: "10000000-0000-4000-8000-000000000004",
  companyId: "10000000-0000-4000-8000-000000000005",
  email: "client@example.test",
  displayName: "Synthetic Client",
  companyName: "Synthetic Company",
  expiresAt: new Date(now.getTime() + 15_000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("compact client-support return control", () => {
  it("keeps the client identity visible beside a native return submit control", () => {
    render(<ClientSupportBanner support={support} />);
    expect(screen.getByLabelText("Client support session").textContent).toContain("Client view · Synthetic Client");
    const button = screen.getByRole("button", { name: "Back to admin account" });
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.closest("form")).not.toBeNull();
    expect(screen.queryByText(/Actions are recorded/)).toBeNull();
  });

  it("uses the existing server action to end the support session", async () => {
    render(<ClientSupportBanner support={support} />);
    const button = screen.getByRole("button", { name: "Back to admin account" });
    await act(async () => { fireEvent.submit(button.closest("form")!); });
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("retains the expiry redirect without leaving the support session active indefinitely", () => {
    render(<ClientSupportBanner support={support} />);
    act(() => { vi.advanceTimersByTime(14_999); });
    expect(mocks.router.replace).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/client-support/exit");
  });

  it("replaces the old expiry timer when the server supplies an updated expiry", () => {
    const view = render(<ClientSupportBanner support={support} />);
    view.rerender(<ClientSupportBanner support={{ ...support, expiresAt: new Date(now.getTime() + 30_000).toISOString() }} />);
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(mocks.router.replace).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/client-support/exit");
  });

  it("cleans up the expiry timer when leaving the client layout", () => {
    const view = render(<ClientSupportBanner support={support} />);
    view.unmount();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("routes an already expired session through the existing exit reconciliation", () => {
    render(<ClientSupportBanner support={{ ...support, expiresAt: new Date(now.getTime() - 1).toISOString() }} />);
    act(() => { vi.advanceTimersByTime(0); });
    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/client-support/exit");
  });

  it("keeps an explicit client-view indicator when the display name is unavailable", () => {
    render(<ClientSupportBanner support={{ ...support, displayName: null }} />);
    expect(screen.getByLabelText("Client support session").textContent).toContain("Client view · client");
  });
});

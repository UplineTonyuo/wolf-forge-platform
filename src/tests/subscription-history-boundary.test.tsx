/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { SubscriptionHistoryBoundary } from "../components/subscriptions/subscription-history-boundary";

const mocks = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn() }));
vi.mock("../app/actions/subscriptions", () => ({ loadSubscriptionVisibilityAction: mocks.read }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("removes protected history and controls on current denial", async () => {
  mocks.read.mockResolvedValue({ ok: false, denied: true });
  render(<SubscriptionHistoryBoundary ids={["a"]} audience="client"><h1>Private plan</h1><button>Resume</button></SubscriptionHistoryBoundary>);
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(screen.queryByText("Private plan")).not.toBeInTheDocument();
  expect(screen.queryByText("Resume")).not.toBeInTheDocument();
  expect(mocks.refresh).toHaveBeenCalled();
});
it("removes rows that RLS no longer returns", async () => {
  mocks.read.mockResolvedValue({ ok: true, ids: [] });
  render(<SubscriptionHistoryBoundary ids={["a"]} audience="internal">Company history</SubscriptionHistoryBoundary>);
  await waitFor(() => expect(screen.queryByText("Company history")).not.toBeInTheDocument());
});
it("preserves history on transient failures", async () => {
  mocks.read.mockResolvedValue({ ok: false, denied: false });
  render(<SubscriptionHistoryBoundary ids={["a"]} audience="client">Retryable history</SubscriptionHistoryBoundary>);
  await waitFor(() => expect(mocks.read).toHaveBeenCalled());
  expect(screen.getByText("Retryable history")).toBeInTheDocument();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("refreshes same-ID status changes before exposing stale controls", async () => {
  mocks.read.mockResolvedValue({ ok: true, ids: ["a"], states: ["a:canceled"], workEnabled: false });
  render(<SubscriptionHistoryBoundary ids={["a"]} states={["a:active"]} workEnabled audience="internal"><button>New Subscription</button></SubscriptionHistoryBoundary>);
  await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  expect(screen.queryByText("New Subscription")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("preserves authorized canceled history after StrictMode remount", async () => {
  mocks.read.mockResolvedValue({ ok: true, ids: ["a"] });
  render(<StrictMode><SubscriptionHistoryBoundary ids={["a"]} audience="client">Canceled history</SubscriptionHistoryBoundary></StrictMode>);
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  expect(screen.getByText("Canceled history")).toBeInTheDocument();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

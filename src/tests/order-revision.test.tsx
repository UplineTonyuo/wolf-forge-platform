// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ClientFeedback, readClientFeedback } from "../components/settings/client-feedback";
import OrderHistoryPage from "../app/(internal)/orders/[orderId]/history/page";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), timeline: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../lib/supabase/next-server", () => ({
  getClientContext: async () => ({ actor: {support: false}, client: {rpc: mocks.rpc} }),
  getInternalContext: async () => ({ services: {
    activity: {listTimeline: mocks.timeline},
    catalog: {listAssignees: async () => []},
  } }),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const orderId = "da215000-0000-4000-8000-000000000001";
const completedAt = "2026-11-19T12:00:00.123456+00:00";
const state = {lock: true, reopen: true, ratings: false, score: null, completed_at: completedAt};

it("retries the same revision against the exact completion the client saw", async () => {
  mocks.rpc.mockResolvedValueOnce({data: state})
    .mockRejectedValueOnce(new Error("Response interrupted"))
    .mockResolvedValueOnce({data: {revision_id: orderId, destination: "waiting_reply"}});
  const feedback = await readClientFeedback("orders", orderId);
  render(<ClientFeedback section="orders" target={orderId} state={feedback}/>);
  fireEvent.change(screen.getByLabelText("What needs revision?"), {target: {value: "Change the headline"}});
  fireEvent.click(screen.getByRole("button", {name: "Request revision"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Try submitting it again");
  expect(screen.getByLabelText("What needs revision?")).toHaveValue("Change the headline");
  fireEvent.click(screen.getByRole("button", {name: "Request revision"}));
  expect(await screen.findByRole("status")).toHaveTextContent("Revision requested");
  const first = mocks.rpc.mock.calls[1];
  expect(first).toEqual(["app_request_order_revision", {
    p_order: orderId, p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    p_reason: "Change the headline", p_expected_completed_at: completedAt,
  }]);
  expect(mocks.rpc.mock.calls[2]).toEqual(first);
});

it("shows a stale completion message and starts a fresh form for the next completion", async () => {
  mocks.rpc.mockResolvedValue({error: {code: "40001"}});
  const view = render(<ClientFeedback section="orders" target={orderId} state={state}/>);
  fireEvent.change(screen.getByLabelText("What needs revision?"), {target: {value: "Update the layout"}});
  fireEvent.click(screen.getByRole("button", {name: "Request revision"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("This order has changed");
  expect(mocks.revalidate).not.toHaveBeenCalled();
  view.rerender(<ClientFeedback section="orders" target={orderId} state={{...state, completed_at: "2026-11-20T05:00:00Z"}}/>);
  expect(screen.getByLabelText("What needs revision?")).toHaveValue("");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("renders the submitted revision reason in the staff order history", async () => {
  const reason = "Please change the <b>heading</b> and keep the image.";
  const event = {id: "1", action: "order.status_changed", actor_profile_id: null,
    created_at: completedAt, summary: "Client requested a revision."};
  mocks.timeline.mockResolvedValue([
    {...event, metadata: {revision_id: orderId, reason}},
    {...event, id: "2", action: "order.report_not_required", summary: "Recorded monthly report exception.",
      metadata: {reason: "Unrelated audit metadata"}},
  ]);
  render(await OrderHistoryPage({params: Promise.resolve({orderId})}));
  expect(mocks.timeline).toHaveBeenCalledWith("order", orderId);
  expect(screen.getByText(reason)).toBeVisible();
  expect(screen.queryByText("Unrelated audit metadata")).not.toBeInTheDocument();
});

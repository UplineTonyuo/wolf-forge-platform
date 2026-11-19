/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderHeaderControls } from "../components/projects/order-header-controls";

const refresh = vi.fn();
const assignProjectAction = vi.fn();
const changeProjectStatusAction = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../app/actions/orders", () => ({
  assignProjectAction: (...args: unknown[]) => assignProjectAction(...args),
  changeProjectStatusAction: (...args: unknown[]) => changeProjectStatusAction(...args),
  archiveProjectAction: vi.fn(),
}));

const orderId = "10000000-0000-4000-8000-000000000001";
const williamId = "20000000-0000-4000-8000-000000000001";
const qaId = "20000000-0000-4000-8000-000000000002";
const people = [
  { id: williamId, name: "WF William", avatarUrl: "https://example.com/william.jpg" },
  { id: qaId, name: "QA Local", avatarUrl: null },
];
const capabilities = { create: true, edit: true, assign: true, archive: true };
const completionRequirement = { orderId, companyId: "30000000-0000-4000-8000-000000000001", serviceId: "5f000000-0000-4000-8000-000000000318", serviceName: "GMB/GBP Management", reportingPeriodMonth: "2026-10-01", canRecordException: true };

function renderControls(assigneeId: string | null) {
  return render(
    <OrderHeaderControls
      orderId={orderId}
      status="working"
      assigneeId={assigneeId}
      people={people}
      capabilities={capabilities}
    />,
  );
}

beforeEach(() => {
  refresh.mockReset();
  assignProjectAction.mockReset();
  changeProjectStatusAction.mockReset();
  assignProjectAction.mockResolvedValue({ succeeded: [orderId], failed: [] });
});
afterEach(cleanup);

describe("Order header assignee avatars", () => {
  it.each(["Needs Review","Editorial review"])("resolves a reopened order to its current stage label %s",name=>{
    const key="de215000-0000-4000-8000-000000000001";
    render(<OrderHeaderControls orderId={orderId} assigneeId={null} people={people} capabilities={capabilities}
      status="working" customStage={key} stages={[{key,name,color:"#112233",description:"Review the revision"}]}/>);
    expect(screen.getByRole("button",{name:"Status: "+name})).toBeVisible();
  });

  it("shows the stored photo in the selected control and option while preserving the checkmark", () => {
    renderControls(williamId);
    const trigger = screen.getByRole("button", { name: "Assignee: WF William" });
    expect(trigger.querySelector("img")).toHaveAttribute("src", "https://example.com/william.jpg");

    fireEvent.click(trigger);
    const selected = screen.getByRole("option", { name: "WF William" });
    expect(selected.querySelector("img")).toHaveAttribute("src", "https://example.com/william.jpg");
    expect(selected.querySelector("svg")).toBeInTheDocument();
    expect(within(screen.getByRole("option", { name: "QA Local" })).getByText("QL")).toBeInTheDocument();
    expect(within(screen.getByRole("option", { name: "Unassigned" })).getByTestId("avatar-fallback")).toBeInTheDocument();
  });

  it("shows name-derived initials in the closed control when no photo exists", () => {
    renderControls(qaId);
    expect(within(screen.getByRole("button", { name: "Assignee: QA Local" })).getByText("QL")).toBeInTheDocument();
  });

  it("keeps Unassigned generic and preserves keyboard selection", async () => {
    renderControls(null);
    const trigger = screen.getByRole("button", { name: "Assignee: Unassigned" });
    expect(within(trigger).getByTestId("avatar-fallback")).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "End" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    await waitFor(() => expect(assignProjectAction).toHaveBeenCalledExactlyOnceWith(orderId, qaId));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("opens the report gate from the header status control", async () => {
    changeProjectStatusAction.mockResolvedValue({ attempted: 1, succeeded: [], failed: [{ id: orderId, label: "GMB order", completionRequirement }] });
    renderControls(null);
    fireEvent.click(screen.getByRole("button", { name: /^Status:/u }));
    fireEvent.click(screen.getByRole("option", { name: "Complete" }));
    expect(await screen.findByRole("dialog", { name: "Monthly report required" })).toHaveTextContent("October 2026");
    expect(changeProjectStatusAction).toHaveBeenCalledWith(orderId, "complete");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("opens the same gate from detail Actions and returns focus to its launcher", async () => {
    changeProjectStatusAction.mockResolvedValue({ attempted: 1, succeeded: [], failed: [{ id: orderId, label: "GMB order", completionRequirement }] });
    renderControls(null);
    const launcher = screen.getByRole("button", { name: "Open project actions" });
    fireEvent.click(launcher);
    fireEvent.click(await screen.findByRole("button", { name: /^Change status/u }));
    fireEvent.click(await screen.findByRole("button", { name: /^Complete/u }));
    await screen.findByRole("dialog", { name: "Monthly report required" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Monthly report required", hidden: true })).not.toBeInTheDocument());
    expect(launcher).toHaveFocus();
    expect(refresh).not.toHaveBeenCalled();
  });
});

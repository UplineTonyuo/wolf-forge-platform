/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OrderCompletionGate } from "../components/projects/order-completion-gate";
import { reportingServiceIds } from "../domain/reporting/service-profiles";

const exception = vi.hoisted(() => vi.fn());
vi.mock("../app/actions/orders", () => ({ completeProjectWithoutReportAction: exception }));
const scope = {
  orderId: "10000000-0000-4000-8000-000000000001", companyId: "10000000-0000-4000-8000-000000000002",
  serviceId: reportingServiceIds.gmbManagement, serviceName: "GMB/GBP Management",
  reportingPeriodMonth: "2026-10-01", canRecordException: true,
};
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("offers the exact month and a prefilled builder without completing anything", async () => {
  render(<OrderCompletionGate failures={[{ id: scope.orderId, label: "GMB order", completionRequirement: scope }]} onCompleted={vi.fn()} />);
  expect(await screen.findByRole("dialog")).toHaveTextContent("October 2026");
  const link = screen.getByRole("link", { name: "Create report" });
  expect(link).toHaveAttribute("href", expect.stringContaining("reportingPeriodMonth=2026-10-01"));
  expect(link).toHaveAttribute("href", expect.stringContaining(`serviceId=${scope.serviceId}`));
  expect(exception).not.toHaveBeenCalled();
});

it("requires a bounded reason and submits one exact order scope", async () => {
  const completed = vi.fn();
  exception.mockResolvedValue({ attempted: 1, succeeded: [{ id: scope.orderId, label: "GMB order" }], failed: [] });
  render(<OrderCompletionGate failures={[{ id: scope.orderId, label: "GMB order", completionRequirement: scope }]} onCompleted={completed} />);
  fireEvent.click(await screen.findByRole("button", { name: "Report not required" }));
  const reason = screen.getByRole("textbox", { name: "Reason" });
  expect(reason).toHaveAttribute("maxLength", "1000");
  fireEvent.change(reason, { target: { value: "  " } });
  expect(screen.getByRole("button", { name: "Record exception and complete" })).toBeDisabled();
  fireEvent.change(reason, { target: { value: "Client waived this month" } });
  fireEvent.click(screen.getByRole("button", { name: "Record exception and complete" }));
  await vi.waitFor(() => expect(completed).toHaveBeenCalledWith(scope.orderId));
  expect(exception).toHaveBeenCalledWith(scope.orderId, {
    serviceId: scope.serviceId, reportingPeriodMonth: "2026-10-01", reason: "Client waived this month",
  });
});

it("offers no exception for a caller without exception authority", async () => {
  render(<OrderCompletionGate failures={[{ id: scope.orderId, label: "GMB order", completionRequirement: { ...scope, canRecordException: false } }]} onCompleted={vi.fn()} />);
  await screen.findByRole("dialog");
  expect(screen.queryByRole("button", { name: "Report not required" })).not.toBeInTheDocument();
});

it("keeps the shared sheet mounted through its exit motion", async () => {
  render(<OrderCompletionGate failures={[{ id: scope.orderId, label: "GMB order", completionRequirement: scope }]} onCompleted={vi.fn()} />);
  await screen.findByRole("dialog");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();
  await vi.waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument());
});

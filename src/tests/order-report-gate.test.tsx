/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OrderCompletionGate } from "../components/projects/order-completion-gate";
import { reportingServiceIds } from "../domain/reporting/service-profiles";

const { exception, completeMonth } = vi.hoisted(() => ({ exception: vi.fn(), completeMonth: vi.fn() }));
vi.mock("../app/actions/orders", () => ({ completeProjectWithoutReportAction: exception, completeProjectForReportingMonthAction: completeMonth }));
const scope = {
  orderId: "10000000-0000-4000-8000-000000000001", companyId: "10000000-0000-4000-8000-000000000002",
  serviceId: reportingServiceIds.gmbManagement, serviceName: "GMB/GBP Management",
  reportingPeriodMonth: "2026-10-01", canRecordException: true,
};
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("requires an explicit work month and pre-fills November after an October start", async () => {
  const november = { ...scope, reportingPeriodMonth: "2026-11-01" };
  completeMonth.mockResolvedValue({ attempted: 1, succeeded: [], failed: [{ id: scope.orderId, label: "October-started order", completionRequirement: november, error: "Monthly report required" }] });
  render(<OrderCompletionGate failures={[{ id: scope.orderId, label: "October-started order", completionRequirement: { ...scope, reportingPeriodMonth: null } }]} onCompleted={vi.fn()} />);
  await screen.findByRole("dialog");
  expect(screen.getByLabelText("Month the work covers")).toHaveValue("");
  expect(screen.queryByRole("link", { name: "Create report" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check report and complete" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Month the work covers"), { target: { value: "2026-11" } });
  fireEvent.click(screen.getByRole("button", { name: "Check report and complete" }));
  await vi.waitFor(() => expect(completeMonth).toHaveBeenCalledWith(scope.orderId, { serviceId: scope.serviceId, reportingPeriodMonth: "2026-11-01" }));
  const link = await screen.findByRole("link", { name: "Create report" });
  expect(link).toHaveAttribute("href", expect.stringContaining("reportingPeriodMonth=2026-11-01"));
  fireEvent.click(screen.getByRole("button", { name: "Report not required" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "November waiver" } });
  exception.mockResolvedValue({ attempted: 1, succeeded: [], failed: [{ id: scope.orderId, error: "Denied" }] });
  fireEvent.click(screen.getByRole("button", { name: "Record exception and complete" }));
  await vi.waitFor(() => expect(exception).toHaveBeenCalledWith(scope.orderId, { serviceId: scope.serviceId, reportingPeriodMonth: "2026-11-01", reason: "November waiver" }));
});

it("keeps November prefill and exception scope when completing in December", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-15T12:00:00Z"));
  try {
    render(<OrderCompletionGate failures={[{ id: scope.orderId, label: "October-started order", completionRequirement: { ...scope, reportingPeriodMonth: "2026-11-01" } }]} onCompleted={vi.fn()} />);
    expect(await screen.findByRole("dialog")).toHaveTextContent("November 2026");
    expect(screen.getByRole("link", { name: "Create report" })).toHaveAttribute("href", expect.stringContaining("reportingPeriodMonth=2026-11-01"));
    fireEvent.click(screen.getByRole("button", { name: "Report not required" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "November waiver" } });
    exception.mockResolvedValue({ attempted: 1, succeeded: [], failed: [{ id: scope.orderId, error: "Denied" }] });
    fireEvent.click(screen.getByRole("button", { name: "Record exception and complete" }));
    await vi.waitFor(() => expect(exception).toHaveBeenCalledWith(scope.orderId, { serviceId: scope.serviceId, reportingPeriodMonth: "2026-11-01", reason: "November waiver" }));
  } finally { vi.useRealTimers(); }
});

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

it("requires a changed work month to be confirmed before building or recording an exception", async () => {
  render(<OrderCompletionGate failures={[{ id: scope.orderId, label: "November work", completionRequirement: { ...scope, reportingPeriodMonth: "2026-11-01" } }]} onCompleted={vi.fn()} />);
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Report not required" }));
  fireEvent.change(screen.getByLabelText("Month the work covers"), { target: { value: "2026-10" } });
  expect(screen.queryByRole("link", { name: "Create report" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Record exception and complete" })).not.toBeInTheDocument();
  expect(exception).not.toHaveBeenCalled();
});

it("keeps the shared sheet mounted through its exit motion", async () => {
  render(<OrderCompletionGate failures={[{ id: scope.orderId, label: "GMB order", completionRequirement: scope }]} onCompleted={vi.fn()} />);
  await screen.findByRole("dialog");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();
  await vi.waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument());
});

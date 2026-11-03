// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectTasks } from "../components/projects/project-tasks";
const mocks = vi.hoisted(() => ({ manage: vi.fn(), refresh: vi.fn() }));
vi.mock("../app/actions/project-tasks", () => ({ manageProjectTaskAction: mocks.manage }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const props = { orderId: "10000000-0000-4000-8000-000000000001", tasks: [], people: [], capabilities: { create: false, edit: true, assign: true, archive: false } };
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
it("creates a nonblank task, preserves the request on failure, and refreshes after retry", async () => {
  mocks.manage.mockResolvedValueOnce({ ok: false, error: "Try again" }).mockResolvedValue({ ok: true });
  render(<ProjectTasks {...props} />);
  const input = screen.getByRole("textbox", { name: "New task title" });
  fireEvent.change(input, { target: { value: "  Review delivery  " } });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Try again");
  expect((input as HTMLInputElement).value).toBe("  Review delivery  ");
  // The error may paint before React finishes the transition. A real user can
  // retry only after the submit button is enabled again.
  await waitFor(() => expect((screen.getByRole("button", { name: "Add task" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  expect(mocks.manage.mock.calls[0]).toEqual(mocks.manage.mock.calls[1]);
  expect(mocks.manage.mock.calls[0]![1]).toMatchObject({ kind: "create", title: "Review delivery" });
  expect((input as HTMLInputElement).value).toBe("");
});
it("blocks whitespace submissions even if the form submit event is dispatched directly", () => {
  render(<ProjectTasks {...props} />);
  const input = screen.getByRole("textbox", { name: "New task title" });
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.submit(input.closest("form")!);
  expect(mocks.manage).not.toHaveBeenCalled();
});
it("turns a thrown action failure into a retryable error and retains the title", async () => {
  mocks.manage.mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue({ ok: true });
  render(<ProjectTasks {...props} />);
  const input = screen.getByRole("textbox", { name: "New task title" });
  fireEvent.change(input, { target: { value: "Review delivery" } });
  fireEvent.submit(input.closest("form")!);
  expect((await screen.findByRole("alert")).textContent).toMatch(/retry/i);
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  expect(mocks.manage.mock.calls[0]).toEqual(mocks.manage.mock.calls[1]);
});
it("does not submit twice while the first request is pending", async () => {
  let finish!: (value: { ok: true }) => void;
  mocks.manage.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<ProjectTasks {...props} />);
  const input = screen.getByRole("textbox", { name: "New task title" });
  fireEvent.change(input, { target: { value: "Review delivery" } });
  fireEvent.submit(input.closest("form")!);
  fireEvent.submit(input.closest("form")!);
  expect(mocks.manage).toHaveBeenCalledOnce();
  finish({ ok: true });
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
});

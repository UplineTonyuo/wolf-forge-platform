// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderTeamNote } from "../components/projects/order-team-note";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../app/actions/orders", () => ({ updateOrderNoteAction: mocks.save }));
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);
function edit(text = "Draft note") {
  fireEvent.click(screen.getByRole("button", { name: /Edit|Add a note/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Private note for your team" }), { target: { value: text } });
}

describe("team note editor", () => {
  it("renders an empty note and read-only existing note without edit controls", () => {
    const view = render(<OrderTeamNote orderId="one" note={null} canEdit={false} />);
    expect(screen.getByText("Add a note for your team…")).toBeVisible(); expect(screen.queryByRole("button")).toBeNull();
    view.rerender(<OrderTeamNote orderId="one" note="Private saved note" canEdit={false} />);
    expect(screen.getByText("Private saved note")).toBeVisible();
  });
  it("cancel restores the saved note and focus without saving", () => {
    render(<OrderTeamNote orderId="one" note="Saved note" canEdit />); edit();
    expect(screen.getByRole("textbox")).toHaveFocus(); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Saved note")).toBeVisible(); expect(mocks.save).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
    edit(); expect(screen.getByRole("textbox")).toHaveValue("Draft note");
  });
  it("retains text after a failed save and permits retry, then shows pending and saved states", async () => {
    let resolve!: (value: { ok: true; notes: string }) => void;
    mocks.save.mockResolvedValueOnce({ ok: false, error: "Save denied" }).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<OrderTeamNote orderId="one" note={null} canEdit />); edit(); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save denied"); expect(screen.getByRole("textbox")).toHaveValue("Draft note");
    const retry = await screen.findByRole("button", { name: "Save" });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry); expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => resolve({ ok: true, notes: "Draft note" }));
    expect(screen.getByRole("status")).toHaveTextContent("Note saved."); expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus(); expect(mocks.save).toHaveBeenCalledWith("one", "Draft note");
  });
  it("retains drafts on transport failure and unrelated refreshed props", async () => {
    mocks.save.mockRejectedValue(new Error("network"));
    const view = render(<OrderTeamNote orderId="one" note="Saved" canEdit />); edit();
    view.rerender(<OrderTeamNote orderId="one" note="Refreshed saved note" canEdit />);
    expect(screen.getByRole("textbox")).toHaveValue("Draft note");
    fireEvent.click(screen.getByRole("button", { name: "Save" })); await screen.findByRole("alert"); expect(screen.getByRole("textbox")).toHaveValue("Draft note");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(screen.getByText("Refreshed saved note")).toBeVisible();
  });
  it("supports clearing a note", async () => {
    mocks.save.mockResolvedValue({ ok: true, notes: null }); render(<OrderTeamNote orderId="one" note="Saved" canEdit />); edit("");
    fireEvent.click(screen.getByRole("button", { name: "Save" })); await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(mocks.save).toHaveBeenCalledWith("one", ""); expect(screen.getByText("Add a note for your team…")).toBeVisible();
  });
  it("ignores a stale save after edit authority is revoked", async () => {
    let resolve!: (value: { ok: true; notes: string }) => void;
    mocks.save.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<OrderTeamNote orderId="one" note="Saved" canEdit />); edit(); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    view.rerender(<OrderTeamNote orderId="one" note="Saved" canEdit={false} />);
    await act(async () => resolve({ ok: true, notes: "Late secret draft" }));
    expect(screen.queryByText("Late secret draft")).toBeNull(); expect(screen.queryByRole("button")).toBeNull(); expect(screen.getByText("Saved")).toBeVisible();
  });
  it("does not deliver a late result into another Order", async () => {
    let resolve!: (value: { ok: true; notes: string }) => void;
    mocks.save.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<OrderTeamNote key="one" orderId="one" note={null} canEdit />); edit(); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    view.rerender(<OrderTeamNote key="two" orderId="two" note="Other order note" canEdit />);
    await act(async () => resolve({ ok: true, notes: "Late first-order note" }));
    expect(screen.getByText("Other order note")).toBeVisible(); expect(screen.queryByText("Late first-order note")).toBeNull();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubmittedFile } from "../components/forms/submitted-file";

const mocks = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("../app/actions/intake-files", () => ({ loadIntakeFileInfo: mocks.info }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("authorized submitted files", () => {
  it("waits for authorized metadata before showing a filename/download, never visible IDs", async () => {
    let resolve!: (result: unknown) => void;
    mocks.info.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<SubmittedFile id="synthetic-file-id" />);
    expect(screen.queryByRole("link")).toBeNull(); expect(view.container).not.toHaveTextContent("synthetic-file-id");
    await act(async () => resolve({ ok: true, file: { name: "Synthetic brief.pdf" } }));
    expect(screen.getByRole("link", { name: "Synthetic brief.pdf" })).toHaveAttribute("href", "/api/intake-files/synthetic-file-id");
  });
  it("shows denied and network failure states without granting a link", async () => {
    mocks.info.mockResolvedValueOnce({ ok: false, error: "Unavailable attachment" }).mockRejectedValueOnce(new Error("network"));
    const view = render(<SubmittedFile id="denied" />); expect(await screen.findByText("Unavailable attachment")).toBeVisible(); expect(screen.queryByRole("link")).toBeNull();
    view.rerender(<SubmittedFile id="failed" />); expect(await screen.findByText(/Reload and try again/)).toBeVisible(); expect(screen.queryByRole("link")).toBeNull();
  });
  it("drops an old file response after the file identity changes", async () => {
    let resolve!: (result: unknown) => void;
    mocks.info.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValueOnce({ ok: true, file: { name: "Current.txt" } });
    const view = render(<SubmittedFile id="old" />); view.rerender(<SubmittedFile id="current" />);
    await screen.findByRole("link", { name: "Current.txt" });
    await act(async () => resolve({ ok: true, file: { name: "Old.txt" } }));
    expect(screen.queryByText("Old.txt")).toBeNull(); expect(screen.getByRole("link")).toHaveAttribute("href", "/api/intake-files/current");
  });
});

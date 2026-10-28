// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadFormPdf } from "../components/forms/download-form-pdf";
const id = "20000000-0000-4000-8000-000000000001";
let fetcher: ReturnType<typeof vi.fn>;
let clicked: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetcher = vi.fn().mockResolvedValue(new Response(new Blob(["%PDF-1.7 synthetic"]), { headers: { "content-type": "application/pdf" } }));
  vi.stubGlobal("fetch", fetcher); vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:synthetic-pdf"), revokeObjectURL: vi.fn() }));
  clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("PDF download after form submission", () => {
  it("automatically downloads once, including Strict Mode effect cleanup and rerender", async () => {
    const view = render(<StrictMode><DownloadFormPdf submissionId={id} automatic /></StrictMode>);
    await waitFor(() => expect(clicked).toHaveBeenCalledOnce());
    view.rerender(<StrictMode><DownloadFormPdf submissionId={id} automatic /></StrictMode>);
    expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/form-submissions/${id}/pdf`);
  });
  it("offers another copy without automatically downloading a historical receipt", async () => {
    render(<DownloadFormPdf submissionId={id} />);expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));await waitFor(() => expect(clicked).toHaveBeenCalledOnce());
  });
  it("retains the saved form and allows a retry if PDF generation fails", async () => {
    fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    render(<DownloadFormPdf submissionId={id} automatic />);await screen.findByRole("alert");expect(clicked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));await waitFor(() => expect(clicked).toHaveBeenCalledOnce());expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("refuses login HTML and asks for sign-in on session expiry", async () => {
    fetcher.mockResolvedValue(new Response("login", { status: 401 }));render(<DownloadFormPdf submissionId={id} automatic />);
    expect((await screen.findByRole("alert")).textContent).toContain("Sign in again");expect(clicked).not.toHaveBeenCalled();
  });
  it("does not save a successful HTML response as a fake PDF", async () => {
    fetcher.mockResolvedValue(new Response("<html>login</html>", { headers: { "content-type": "text/html" } }));
    render(<DownloadFormPdf submissionId={id} automatic />);await screen.findByRole("alert");expect(clicked).not.toHaveBeenCalled();
  });
});

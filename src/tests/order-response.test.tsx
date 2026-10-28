// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { OrderResponse } from "../components/projects/order-response";
import { SubmittedAnswer } from "../components/forms/submitted-answer";
import { visibleSubmittedFields } from "../lib/forms/submitted-fields";
import { answer, response } from "./fixtures/order-response";

vi.mock("../app/actions/intake-files", () => ({ loadIntakeFileInfo: vi.fn() }));
afterEach(cleanup);

describe("read-only submitted answers", () => {
  it("presents primitives, arrays and blanks without JSON", () => {
    const view = render(<SubmittedAnswer field={answer(false)} />); expect(screen.getByText("No")).toBeVisible();
    view.rerender(<SubmittedAnswer field={answer(true)} />); expect(screen.getByText("Yes")).toBeVisible();
    view.rerender(<SubmittedAnswer field={answer(["First", 4])} />); expect(screen.getAllByRole("listitem")).toHaveLength(2);
    for (const value of [null, "", []]) { view.rerender(<SubmittedAnswer field={answer(value)} />); expect(screen.getByText("Not answered")).toBeVisible(); }
    view.rerender(<SubmittedAnswer field={answer({ dangerous: "opaque" })} />); expect(screen.getByText("Response unavailable")).toBeVisible(); expect(view.container).not.toHaveTextContent("opaque");
  });
  it("uses validated ink and signer/consent/date, preserves typed history, rejects injected drawings", () => {
    const value = { name: "Synthetic signer", consent: true, signed_at: "2026-10-28T10:00:00Z", drawing: [[[1, 2], [30, 40]]] };
    const view = render(<SubmittedAnswer field={answer(value, "signature")} />);
    expect(screen.getByRole("img", { name: "Submitted client signature" })).toBeVisible();
    expect(screen.getByText("Synthetic signer")).toBeVisible(); expect(screen.getByText(/consent recorded/)).toBeVisible(); expect(view.container.querySelector("time")).toHaveAttribute("dateTime", value.signed_at);
    view.rerender(<SubmittedAnswer field={answer({ ...value, signed_at: "invalid", drawing: "<svg onload=alert(1)>" }, "signature")} />);
    expect(view.container.querySelector("svg")).toBeNull(); expect(view.container).not.toHaveTextContent("onload"); expect(screen.getByText("Signature drawing unavailable")).toBeVisible();
    view.rerender(<SubmittedAnswer field={answer({ name: "Historical signer", consent: true }, "signature")} />); expect(screen.getByText("Historical signer")).toBeVisible();
    view.rerender(<SubmittedAnswer field={answer("Typed history", "signature")} />); expect(screen.getByText("Typed history")).toBeVisible();
  });
  it("renders safe long links and escapes markup, while redacting non-response and credential fields", () => {
    const url = `https://example.test/${"a".repeat(600)}`;
    const view = render(<SubmittedAnswer field={answer(url)} />); expect(screen.getByRole("link")).toHaveAttribute("href", url);
    view.rerender(<SubmittedAnswer field={answer("<svg onload=alert(1)>")} />); expect(view.container.querySelector("svg")).toBeNull();
    const fields = ["secret", "hidden", "password", "html", "break", "pagebreak", "captcha"].map((type, i) => answer("private", type, i));
    expect(visibleSubmittedFields(fields)).toEqual([]);
    view.rerender(<SubmittedAnswer field={fields[0]!} />); expect(view.container).toBeEmptyDOMElement();
  });
  it("turns saved file IDs into authorized filename components without displaying malformed upload data", async () => {
    const { loadIntakeFileInfo } = await import("../app/actions/intake-files");
    vi.mocked(loadIntakeFileInfo).mockResolvedValue({ ok: true, file: { id: "20000000-0000-4000-8000-000000000009", name: "Synthetic brief.txt", size: 12 } });
    const view = render(<SubmittedAnswer field={answer(["20000000-0000-4000-8000-000000000009", "malformed-upload-value"], "file")} />);
    expect(await screen.findByRole("link", { name: "Synthetic brief.txt" })).toBeVisible();
    expect(view.container).not.toHaveTextContent("malformed-upload-value"); expect(view.container).not.toHaveTextContent("20000000-0000-4000-8000-000000000009");
  });
});

describe("response disclosure", () => {
  it("folds long responses, keeps the real PDF action accessible and preserves state on refresh", () => {
    const detail = response(undefined, [answer("Long agreement ".repeat(60))]);
    const view = render(<OrderResponse detail={detail} />);
    const toggle = screen.getByRole("button", { name: "Show responses" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const content = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(content).toHaveAttribute("inert"); expect(content).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
    fireEvent.click(toggle); expect(toggle).toHaveAttribute("aria-expanded", "true"); expect(content).not.toHaveAttribute("inert");
    view.rerender(<OrderResponse detail={{ ...detail }} />); expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle); view.rerender(<OrderResponse detail={{ ...detail }} />); expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
  it("leaves short forms expanded and binds each PDF to its immutable submission", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("denied", { status: 403 })); vi.stubGlobal("fetch", fetcher);
    const detail = response(); render(<OrderResponse detail={detail} />);
    expect(screen.getByRole("button", { name: "Hide responses" })).toHaveAttribute("aria-expanded", "true");
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" })); await screen.findByRole("alert");
    expect(fetcher).toHaveBeenCalledWith(`/api/form-submissions/${detail.submission.id}/pdf`, expect.objectContaining({ cache: "no-store" })); vi.unstubAllGlobals();
  });
  it("keeps intrinsic height/opacity motion and a reduced-motion fallback in source", () => {
    const css = readFileSync("src/components/projects/order-responses.module.css", "utf8");
    expect(css).toContain("grid-template-rows: 0fr"); expect(css).toContain("grid-template-rows: 1fr");
    expect(css).toContain("prefers-reduced-motion: reduce"); expect(css).toContain("transition: none");
  });
});

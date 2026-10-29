// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntakeSecretReferences, IntakeSecretReveal } from "../components/forms/intake-secret-reveal";
import { OrderResponse } from "../components/projects/order-response";
import { answer, response } from "./fixtures/order-response";

const mocks = vi.hoisted(() => ({ list: vi.fn(), reveal: vi.fn(), copy: vi.fn() }));
vi.mock("../app/actions/intake-secrets", () => ({ listIntakeSecretReferences: mocks.list, revealIntakeSecret: mocks.reveal }));
vi.mock("../components/forms/download-form-pdf", () => ({ DownloadFormPdf: () => <button type="button">Download PDF</button> }));

const credential = "a0000000-0000-4000-8000-000000000001";
const secondCredential = "a0000000-0000-4000-8000-000000000002";
const submission = "b0000000-0000-4000-8000-000000000001";
const secondSubmission = "b0000000-0000-4000-8000-000000000002";
const reference = { credential_id: credential, field_key: "c0000000-0000-4000-8000-000000000001", label: "WordPress password" };
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ ok: true, references: [reference] });
  mocks.reveal.mockResolvedValue({ ok: true, secret: "synthetic-wp-password" });
  mocks.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.copy } });
});

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("internal saved password controls", () => {
  it("loads references and plaintext only after two separate explicit actions", async () => {
    const view = render(<IntakeSecretReferences submissionId={submission} />);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(view.container.innerHTML).not.toContain(credential);
    fireEvent.click(screen.getByRole("button", { name: "Show saved passwords" }));
    await screen.findByRole("group", { name: "WordPress password" });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(submission);
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reveal WordPress password" }));
    const value = await screen.findByRole("textbox", { name: "WordPress password value" });
    expect(value).toHaveValue("synthetic-wp-password");
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(credential);
    expect(mocks.copy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy WordPress password" }));
    await screen.findByText("Password copied.");
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("synthetic-wp-password");
    fireEvent.click(screen.getByRole("button", { name: "Hide WordPress password" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(view.container.innerHTML).not.toContain("synthetic-wp-password");
    expect(screen.queryByText("Password copied.")).toBeNull();
  });

  it("uses generic authorization failures without echoing server details", async () => {
    mocks.list.mockResolvedValueOnce({ ok: false, error: "internal detail synthetic-wp-password" });
    const view = render(<IntakeSecretReferences submissionId={submission} />);
    fireEvent.click(screen.getByRole("button", { name: "Show saved passwords" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved passwords are unavailable under your current access.");
    expect(view.container.innerHTML).not.toContain("synthetic-wp-password");
    expect(mocks.reveal).not.toHaveBeenCalled();
    view.rerender(<IntakeSecretReveal credentialId={credential} label={reference.label} />);
    mocks.reveal.mockResolvedValueOnce({ ok: false, error: "private detail synthetic-wp-password" });
    fireEvent.click(screen.getByRole("button", { name: "Reveal WordPress password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The password could not be revealed. Check your access and try again.");
    expect(view.container.innerHTML).not.toContain("synthetic-wp-password");
    expect(screen.queryByRole("button", { name: "Copy WordPress password" })).toBeNull();
  });

  it("ignores a cancelled reveal response and requires a new reveal", async () => {
    const pending = deferred<{ ok: true; secret: string }>();
    mocks.reveal.mockReturnValueOnce(pending.promise);
    const view = render(<IntakeSecretReveal credentialId={credential} label={reference.label} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal WordPress password" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel revealing WordPress password" }));
    await act(async () => pending.resolve({ ok: true, secret: "late-cancelled-password" }));
    expect(view.container.innerHTML).not.toContain("late-cancelled-password");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reveal WordPress password" }));
    expect(await screen.findByRole("textbox")).toHaveValue("synthetic-wp-password");
    expect(mocks.reveal).toHaveBeenCalledTimes(2);
  });

  it("discards revealed and pending plaintext when the credential changes", async () => {
    const pending = deferred<{ ok: true; secret: string }>();
    mocks.reveal.mockReturnValueOnce(pending.promise);
    const view = render(<IntakeSecretReveal credentialId={credential} label={reference.label} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal WordPress password" }));
    view.rerender(<IntakeSecretReveal credentialId={secondCredential} label={reference.label} />);
    await act(async () => pending.resolve({ ok: true, secret: "previous-credential-password" }));
    expect(view.container.innerHTML).not.toContain("previous-credential-password");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reveal WordPress password" }));
    await screen.findByRole("textbox");
    view.rerender(<IntakeSecretReveal credentialId={credential} label={reference.label} />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("ignores stale reference results after the immutable submission changes", async () => {
    const pending = deferred<{ ok: true; references: typeof reference[] }>();
    mocks.list.mockReturnValueOnce(pending.promise);
    const view = render(<IntakeSecretReferences submissionId={submission} />);
    expect(mocks.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show saved passwords" }));
    view.rerender(<IntakeSecretReferences submissionId={secondSubmission} />);
    await act(async () => pending.resolve({ ok: true, references: [reference] }));
    expect(screen.queryByRole("group", { name: "WordPress password" })).toBeNull();
    expect(mocks.reveal).not.toHaveBeenCalled();
  });

  it("clears secret controls when an Order response is folded and keeps generic credentials excluded", async () => {
    const detail = response(submission, [answer("Ordinary answer"), answer({ credential_id: credential }, "secret", 1), answer("unsafe legacy plaintext", "password", 2)]);
    detail.has_saved_credentials = true;
    const view = render(<OrderResponse detail={detail} />);
    expect(view.container.innerHTML).not.toContain(credential);
    expect(view.container.innerHTML).not.toContain("unsafe legacy plaintext");
    expect(mocks.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show saved passwords" }));
    await screen.findByRole("group", { name: "WordPress password" });
    fireEvent.click(screen.getByRole("button", { name: "Reveal WordPress password" }));
    await screen.findByRole("textbox");
    fireEvent.click(screen.getByRole("button", { name: "Hide responses" }));
    expect(view.container.innerHTML).not.toContain("synthetic-wp-password");
    fireEvent.click(screen.getByRole("button", { name: "Show responses" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Show saved passwords" })).toBeVisible();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it.each([false, undefined])("omits password controls for an old response with saved-credential flag %s", (flag) => {
    const detail = response(submission);
    if (flag !== undefined) detail.has_saved_credentials = flag;
    render(<OrderResponse detail={detail} />);
    expect(screen.queryByRole("button", { name: "Show saved passwords" })).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.reveal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hide responses" }));
    fireEvent.click(screen.getByRole("button", { name: "Show responses" }));
    expect(screen.queryByRole("button", { name: "Show saved passwords" })).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

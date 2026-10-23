/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaInstallButton, PwaProvider } from "../components/pwa/pwa-provider";
import { TicketComposer } from "../components/tickets/ticket-composer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../app/actions/tickets", () => ({ sendTicketComposerAction: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function workspace() {
  render(<PwaProvider><input aria-label="Unsaved message" defaultValue="Draft message" /><PwaInstallButton variant="login" /></PwaProvider>);
}
function prompt(outcome: "accepted" | "dismissed" = "dismissed") {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome }),
  });
  act(() => { window.dispatchEvent(event); });
  return event;
}

describe("PWA install and update controls", () => {
  it("keeps business edits while opening and closing installation guidance", () => {
    workspace();
    const edit = screen.getByLabelText("Unsaved message");
    fireEvent.change(edit, { target: { value: "Keep my unsaved message" } });
    fireEvent.click(screen.getByRole("button", { name: "Install or update app" }));
    expect(screen.getByRole("dialog", { name: "Install Wolf Forge" })).toBeInTheDocument();
    expect(screen.getByText(/internet connection is required/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(edit).toHaveValue("Keep my unsaved message");
  });

  it("only opens the native prompt from a deliberate click and consumes it once", async () => {
    workspace();
    const event = prompt();
    expect(event.defaultPrevented).toBe(true);
    expect(event.prompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Install or update app" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Install app" })); });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Unsaved message")).toHaveValue("Draft message");
  });

  it("does not treat accepting a prompt as an appinstalled event", async () => {
    workspace();
    prompt("accepted");
    fireEvent.click(screen.getByRole("button", { name: "Install or update app" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Install app" })); });
    expect(screen.getByRole("dialog", { name: "Install Wolf Forge" })).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event("appinstalled")); });
    expect(screen.getByRole("dialog", { name: "Wolf Forge app" })).toBeInTheDocument();
  });

  it("recovers from an install prompt failure with browser-menu guidance", async () => {
    workspace();
    const event = prompt();
    event.prompt.mockRejectedValue(new Error("Installation unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Install or update app" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Install app" })); });
    expect(screen.getByRole("status")).toHaveTextContent("Installation did not open");
  });

  it("offers iOS/iPadOS guidance when no programmatic install prompt exists", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPad");
    workspace();
    fireEvent.click(screen.getByRole("button", { name: "Install or update app" }));
    expect(screen.getByText(/Share, choose Add to Home Screen/)).toBeInTheDocument();
  });

  it("offers Android browser-menu guidance without promising a native prompt", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Android");
    workspace();
    fireEvent.click(screen.getByRole("button", { name: "Install or update app" }));
    expect(screen.getByText(/Add to Home screen or Install app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
  });

  it("recognizes standalone launch without offering to install again", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    workspace();
    fireEvent.click(screen.getByRole("button", { name: "Install or update app" }));
    expect(screen.getByRole("dialog", { name: "Wolf Forge app" })).toBeInTheDocument();
    expect(screen.queryByText(/choose Add to Home Screen/)).not.toBeInTheDocument();
  });

  it("never reloads on installation, focus or visibility; a canceled reload keeps edits", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    workspace();
    prompt();
    act(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Install or update app" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload app" }));
    expect(screen.getByRole("dialog", { name: "Reload Wolf Forge?" })).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Unsaved message")).toHaveValue("Draft message");
  });

  it("keeps the actual rich reply and selected attachment when reload is canceled", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<PwaProvider>
      <TicketComposer target={{ kind: "ticket", ticketId: "20000000-0000-4000-8000-000000000001" }} mode="client" attached />
      <PwaInstallButton variant="portal" />
    </PwaProvider>);
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    editor.innerHTML = "<strong>Keep this unsent reply</strong>";
    fireEvent.input(editor);
    const attachment = new File(["Synthetic fixture"], "pwa-qa.txt", { type: "text/plain" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [attachment] } });
    fireEvent.click(screen.getByRole("button", { name: "Install or update app" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload app" }));
    expect(screen.getByRole("dialog", { name: "Reload Wolf Forge?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Reload now" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("textbox", { name: "Write a reply" })).toBe(editor);
    expect(editor.innerHTML).toBe("<strong>Keep this unsent reply</strong>");
    expect(screen.getByText("pwa-qa.txt")).toBeInTheDocument();
    expect(fileInput.files?.[0]).toBe(attachment);
    expect(screen.getByRole("button", { name: "Send reply" })).toBeEnabled();
    expect(confirm).not.toHaveBeenCalled();
  });
});

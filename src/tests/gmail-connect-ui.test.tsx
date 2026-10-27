/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationProviderCard } from "../components/settings/integration-provider-card";
import { toIntegrationConnectionViews } from "../domain/integrations/schema";

const paths = {
  configured: true,
  connectPath: "/settings/integrations/gmail/connect",
  verifyPath: "/settings/integrations/gmail/verify",
  disconnectPath: "/settings/integrations/gmail/disconnect",
};
const destination = "https://accounts.google.com/o/oauth2/v2/auth?test=synthetic";
const fetchMock = vi.fn();
const assign = vi.fn();
const reload = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function open(status = "disconnected") {
  const connection = { ...toIntegrationConnectionViews([])[0]!, status } as ReturnType<typeof toIntegrationConnectionViews>[number];
  const view = render(<IntegrationProviderCard connection={connection} canManage actions={paths} />);
  fireEvent.click(screen.getByRole("button", { name: status === "disconnected" ? "Connect" : "Reconnect" }));
  const button = screen.getByRole("button", { name: status === "disconnected" ? "Connect Gmail" : "Reconnect Gmail" });
  const form = button.closest("form")!;
  return { ...view, button, form };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  assign.mockReset();
  reload.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  const actualWindow = window;
  vi.stubGlobal("window", new Proxy(actualWindow, {
    get(target, key) {
      if (key === "location") return { assign, reload };
      return Reflect.get(target, key, target);
    },
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Gmail authorization preparation", () => {
  it.each(["disconnected", "expired", "error"])("prepares %s without native form navigation and clears busy before Google opens", async (status) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ authorizationUrl: destination }) });
    assign.mockImplementation(() => {
      expect(screen.queryByRole("button", { busy: true })).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Opening Google");
      expect(screen.getByRole("button", { name: "Reload settings" })).toBeEnabled();
    });
    const { form } = open(status);
    await act(async () => { expect(fireEvent.submit(form)).toBe(false); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(paths.connectPath, expect.objectContaining({
      method: "POST", headers: { Accept: "application/json" }, credentials: "same-origin", redirect: "error", signal: expect.any(AbortSignal),
    }));
    expect(assign).toHaveBeenCalledWith(destination);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected", { exact: true, selector: "span" })).not.toBeInTheDocument();
  });

  it("aborts a held request after 30 seconds, locks retries and ignores its late result", async () => {
    const held = deferred<Response>();
    fetchMock.mockReturnValue(held.promise);
    const { form, button } = open();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    await act(async () => { vi.advanceTimersByTime(29_999); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(signal.aborted).toBe(true);
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("took too long");
    fireEvent.submit(form);
    await act(async () => { held.resolve({ ok: true, json: async () => ({ authorizationUrl: destination }) } as Response); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload settings" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps the deadline active while a successful response body is still loading", async () => {
    const body = deferred<unknown>();
    fetchMock.mockResolvedValue({ ok: true, json: () => body.promise });
    const { form } = open();
    await act(async () => { fireEvent.submit(form); });
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("took too long");
    await act(async () => { body.resolve({ authorizationUrl: destination }); });
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { authorizationUrl: 7 },
    { authorizationUrl: "/login" },
    { authorizationUrl: "https://example.invalid/o/oauth2/v2/auth" },
    { authorizationUrl: "http://accounts.google.com/o/oauth2/v2/auth" },
    { authorizationUrl: "https://accounts.google.com.evil.invalid/o/oauth2/v2/auth" },
    { authorizationUrl: "https://accounts.google.com/other" },
    { authorizationUrl: "https://user:pass@accounts.google.com/o/oauth2/v2/auth" },
    { authorizationUrl: `${destination}#fragment` },
  ])("rejects malformed or untrusted authorization data without exposing it", async (payload) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
    const { form, button } = open();
    await act(async () => { fireEvent.submit(form); });
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Gmail setup could not open. Reload settings before trying again.");
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it.each([403, 503])("recovers safely from HTTP %s without parsing the error body", async (status) => {
    const json = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status, json });
    const { form } = open();
    await act(async () => { fireEvent.submit(form); });
    expect(json).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Gmail setup could not open");
    expect(assign).not.toHaveBeenCalled();
  });

  it("recovers from a network error or refused redirect without showing provider details", async () => {
    fetchMock.mockRejectedValue(new Error("private transport detail"));
    const { form } = open();
    await act(async () => { fireEvent.submit(form); });
    expect(screen.getByRole("alert")).not.toHaveTextContent("private transport detail");
    expect(screen.getByRole("button", { name: "Reload settings" })).toBeEnabled();
  });

  it("aborts on unmount and ignores an eventual response", async () => {
    const held = deferred<Response>();
    fetchMock.mockReturnValue(held.promise);
    const { form, unmount } = open();
    fireEvent.submit(form);
    const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { held.resolve({ ok: true, json: async () => ({ authorizationUrl: destination }) } as Response); vi.advanceTimersByTime(30_000); });
    expect(assign).not.toHaveBeenCalled();
  });

  it("recovers if a successful response contains invalid JSON", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError("Synthetic invalid JSON"); } });
    const { form, button } = open();
    await act(async () => { fireEvent.submit(form); });
    expect(screen.getByRole("alert")).toHaveTextContent("Gmail setup could not open");
    expect(button).not.toHaveAttribute("aria-busy");
    expect(assign).not.toHaveBeenCalled();
  });

  it("keeps reload recovery available if the browser refuses navigation", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ authorizationUrl: destination }) });
    assign.mockImplementation(() => { throw new Error("Synthetic navigation refusal"); });
    const { form, button } = open();
    await act(async () => { fireEvent.submit(form); });
    expect(screen.getByRole("alert")).toHaveTextContent("Gmail setup could not open");
    expect(screen.getByRole("button", { name: "Reload settings" })).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole("alert")).not.toHaveTextContent("took too long");
  });
});

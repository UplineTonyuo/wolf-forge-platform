import { afterEach, describe, expect, it, vi } from "vitest";
import { readBoundedText } from "../lib/security/bounded-text";

function request(body: BodyInit | null, length?: string) {
  return new Request("https://wolf-forge.invalid/webhook", {
    method: "POST", body,
    headers: length === undefined ? {} : { "content-length": length },
  });
}

describe("bounded signed text reader", () => {
  afterEach(() => vi.useRealTimers());
  it("keeps exact text at the byte limit, including Unicode and line endings", async () => {
    const text = " ñ\r\nλ ";
    const bytes = new TextEncoder().encode(text).byteLength;
    await expect(readBoundedText(request(text, String(bytes)), bytes)).resolves.toEqual({ ok: true, value: text });
    await expect(readBoundedText(request(text), bytes - 1)).resolves.toEqual({ ok: false, status: 413 });
  });

  it.each(["-1", "1.5", "1e3", "9007199254740992", "invalid"])("rejects invalid declared length %s before reading", async (length) => {
    const input = request("{}", length);
    await expect(readBoundedText(input, 64)).resolves.toEqual({ ok: false, status: 400 });
    expect(input.bodyUsed).toBe(false);
  });

  it("rejects an oversized declaration before reading", async () => {
    const input = request("{}", "65");
    await expect(readBoundedText(input, 64)).resolves.toEqual({ ok: false, status: 413 });
    expect(input.bodyUsed).toBe(false);
  });

  it("rejects a truncated declared body and missing body", async () => {
    await expect(readBoundedText(request("{}", "4"), 64)).resolves.toEqual({ ok: false, status: 400 });
    await expect(readBoundedText(request(null), 64)).resolves.toEqual({ ok: false, status: 400 });
  });

  it("refuses invalid UTF-8 instead of replacing signed bytes", async () => {
    await expect(readBoundedText(request(new Uint8Array([0xc3, 0x28])), 64)).resolves.toEqual({ ok: false, status: 400 });
  });

  it("returns a controlled refusal when the input stream fails", async () => {
    const input = new Request("https://wolf-forge.invalid/webhook", {
      method: "POST", duplex: "half",
      body: new ReadableStream({ start(controller) { controller.error(new Error("disconnected")); } }),
    } as RequestInit & { duplex: "half" });
    await expect(readBoundedText(input, 64)).resolves.toEqual({ ok: false, status: 400 });
  });

  it("cancels a stalled body at its deadline and clears the timer", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const input = new Request("https://wolf-forge.invalid/webhook", {
      method: "POST", duplex: "half", body: new ReadableStream({ cancel }),
    } as RequestInit & { duplex: "half" });
    const result = readBoundedText(input, 64);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ ok: false, status: 400 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(input.body?.locked).toBe(false);
  });

  it("cancels an aborted reader without leaving its deadline running", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const controller = new AbortController();
    const input = new Request("https://wolf-forge.invalid/webhook", {
      method: "POST", duplex: "half", body: new ReadableStream({ cancel }), signal: controller.signal,
    } as RequestInit & { duplex: "half" });
    const result = readBoundedText(input, 64);
    controller.abort();
    await expect(result).resolves.toEqual({ ok: false, status: 400 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(input.body?.locked).toBe(false);
  });

  it("removes its deadline after a completed body", async () => {
    vi.useFakeTimers();
    await expect(readBoundedText(request("{}"), 64)).resolves.toEqual({ ok: true, value: "{}" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

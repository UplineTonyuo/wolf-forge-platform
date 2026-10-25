import { afterEach, describe, expect, it, vi } from "vitest";
import { readBoundedJson } from "../lib/security/bounded-json";

function jsonRequest(body: BodyInit | null, headers: HeadersInit = {}): Request {
  return new Request("https://wolf-forge.invalid/api/test", {
    method: "POST",
    body,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

describe("bounded JSON reader", () => {
  afterEach(() => vi.useRealTimers());
  it("accepts a valid request within the explicit bound", async () => {
    await expect(readBoundedJson(jsonRequest('{"ok":true}'), 64)).resolves.toEqual({
      ok: true,
      value: { ok: true },
    });
  });

  it("rejects a declared oversized body without parsing it", async () => {
    await expect(
      readBoundedJson(jsonRequest("{}", { "content-length": "4097" }), 4096),
    ).resolves.toMatchObject({ ok: false, status: 413 });
  });

  it("rejects a streamed oversized body when content-length is absent", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new Uint8Array(128));
        controller.close();
      },
    });
    const request = new Request("https://wolf-forge.invalid/api/test", {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: { "content-type": "application/json" },
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedJson(request, 64)).resolves.toMatchObject({ ok: false, status: 413 });
  });

  it("returns controlled errors for malformed JSON and wrong media types", async () => {
    await expect(readBoundedJson(jsonRequest("{"), 64)).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    const request = new Request("https://wolf-forge.invalid/api/test", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "text/plain" },
    });
    await expect(readBoundedJson(request, 64)).resolves.toMatchObject({
      ok: false,
      status: 415,
    });
  });

  it.each(["-1", "invalid", "9007199254740992"])("retains the invalid declared-length refusal for %s", async (length) => {
    const input = jsonRequest("{}", { "content-length": length });
    await expect(readBoundedJson(input, 64)).resolves.toEqual({ ok: false, status: 400, error: "Invalid request length." });
    expect(input.bodyUsed).toBe(false);
  });

  it("cancels a stalled JSON stream after five seconds and clears its reader/timer", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const input = new Request("https://wolf-forge.invalid/api/test", {
      method: "POST", duplex: "half", body: new ReadableStream({ cancel }), headers: { "content-type": "application/json" },
    } as RequestInit & { duplex: "half" });
    const pending = readBoundedJson(input, 64);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: false, status: 400, error: "Invalid JSON request." });
    expect(cancel).toHaveBeenCalledOnce();
    expect(input.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending JSON read when its request aborts", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const controller = new AbortController();
    const input = new Request("https://wolf-forge.invalid/api/test", {
      method: "POST", duplex: "half", signal: controller.signal,
      body: new ReadableStream({ cancel }), headers: { "content-type": "application/json" },
    } as RequestInit & { duplex: "half" });
    const pending = readBoundedJson(input, 64);
    controller.abort();
    await expect(pending).resolves.toEqual({ ok: false, status: 400, error: "Invalid JSON request." });
    expect(cancel).toHaveBeenCalledOnce();
    expect(input.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns its size refusal without waiting for a stalled cancellation acknowledgement", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const input = new Request("https://wolf-forge.invalid/api/test", {
      method: "POST", duplex: "half", headers: { "content-type": "application/json" },
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65)); }, cancel }),
    } as RequestInit & { duplex: "half" });
    await expect(readBoundedJson(input, 64)).resolves.toEqual({ ok: false, status: 413, error: "Request body is too large." });
    expect(cancel).toHaveBeenCalledOnce();
    expect(input.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

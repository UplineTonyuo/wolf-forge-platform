import { describe, expect, it } from "vitest";
import { readBoundedJson } from "../lib/security/bounded-json";

function jsonRequest(body: BodyInit | null, headers: HeadersInit = {}): Request {
  return new Request("https://wolf-forge.invalid/api/test", {
    method: "POST",
    body,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

describe("bounded JSON reader", () => {
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
});

import { afterEach, expect, it, vi } from "vitest";
import { uploadTeamVoiceBlob } from "../components/team/team-http-client";

afterEach(() => vi.unstubAllGlobals());

const signedUrl = "https://storage.example.test/storage/v1/object/upload/sign/team-voice-messages/synthetic/audio.webm?token=fixture";

it.each(["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"])("uploads %s once with the signed-upload PUT contract", async (type) => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const audio = new Blob([bytes], { type });
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(uploadTeamVoiceBlob(signedUrl, audio)).resolves.toEqual({ ok: true, data: null });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, request] = fetchMock.mock.calls[0]!;
  expect(url).toBe(signedUrl);
  expect(request?.method).toBe("PUT");
  expect(request?.headers).toEqual({ "x-upsert": "false" });
  expect(request?.body).toBeInstanceOf(FormData);
  const form = request!.body as FormData;
  expect([...form.keys()]).toEqual(["cacheControl", ""]);
  expect(form.get("cacheControl")).toBe("3600");
  const file = form.get("") as File;
  expect(file.name).toBe("audio-file");
  expect(file.type).toBe(type);
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
});

it("reports Storage refusal without retrying or changing the uploaded bytes", async () => {
  const audio = new Blob(["synthetic"], { type: "audio/webm" });
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(uploadTeamVoiceBlob(signedUrl, audio)).resolves.toEqual({ ok: false, error: "Voice recording could not be uploaded." });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("reports uncertain network failure without automatically replaying the upload", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Synthetic connection reset"));
  vi.stubGlobal("fetch", fetchMock);
  await expect(uploadTeamVoiceBlob(signedUrl, new Blob(["synthetic"]))).resolves.toEqual({ ok: false, error: "Voice recording could not be uploaded." });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

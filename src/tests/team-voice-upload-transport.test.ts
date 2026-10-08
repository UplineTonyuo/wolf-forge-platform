import { afterEach, expect, it, vi } from "vitest";
import { uploadTeamVoiceBlob } from "../components/team/team-http-client";

afterEach(() => vi.unstubAllGlobals());

it("consumes the signed upload URL once with PUT and preserves the multipart audio contract", async () => {
  const signedUrl = "https://storage.example.test/storage/v1/object/upload/sign/team-voice-messages/conversation/upload/audio.webm?token=test-only";
  const audio = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm;codecs=opus" });
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
  expect(file.type).toBe(audio.type);
  expect(await file.arrayBuffer()).toEqual(await audio.arrayBuffer());
});

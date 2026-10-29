/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceAudioPlayer } from "../components/audio/voice-audio-player";
import { TeamVoiceMessage } from "../components/team/team-voice-message";
import { streamingWebm } from "./fixtures/team-voice-streaming";

const fetchPlayback = vi.hoisted(() => vi.fn());
vi.mock("../components/team/team-http-client", () => ({ fetchTeamVoicePlayback: fetchPlayback }));

let createUrl: ReturnType<typeof vi.fn>;
let revokeUrl: ReturnType<typeof vi.fn>;
let fetchAudio: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("Blob", NodeBlob);
  createUrl = vi.fn().mockReturnValue("blob:voice-fixture");
  revokeUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrl });
  fetchAudio = vi.fn();
  vi.stubGlobal("fetch", fetchAudio);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { fireEvent.pause(this); });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) { fireEvent.play(this); });
  fetchPlayback.mockResolvedValue({ ok: true, data: { url: "https://storage.example.test/signed", expiresAt: "2099-01-01" } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function media(container: HTMLElement) {
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("Expected an audio element");
  return audio;
}
const clickPlay = (label = "Play voice message") => fireEvent.click(screen.getByRole("button", { name: label }));

describe("private voice playback", () => {
  it("times out a stalled signed-source request, aborts it, and retries only on another click", async () => {
    const source = vi.fn<(signal: AbortSignal) => Promise<string>>().mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue("https://storage.example.test/retry");
    const view = render(<VoiceAudioPlayer source={source} durationMs={2000} />);
    vi.useFakeTimers();
    await act(async () => clickPlay());
    const signal = source.mock.calls[0]![0];
    expect(screen.getByRole("button", { name: "Play voice message" })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(14_999); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("Loading took too long");
    expect(screen.getByRole("button", { name: "Retry voice message" })).toBeEnabled();
    expect(source).toHaveBeenCalledTimes(1);
    await act(async () => clickPlay("Retry voice message"));
    expect(screen.getByRole("button", { name: "Pause voice message" })).toBeEnabled();
    expect(source).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a stalled response body and ignores its late completion", async () => {
    let finish!: (value: { done: boolean }) => void;
    const cancel = vi.fn().mockResolvedValue(undefined), releaseLock = vi.fn();
    fetchAudio.mockResolvedValue({ ok: true, headers: new Headers({ "Content-Type": "audio/webm" }), body: { getReader: () => ({
      read: () => new Promise((resolve) => { finish = resolve; }), cancel, releaseLock,
    }) } });
    render(<VoiceAudioPlayer source="/api/ticket-attachments/attachment" />);
    vi.useFakeTimers();
    await act(async () => clickPlay());
    const signal = fetchAudio.mock.calls[0]![1].signal as AbortSignal;
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Retry voice message" })).toBeEnabled();
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    await act(async () => finish({ done: true }));
    expect(cancel).toHaveBeenCalledTimes(1); expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(createUrl).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByRole("button", { name: "Retry voice message" })).toBeEnabled();
  });

  it("clears a pending loading timeout when another player starts or it unmounts", async () => {
    const pending = vi.fn<(signal: AbortSignal) => Promise<string>>(() => new Promise(() => {}));
    const first = render(<VoiceAudioPlayer source={pending} durationMs={1000} label="first" />);
    const second = render(<VoiceAudioPlayer source="https://storage.example.test/two" durationMs={1000} label="second" />);
    vi.useFakeTimers();
    await act(async () => clickPlay("Play first"));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => clickPlay("Play second"));
    expect(pending.mock.calls[0]![0].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => clickPlay("Play first"));
    expect(vi.getTimerCount()).toBe(1);
    first.unmount(); expect(vi.getTimerCount()).toBe(0);
    expect(pending.mock.calls[1]![0].aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Play second" })).toBeEnabled();
    second.unmount();
  });

  it("times out a stalled native play promise and ignores its late completion", async () => {
    let finish!: () => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise<void>((done) => { finish = done; }));
    render(<VoiceAudioPlayer source="https://storage.example.test/stalled" durationMs={2000} />);
    vi.useFakeTimers();
    await act(async () => clickPlay());
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Loading took too long");
    expect(screen.getByRole("button", { name: "Retry voice message" })).toBeEnabled();
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Retry voice message" })).toBeEnabled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps Team URLs and media unloaded until Play and shows trusted duration before metadata", async () => {
    const view = render(<TeamVoiceMessage conversationId="conversation" messageId="message" durationMs={16_020} expired={false} />);
    expect(fetchPlayback).not.toHaveBeenCalled(); expect(fetchAudio).not.toHaveBeenCalled();
    expect(media(view.container)).toHaveAttribute("preload", "none");
    expect(media(view.container)).not.toHaveAttribute("src");
    expect(screen.getByLabelText("Total duration")).toHaveTextContent("0:16");
    expect(screen.getByRole("slider")).toBeDisabled();
    clickPlay();
    await screen.findByRole("button", { name: "Pause voice message" });
    expect(fetchPlayback).toHaveBeenCalledTimes(1);
    expect(fetchPlayback).toHaveBeenCalledWith({ conversationId: "conversation", messageId: "message" }, expect.any(AbortSignal));
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(media(view.container).src).toBe("https://storage.example.test/signed");
    fireEvent.click(screen.getByRole("button", { name: "Pause voice message" }));
    expect(screen.getByRole("button", { name: "Play voice message" })).toBeEnabled();
  });

  it("never mounts a player or requests a URL for expired Team audio", () => {
    const view = render(<TeamVoiceMessage conversationId="conversation" messageId="message" durationMs={10_000} expired />);
    expect(screen.getByText("Recording expired")).toBeInTheDocument();
    expect(view.container.querySelector("audio")).toBeNull();
    expect(fetchPlayback).not.toHaveBeenCalled();
  });

  it("measures Ticket WebM bytes only after Play, supports seeking, and resets actual time on ended", async () => {
    fetchAudio.mockResolvedValue(new Response(streamingWebm(), { headers: { "Content-Type": "audio/webm" } }));
    const view = render(<VoiceAudioPlayer source="/api/ticket-attachments/attachment" />);
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Total duration")).toHaveTextContent("--:--");
    clickPlay();
    await screen.findByRole("button", { name: "Pause voice message" });
    const audio = media(view.container);
    Object.defineProperty(audio, "duration", { configurable: true, value: Infinity });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByLabelText("Total duration")).toHaveTextContent("0:16");
    const seek = screen.getByRole("slider", { name: "Seek voice message" });
    expect(seek).toBeDisabled();
    fireEvent.canPlay(audio);
    expect(seek).toBeEnabled(); expect(seek).toHaveAttribute("type", "range");
    fireEvent.change(seek, { target: { value: "11.2" } });
    expect(audio.currentTime).toBe(11.2);
    expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0:11");
    fireEvent.ended(audio);
    expect(audio.currentTime).toBe(0);
    expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0:00");
    clickPlay(); await screen.findByRole("button", { name: "Pause voice message" });
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    expect(fetchAudio).toHaveBeenCalledWith("/api/ticket-attachments/attachment", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
    view.unmount(); expect(revokeUrl).toHaveBeenCalledWith("blob:voice-fixture");
  });

  it("plays local previews without network requests and releases its owned Blob URL", async () => {
    const view = render(<VoiceAudioPlayer source={new Blob(["local audio"], { type: "audio/webm" })} durationMs={2300} label="voice recording preview" />);
    clickPlay("Play voice recording preview");
    await screen.findByRole("button", { name: "Pause voice recording preview" });
    expect(fetchAudio).not.toHaveBeenCalled();
    view.unmount(); expect(revokeUrl).toHaveBeenCalledTimes(1);
  });

  it("pauses the previous player across different conversations and previews", async () => {
    const first = render(<VoiceAudioPlayer source="https://storage.example.test/one" durationMs={1000} label="first" />);
    render(<VoiceAudioPlayer source="https://storage.example.test/two" durationMs={1000} label="second" />);
    clickPlay("Play first"); await screen.findByRole("button", { name: "Pause first" });
    const pause = vi.spyOn(media(first.container), "pause");
    clickPlay("Play second"); await screen.findByRole("button", { name: "Pause second" });
    expect(pause).toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Play first" })).toBeEnabled();
  });

  it("prevents a late source from taking playback away from the newer intent", async () => {
    let resolve!: (url: string) => void;
    const source = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const first = render(<VoiceAudioPlayer source={source} durationMs={1000} label="first" />);
    const second = render(<VoiceAudioPlayer source="https://storage.example.test/two" durationMs={1000} label="second" />);
    clickPlay("Play first"); clickPlay("Play second");
    await screen.findByRole("button", { name: "Pause second" });
    const secondPause = vi.spyOn(media(second.container), "pause");
    secondPause.mockClear();
    await act(async () => resolve("https://storage.example.test/late"));
    expect(media(first.container)).not.toHaveAttribute("src");
    expect(secondPause).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause second" })).toBeEnabled();
  });

  it("aborts a pending private download on unmount and ignores its late completion", async () => {
    let resolve!: (response: Response) => void;
    fetchAudio.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    const view = render(<VoiceAudioPlayer source="/api/ticket-attachments/attachment" />);
    clickPlay();
    const signal = fetchAudio.mock.calls[0]?.[1]?.signal as AbortSignal;
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => resolve(new Response(streamingWebm(), { headers: { "Content-Type": "audio/webm" } })));
    expect(createUrl).not.toHaveBeenCalled();
  });

  it.each([
    () => new Response("login", { headers: { "Content-Type": "text/html" } }),
    () => new Response("denied", { status: 403, headers: { "Content-Type": "audio/webm" } }),
    () => new Response("too large", { headers: { "Content-Type": "audio/webm", "Content-Length": String(5 * 1024 * 1024 + 1) } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1)); controller.close(); } }), { headers: { "Content-Type": "audio/webm" } }),
  ])("refuses login/denied/oversized responses without automatic retry", async (response) => {
    fetchAudio.mockResolvedValue(response());
    render(<VoiceAudioPlayer source="/api/ticket-attachments/attachment" />);
    clickPlay();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be played");
    expect(fetchAudio).toHaveBeenCalledTimes(1); expect(createUrl).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("fetches a fresh Team signed URL only on explicit retry after a playback error", async () => {
    const view = render(<TeamVoiceMessage conversationId="conversation" messageId="message" durationMs={2000} expired={false} />);
    clickPlay(); await screen.findByRole("button", { name: "Pause voice message" });
    fireEvent.error(media(view.container));
    expect(fetchPlayback).toHaveBeenCalledTimes(1);
    expect(media(view.container)).not.toHaveAttribute("src");
    clickPlay("Retry voice message"); await screen.findByRole("button", { name: "Pause voice message" });
    expect(fetchPlayback).toHaveBeenCalledTimes(2);
  });

  it("retains intentionally loaded Ticket audio when a browser needs a second playback gesture", async () => {
    fetchAudio.mockResolvedValue(new Response(streamingWebm(), { headers: { "Content-Type": "audio/webm" } }));
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("Gesture required", "NotAllowedError"));
    render(<VoiceAudioPlayer source="/api/ticket-attachments/attachment" />);
    clickPlay();
    expect(await screen.findByRole("alert")).toHaveTextContent("Press Play");
    expect(revokeUrl).not.toHaveBeenCalled();
    clickPlay(); await screen.findByRole("button", { name: "Pause voice message" });
    expect(fetchAudio).toHaveBeenCalledTimes(1); expect(createUrl).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets the previous timeline and media when its source identity changes", async () => {
    const view = render(<VoiceAudioPlayer source="https://storage.example.test/one" durationMs={2000} />);
    await act(async () => { clickPlay(); });
    expect(screen.getByRole("button", { name: "Pause voice message" })).toBeEnabled();
    const audio = media(view.container);
    audio.currentTime = 1; fireEvent.timeUpdate(audio); fireEvent.canPlay(audio);
    await act(async () => { view.rerender(<VoiceAudioPlayer source="https://storage.example.test/two" durationMs={4000} />); });
    expect(screen.getByLabelText("Total duration")).toHaveTextContent("0:04");
    expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0:00");
    expect(screen.getByRole("slider")).toBeDisabled();
    expect(audio).not.toHaveAttribute("src");
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it("ignores an old play promise after another player starts", async () => {
    let finish!: () => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(function (this: HTMLMediaElement) {
      fireEvent.play(this);
      return new Promise<void>((done) => { finish = done; });
    });
    const first = render(<VoiceAudioPlayer source="https://storage.example.test/one" durationMs={1000} label="first" />);
    const second = render(<VoiceAudioPlayer source="https://storage.example.test/two" durationMs={1000} label="second" />);
    clickPlay("Play first"); await waitFor(() => expect(finish).toBeDefined());
    clickPlay("Play second"); await screen.findByRole("button", { name: "Pause second" });
    first.unmount();
    const pauseSecond = vi.spyOn(media(second.container), "pause");
    pauseSecond.mockClear();
    await act(async () => finish());
    expect(pauseSecond).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause second" })).toBeEnabled();
  });
});

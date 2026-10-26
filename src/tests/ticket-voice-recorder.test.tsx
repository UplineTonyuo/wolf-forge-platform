/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TicketVoiceRecorder } from "../components/tickets/ticket-voice-recorder";

class FakeRecorder {
  static latest: FakeRecorder;
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  constructor() { FakeRecorder.latest = this; }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["recorded-audio"]) }); this.onstop?.(); }
}
const microphone = vi.fn();
const stop = vi.fn();
const onPicked = vi.fn();
const onRecording = vi.fn();
const track = { stop, onended: null as (() => void) | null };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
const show = () => render(<TicketVoiceRecorder ticketId="test-ticket" disabled={false} onPickAttachment={onPicked} onRecordingChange={onRecording} />);
const record = () => screen.getByRole("button", { name: "Record voice message" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: microphone } });
  microphone.mockResolvedValue(stream);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Ticket voice recording", () => {
  it("does not fetch or show controls when MediaRecorder is unavailable", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    show(); await act(async () => {});
    expect(fetch).not.toHaveBeenCalled(); expect(microphone).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("does not fetch or show controls when microphone APIs are unavailable", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    show(); await act(async () => {});
    expect(fetch).not.toHaveBeenCalled(); expect(microphone).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("shows supported recording without Daily or a microphone request", async () => {
    show();
    await waitFor(() => expect(record()).toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
    expect(microphone).not.toHaveBeenCalled();
  });
  it("hides recording when neither supported Opus format is available", async () => {
    vi.stubGlobal("MediaRecorder", class extends FakeRecorder { static isTypeSupported = () => false; });
    show();
    await act(async () => {});
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(microphone).not.toHaveBeenCalled();
  });
  it("records only after click, stops every track, and hands an unsent File to the existing draft", async () => {
    show();
    await waitFor(() => expect(record()).toBeInTheDocument());
    fireEvent.click(record());
    await screen.findByRole("button", { name: "Stop recording" });
    expect(microphone).toHaveBeenCalledWith({ audio: true, video: false });
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(stop).toHaveBeenCalled();
    expect(onPicked).toHaveBeenCalledTimes(1);
    const pickedFile: unknown = onPicked.mock.calls[0]?.[0];
    expect(pickedFile).toBeInstanceOf(File);
    if (!(pickedFile instanceof File)) throw new Error("Expected a recorded draft File");
    expect(pickedFile.type).toBe("audio/webm");
    expect(onRecording).toHaveBeenLastCalledWith(false);
  });
  it("discards recording without attaching bytes", async () => {
    show(); await waitFor(() => expect(record()).toBeInTheDocument());
    fireEvent.click(record());
    fireEvent.click(await screen.findByRole("button", { name: "Discard recording" }));
    expect(stop).toHaveBeenCalled();
    expect(onPicked).not.toHaveBeenCalled();
    expect(onRecording).toHaveBeenLastCalledWith(false);
  });
  it("releases a permission request resolved after cancellation", async () => {
    let resolve!: (stream: unknown) => void;
    microphone.mockReturnValue(new Promise((done) => { resolve = done; }));
    show(); await waitFor(() => expect(record()).toBeInTheDocument());
    fireEvent.click(record());
    fireEvent.click(await screen.findByRole("button", { name: "Cancel recording" }));
    await act(async () => resolve(stream));
    expect(stop).toHaveBeenCalled();
    expect(onPicked).not.toHaveBeenCalled();
  });
  it("times out an ignored microphone prompt and releases permission granted afterward", async () => {
    let resolve!: (stream: unknown) => void;
    microphone.mockReturnValue(new Promise((done) => { resolve = done; }));
    show(); await waitFor(() => expect(record()).toBeInTheDocument());
    vi.useFakeTimers();
    try {
      await act(async () => { fireEvent.click(record()); });
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(screen.getByRole("alert")).toHaveTextContent("taking too long");
      expect(record()).toBeEnabled();
      expect(onRecording).toHaveBeenLastCalledWith(false);
      await act(async () => resolve(stream));
      expect(stop).toHaveBeenCalled();
      expect(onPicked).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("stops microphone on unmount and does not persist a partial recording", async () => {
    const view = show(); await waitFor(() => expect(record()).toBeInTheDocument());
    fireEvent.click(record()); await screen.findByRole("button", { name: "Stop recording" });
    view.unmount();
    expect(stop).toHaveBeenCalled(); expect(onPicked).not.toHaveBeenCalled();
  });
  it("stops automatically at five minutes and leaves a draft rather than sending", async () => {
    show(); await waitFor(() => expect(record()).toBeInTheDocument());
    vi.useFakeTimers();
    try {
      await act(async () => { fireEvent.click(record()); });
      await act(async () => { vi.advanceTimersByTime(300_000); });
      expect(FakeRecorder.latest.state).toBe("inactive");
      expect(onPicked).toHaveBeenCalledTimes(1);
      expect(stop).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("rejects oversized bytes and never attaches a partial file", async () => {
    show(); await waitFor(() => expect(record()).toBeInTheDocument());
    fireEvent.click(record()); await screen.findByRole("button", { name: "Stop recording" });
    act(() => FakeRecorder.latest.ondataavailable?.({ data: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]) }));
    expect(screen.getByRole("alert")).toHaveTextContent("exceeded 5 MB");
    expect(onPicked).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });
  it("a late stop event from a discarded recording cannot stop a newer microphone stream", async () => {
    show(); await waitFor(() => expect(record()).toBeInTheDocument());
    fireEvent.click(record()); await screen.findByRole("button", { name: "Stop recording" });
    const old = FakeRecorder.latest;
    const stopped = old.onstop; old.onstop = null;
    fireEvent.click(screen.getByRole("button", { name: "Discard recording" }));
    fireEvent.click(record()); await screen.findByRole("button", { name: "Stop recording" });
    stop.mockClear();
    act(() => stopped?.());
    expect(stop).not.toHaveBeenCalled(); expect(onPicked).not.toHaveBeenCalled();
  });
  it("stops active capture and refuses late audio after the conversation becomes disabled", async () => {
    const view = show(); await waitFor(() => expect(record()).toBeInTheDocument());
    fireEvent.click(record()); await screen.findByRole("button", { name: "Stop recording" });
    const prior = FakeRecorder.latest;
    view.rerender(<TicketVoiceRecorder ticketId="test-ticket" disabled onPickAttachment={onPicked} onRecordingChange={onRecording} />);
    await waitFor(() => expect(record()).toBeDisabled());
    expect(stop).toHaveBeenCalled();
    act(() => { prior.ondataavailable?.({ data: new Blob(["late-audio"]) }); prior.onstop?.(); });
    expect(onPicked).not.toHaveBeenCalled();
    expect(onRecording).toHaveBeenLastCalledWith(false);
  });
  it("releases permission granted after the conversation becomes disabled", async () => {
    let resolve!: (stream: unknown) => void;
    microphone.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = show(); await waitFor(() => expect(record()).toBeInTheDocument());
    fireEvent.click(record()); await screen.findByRole("button", { name: "Cancel recording" });
    view.rerender(<TicketVoiceRecorder ticketId="test-ticket" disabled onPickAttachment={onPicked} onRecordingChange={onRecording} />);
    await act(async () => resolve(stream));
    expect(stop).toHaveBeenCalled(); expect(onPicked).not.toHaveBeenCalled();
    expect(record()).toBeDisabled();
  });
  it("reports a blocked microphone without dropping the draft", async () => {
    microphone.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    show(); await waitFor(() => expect(record()).toBeInTheDocument());
    fireEvent.click(record());
    expect(await screen.findByRole("alert")).toHaveTextContent("Microphone access was denied");
    expect(onPicked).not.toHaveBeenCalled();
    expect(onRecording).toHaveBeenLastCalledWith(false);
  });
});

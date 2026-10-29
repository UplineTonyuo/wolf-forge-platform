/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TeamVoiceRecorder,
  __resetTeamVoiceRecorderPermissionMemory,
} from "../components/team/team-voice-recorder";

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetTeamVoiceRecorderPermissionMemory();
});

describe("Voice recording lifecycle", () => {
  it("cancels active recording without producing a preview or uploading", async () => {
    const stream = fakeStream();
    stubRecording(vi.fn().mockResolvedValue(stream), "granted");
    renderRecorder();
    await act(async () => {});
    fireEvent.click(micButton());
    await screen.findByRole("button", { name: "Stop recording" });
    fireEvent.click(screen.getByRole("button", { name: "Discard voice recording" }));
    expect(stream.track.stop).toHaveBeenCalled();
    expect(micButton()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play voice recording preview" })).not.toBeInTheDocument();
  });

  it("releases permission granted after unmount", async () => {
    const stream = fakeStream();
    let resolve!: (value: unknown) => void;
    stubRecording(vi.fn(() => new Promise((done) => { resolve = done; })), "granted");
    const view = render(<TeamVoiceRecorder conversationId={CONVERSATION} disabled={false} onSent={vi.fn()} />);
    await act(async () => {});
    fireEvent.click(micButton());
    view.unmount();
    await act(async () => resolve(stream));
    expect(stream.track.stop).toHaveBeenCalled();
  });

  it("ignores delayed device errors from a discarded recording after another recording starts", async () => {
    const stream = fakeStream();
    stubRecording(vi.fn().mockResolvedValue(stream), "granted");
    renderRecorder();
    await act(async () => {});
    fireEvent.click(micButton());
    await screen.findByRole("button", { name: "Stop recording" });
    const oldError = FakeMediaRecorder.latest.onerror;
    const oldEnded = stream.track.onended;
    fireEvent.click(screen.getByRole("button", { name: "Discard voice recording" }));
    fireEvent.click(micButton());
    await screen.findByRole("button", { name: "Stop recording" });
    stream.track.stop.mockClear();
    act(() => { oldError?.(); oldEnded?.(); });
    expect(stream.track.stop).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeInTheDocument();
  });

  it("stops capture when its existing capability becomes disabled", async () => {
    const stream = fakeStream();
    stubRecording(vi.fn().mockResolvedValue(stream), "granted");
    const view = render(<TeamVoiceRecorder conversationId={CONVERSATION} disabled={false} onSent={vi.fn()} />);
    await act(async () => {});
    fireEvent.click(micButton());
    await screen.findByRole("button", { name: "Stop recording" });
    view.rerender(<TeamVoiceRecorder conversationId={CONVERSATION} disabled onSent={vi.fn()} />);
    await waitFor(() => expect(micButton()).toBeDisabled());
    expect(stream.track.stop).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Play voice recording preview" })).not.toBeInTheDocument();
  });

  it("captures the actual stop time between timer ticks for local preview", async () => {
    const stream = fakeStream();
    stubRecording(vi.fn().mockResolvedValue(stream), "granted");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recording");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    renderRecorder();
    await act(async () => {});
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(micButton()); });
    await act(async () => { vi.advanceTimersByTime(1999); });
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(screen.getByLabelText("Total duration")).toHaveTextContent("0:01");
    expect(screen.getByRole("slider")).toHaveAttribute("max", "1.999");
  });
});

const CONVERSATION = "10000000-0000-4000-8000-000000000001";

class FakeMediaRecorder {
  static latest: FakeMediaRecorder;
  static isTypeSupported() {
    return true;
  }
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: { size: number } }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: unknown, public options: unknown) { FakeMediaRecorder.latest = this; }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

function fakeStream() {
  const track = { stop: vi.fn(), onended: null as (() => void) | null };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    track,
  };
}

/**
 * `permission` is a stand-in for the Permissions API's reported state:
 * "granted" | "denied" | "prompt" | undefined (unsupported in this browser).
 */
function stubRecording(getUserMedia: ReturnType<typeof vi.fn>, permission?: "granted" | "denied" | "prompt") {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  const permissions = permission
    ? { query: vi.fn().mockResolvedValue({ state: permission, onchange: null }) }
    : undefined;
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: { getUserMedia },
    ...(permissions ? { permissions } : {}),
  });
}

function renderRecorder(onSent = vi.fn()) {
  render(<TeamVoiceRecorder conversationId={CONVERSATION} disabled={false} onSent={onSent} />);
}

function micButton() {
  return screen.getByRole("button", { name: "Record voice message" });
}

describe("Voice composer control — browser support", () => {
  it("hides itself entirely when the browser cannot record audio", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    renderRecorder();
    expect(screen.queryByRole("button", { name: "Record voice message" })).not.toBeInTheDocument();
  });

  it("does not request microphone access before the user clicks record", () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubRecording(getUserMedia);
    renderRecorder();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("disables the control when the composer disallows sending, without hiding it", () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubRecording(getUserMedia);
    render(<TeamVoiceRecorder conversationId={CONVERSATION} disabled onSent={vi.fn()} />);
    expect(micButton()).toBeDisabled();
  });
});

describe("Voice composer control — first-time permission dialog", () => {
  it("presents the Wolf Forge dialog on first tap, before any browser prompt", () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubRecording(getUserMedia);
    renderRecorder();
    fireEvent.click(micButton());
    expect(screen.getByRole("dialog", { name: "Use microphone" })).toBeInTheDocument();
    expect(screen.getByText("Wolf Forge needs microphone access to record and send voice messages.")).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("Not now closes the dialog without requesting microphone access", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubRecording(getUserMedia);
    renderRecorder();
    fireEvent.click(micButton());
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Use microphone" })).not.toBeInTheDocument());
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(micButton()).toBeInTheDocument();
  });

  it("Allow microphone calls getUserMedia and starts recording once granted", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubRecording(getUserMedia);
    renderRecorder();
    fireEvent.click(micButton());
    fireEvent.click(screen.getByRole("button", { name: "Allow microphone" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Use microphone" })).not.toBeInTheDocument());
    expect(screen.getByRole("status", { name: "Recording voice message" })).toBeInTheDocument();
  });

  it("Escape and an outside click both dismiss the intro dialog without ever requesting the microphone", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubRecording(getUserMedia);
    renderRecorder();

    fireEvent.click(micButton());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Use microphone" })).not.toBeInTheDocument());

    fireEvent.click(micButton());
    const dialog = screen.getByRole("dialog", { name: "Use microphone" });
    fireEvent.mouseDown(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Use microphone" })).not.toBeInTheDocument());

    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe("Voice composer control — already-decided permission", () => {
  it("skips the intro dialog and records immediately when the Permissions API reports granted", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubRecording(getUserMedia, "granted");
    renderRecorder();
    await waitFor(() => {}); // let the permissions.query() microtask settle
    fireEvent.click(micButton());
    expect(screen.queryByRole("dialog", { name: "Use microphone" })).not.toBeInTheDocument();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    expect(screen.getByRole("status", { name: "Recording voice message" })).toBeInTheDocument();
  });

  it("skips the intro dialog on later taps once permission has been granted once this session, even without the Permissions API", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubRecording(getUserMedia);
    renderRecorder();
    fireEvent.click(micButton());
    fireEvent.click(screen.getByRole("button", { name: "Allow microphone" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Recording voice message" })).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    // Stopping produces a (possibly empty) preview; discard it to get back to the idle mic button.
    fireEvent.click(screen.getByRole("button", { name: "Discard voice recording" }));

    getUserMedia.mockClear();
    fireEvent.click(micButton());
    expect(screen.queryByRole("dialog", { name: "Use microphone" })).not.toBeInTheDocument();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  });

  it("skips the intro dialog when the Permissions API reports denied, and shows blocked once getUserMedia confirms it", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    stubRecording(getUserMedia, "denied");
    renderRecorder();
    await waitFor(() => {});
    fireEvent.click(micButton());
    expect(screen.queryByRole("dialog", { name: "Use microphone" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Microphone is blocked" })).toBeInTheDocument());
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it("does not misclassify an allowed-but-deviceless machine as blocked (Permissions API says denied, but no microphone exists)", async () => {
    // Some browsers report the microphone Permissions API entry as "denied"
    // when the site permission is actually "Allow" but zero audio-input
    // devices are present. getUserMedia's own NotFoundError is what must win.
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError"));
    stubRecording(getUserMedia, "denied");
    renderRecorder();
    await waitFor(() => {});
    fireEvent.click(micButton());
    await waitFor(() => expect(screen.getByRole("dialog", { name: "No microphone detected" })).toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "Microphone is blocked" })).not.toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });
});

describe("Voice composer control — permission and device failures", () => {
  it("shows a blocked-permission dialog, never raw DOMException text", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    stubRecording(getUserMedia);
    renderRecorder();
    fireEvent.click(micButton());
    fireEvent.click(screen.getByRole("button", { name: "Allow microphone" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Microphone is blocked" })).toBeInTheDocument());
    expect(
      screen.getByText("Wolf Forge can't record a voice message until microphone access is allowed for this site. Open your browser's site settings, allow the microphone for Wolf Forge, then try again.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/NotAllowedError/)).not.toBeInTheDocument();
  });

  it("shows a distinct no-microphone dialog", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError"));
    stubRecording(getUserMedia);
    renderRecorder();
    fireEvent.click(micButton());
    fireEvent.click(screen.getByRole("button", { name: "Allow microphone" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "No microphone detected" })).toBeInTheDocument());
    expect(screen.getByText("Connect a microphone, headset, or another audio input device and try again.")).toBeInTheDocument();
  });

  it("shows a distinct busy-device dialog", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("busy", "NotReadableError"));
    stubRecording(getUserMedia);
    renderRecorder();
    fireEvent.click(micButton());
    fireEvent.click(screen.getByRole("button", { name: "Allow microphone" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Microphone is unavailable" })).toBeInTheDocument());
    expect(screen.getByText("The microphone may be in use by another application. Close it and try again.")).toBeInTheDocument();
  });

  it("closes any failure dialog with Got it and returns focus to the mic button", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError"));
    stubRecording(getUserMedia);
    renderRecorder();
    fireEvent.click(micButton());
    fireEvent.click(screen.getByRole("button", { name: "Allow microphone" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "No microphone detected" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(micButton()).toHaveFocus();
  });
});

describe("Voice composer control — mid-recording disconnect", () => {
  it("stops safely and shows a centered disconnect dialog when the microphone is lost mid-recording", async () => {
    const stream = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubRecording(getUserMedia);
    renderRecorder();

    fireEvent.click(micButton());
    fireEvent.click(screen.getByRole("button", { name: "Allow microphone" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Recording voice message" })).toBeInTheDocument());

    stream.track.onended?.();

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Microphone disconnected" })).toBeInTheDocument());
    expect(
      screen.getByText("The recording was stopped because the microphone became unavailable.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Recording voice message" })).not.toBeInTheDocument();
  });
});

describe("Voice composer control — mobile viewport", () => {
  it("keeps the intro dialog usable at a narrow (mobile) viewport width", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
      stubRecording(getUserMedia);
      renderRecorder();
      fireEvent.click(micButton());
      const dialog = screen.getByRole("dialog", { name: "Use microphone" });
      expect(dialog).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
      const allow = screen.getByRole("button", { name: "Allow microphone" });
      expect(allow).toBeInTheDocument();
      fireEvent.click(allow);
      expect(getUserMedia).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});

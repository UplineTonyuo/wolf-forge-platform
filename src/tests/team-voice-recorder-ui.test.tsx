/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TeamVoiceRecorder,
  __resetTeamVoiceRecorderPermissionMemory,
} from "../components/team/team-voice-recorder";
import * as teamHttp from "../components/team/team-http-client";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetTeamVoiceRecorderPermissionMemory();
});

const CONVERSATION = "10000000-0000-4000-8000-000000000001";

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: unknown, public options: unknown) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }) });
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
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:voice-preview") as typeof URL.createObjectURL;
  } else {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice-preview");
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
  } else {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  }
}

function stubPreviewAudio() {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn(function play(this: HTMLMediaElement) {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    }),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: vi.fn(function pause(this: HTMLMediaElement) {
      this.dispatchEvent(new Event("pause"));
    }),
  });
}

function renderRecorder(onSent = vi.fn()) {
  render(<TeamVoiceRecorder conversationId={CONVERSATION} disabled={false} onSent={onSent} />);
}

function micButton() {
  return screen.getByRole("button", { name: "Record voice message" });
}

async function startRecordingGranted() {
  const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
  stubRecording(getUserMedia, "granted");
  stubPreviewAudio();
  renderRecorder();
  await waitFor(() => {});
  fireEvent.click(micButton());
  await waitFor(() => expect(screen.getByRole("status", { name: "Recording voice message" })).toBeInTheDocument());
  return getUserMedia;
}

async function stopIntoReview() {
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send voice message" })).toBeInTheDocument());
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
    stubPreviewAudio();
    renderRecorder();
    fireEvent.click(micButton());
    fireEvent.click(screen.getByRole("button", { name: "Allow microphone" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Recording voice message" })).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    // Stopping produces a local preview; discard it to get back to the idle mic button.
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

describe("Voice composer control — recording / review UX", () => {
  beforeEach(() => {
    stubPreviewAudio();
  });

  it("idle → recording shows a compact live control without /5:00 or Stop text", async () => {
    await startRecordingGranted();
    const live = screen.getByRole("status", { name: "Recording voice message" });
    expect(live).toBeInTheDocument();
    expect(live).not.toHaveTextContent("/ 5:00");
    expect(live).not.toHaveTextContent("Stop");
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record voice message" })).not.toBeInTheDocument();
  });

  it("recording → stop enters local review instead of sending", async () => {
    await startRecordingGranted();
    await stopIntoReview();
    expect(screen.queryByRole("status", { name: "Recording voice message" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play recording preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard voice recording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send voice message" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Duration/)).toBeInTheDocument();
  });

  it("play/pause toggles the local preview without uploading", async () => {
    const prepare = vi.spyOn(teamHttp, "prepareTeamVoiceUpload");
    await startRecordingGranted();
    await stopIntoReview();
    fireEvent.click(screen.getByRole("button", { name: "Play recording preview" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause recording preview" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Pause recording preview" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Play recording preview" })).toBeInTheDocument());
    expect(prepare).not.toHaveBeenCalled();
  });

  it("discard returns to the idle mic control", async () => {
    await startRecordingGranted();
    await stopIntoReview();
    fireEvent.click(screen.getByRole("button", { name: "Discard voice recording" }));
    expect(screen.getByRole("button", { name: "Record voice message" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send voice message" })).not.toBeInTheDocument();
  });

  it("review → send uploads the retained blob and returns to idle", async () => {
    const onSent = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubRecording(getUserMedia, "granted");
    stubPreviewAudio();
    vi.spyOn(teamHttp, "prepareTeamVoiceUpload").mockResolvedValue({
      ok: true,
      data: {
        uploadId: "upload-1",
        uploadUrl: "https://example.test/upload",
        mimeType: "audio/webm",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    vi.spyOn(teamHttp, "uploadTeamVoiceBlob").mockResolvedValue({ ok: true, data: null });
    vi.spyOn(teamHttp, "finalizeTeamVoiceUpload").mockResolvedValue({ ok: true, data: {} });

    render(<TeamVoiceRecorder conversationId={CONVERSATION} disabled={false} onSent={onSent} />);
    await waitFor(() => {});
    fireEvent.click(micButton());
    await waitFor(() => expect(screen.getByRole("status", { name: "Recording voice message" })).toBeInTheDocument());
    await stopIntoReview();
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(teamHttp.prepareTeamVoiceUpload).toHaveBeenCalled();
    expect(teamHttp.uploadTeamVoiceBlob).toHaveBeenCalled();
    expect(teamHttp.finalizeTeamVoiceUpload).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Record voice message" })).toBeInTheDocument();
  });

  it("upload failure keeps review state, exposes the error, and allows Retry of the same blob", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubRecording(getUserMedia, "granted");
    stubPreviewAudio();
    const prepare = vi.spyOn(teamHttp, "prepareTeamVoiceUpload").mockResolvedValue({
      ok: false,
      error: "Voice recording could not be prepared.",
    });
    const upload = vi.spyOn(teamHttp, "uploadTeamVoiceBlob");

    renderRecorder();
    await waitFor(() => {});
    fireEvent.click(micButton());
    await waitFor(() => expect(screen.getByRole("status", { name: "Recording voice message" })).toBeInTheDocument());
    await stopIntoReview();
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Voice recording could not be prepared."));
    expect(screen.getByRole("button", { name: "Send voice message" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play recording preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry sending voice message" })).toBeInTheDocument();

    prepare.mockResolvedValue({
      ok: true,
      data: {
        uploadId: "upload-2",
        uploadUrl: "https://example.test/upload-2",
        mimeType: "audio/webm",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    upload.mockResolvedValue({ ok: true, data: null });
    vi.spyOn(teamHttp, "finalizeTeamVoiceUpload").mockResolvedValue({ ok: true, data: {} });

    fireEvent.click(screen.getByRole("button", { name: "Retry sending voice message" }));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});

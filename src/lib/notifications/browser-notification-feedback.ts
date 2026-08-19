let audioContext: AudioContext | null =
  null;

function getAudioContext() {
  if (
    typeof window === "undefined"
  ) {
    return null;
  }

  if (!audioContext) {
    audioContext =
      new window.AudioContext();
  }

  return audioContext;
}

export async function unlockNotificationAudio() {
  const context =
    getAudioContext();

  if (
    context?.state ===
    "suspended"
  ) {
    try {
      await context.resume();
    } catch {
      // Browser autoplay rules can keep audio suspended
      // until a later user interaction.
    }
  }
}

export function playNotificationChime() {
  const context =
    getAudioContext();

  if (
    !context ||
    context.state !== "running"
  ) {
    return;
  }

  const start =
    context.currentTime;

  const master =
    context.createGain();

  master.connect(
    context.destination,
  );

  master.gain.setValueAtTime(
    0.0001,
    start,
  );

  master.gain.exponentialRampToValueAtTime(
    0.075,
    start + 0.015,
  );

  master.gain.exponentialRampToValueAtTime(
    0.0001,
    start + 0.42,
  );

  for (const frequency of [
    880,
    1320,
  ]) {
    const oscillator =
      context.createOscillator();

    oscillator.type = "sine";

    oscillator.frequency.setValueAtTime(
      frequency,
      start,
    );

    oscillator.connect(
      master,
    );

    oscillator.start(
      start,
    );

    oscillator.stop(
      start + 0.44,
    );
  }
}
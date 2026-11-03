/** One bounded ringtone owned by the shell provider; autoplay remains browser-controlled. */
export function startCallRingtone(deadline: number, blocked: (value: boolean) => void) {
  const Audio = window.AudioContext;
  if (!Audio) { blocked(true); return { resume() {}, stop() {} }; }
  const context = new Audio();
  let stopped = false;
  const ring = () => {
    if (stopped || document.visibilityState !== "visible" || Date.now() >= deadline || context.state !== "running") return;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = 440;
    gain.gain.setValueAtTime(.04, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .28);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .3);
  };
  const resume = () => {
    if (stopped) return;
    void context.resume().then(() => { if (!stopped) { blocked(context.state !== "running"); ring(); } }).catch(() => { if (!stopped) blocked(true); });
  };
  blocked(context.state !== "running");
  resume();
  const timer = setInterval(ring, 3000);
  return { resume, stop() { if (stopped) return; stopped = true; clearInterval(timer); void context.close().catch(() => {}); } };
}

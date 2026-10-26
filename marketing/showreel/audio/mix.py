"""Builds the Wolf Forge Portal 60s soundtrack and muxes the final video.

  python3 marketing/showreel/audio/mix.py

Inputs (audio/source/):
  vo-60s.mp3   ElevenLabs voice-over ("Don", eleven_v4, warm read), 14 phrases
  sfx_*.mp3    ElevenLabs sound effects (boom, whoosh, riser, glitch)
The score, clicks, message pops and the phone buzz are synthesised here (numpy only)
at 120 BPM so cuts land on the beat. The VO is split at its pauses and each block is
placed on its scene; the score ducks under it.
Output: out/soundtrack.wav and wolf-forge-portal-showreel.mp4.
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = HERE / "source"
OUT = ROOT / "out"
SR = 48000
DUR = 60.0
N = int(DUR * SR)
rng = np.random.default_rng(11)


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)


def at(t):
    return int(round(t * SR))


def add(bus, sig, t, gain=1.0, pan=0.0):
    """Mix a mono or stereo signal into a stereo bus at time t (seconds)."""
    if sig.ndim == 1:
        sig = np.stack([sig * np.sqrt(0.5 * (1 - pan)), sig * np.sqrt(0.5 * (1 + pan))], axis=1) * np.sqrt(2)
    i = at(t)
    if i < 0:
        sig, i = sig[-i:], 0
    n = min(len(sig), len(bus) - i)
    if n > 0:
        bus[i:i + n] += sig[:n] * gain


def fft_filter(x, lo=None, hi=None):
    """Zero-phase brick-ish band filter with soft edges (axis 0)."""
    n = len(x)
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    if hi:
        g *= 1 / np.sqrt(1 + (f / hi) ** 8)
    if lo:
        g *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** 8)
    return np.fft.irfft(X * (g[:, None] if x.ndim == 2 else g), n=n, axis=0)


def reverb(x, seconds=2.4, damp=5000):
    n = int(seconds * SR)
    tt = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-tt * 6.9 / seconds)[:, None]
    ir = fft_filter(ir, hi=damp)
    ir /= np.sqrt(np.sum(ir ** 2))
    L = len(x) + n
    size = 1 << int(np.ceil(np.log2(L)))
    Y = np.fft.irfft(np.fft.rfft(x, size, axis=0) * np.fft.rfft(ir, size, axis=0), size, axis=0)
    return Y[:len(x)]


def adsr(n, a=0.005, r=0.05):
    e = np.ones(n)
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] *= np.linspace(1, 0, nr)
    return e


def saw(freq, n, harmonics=None, detune=0.0):
    tt = np.arange(n) / SR
    h = harmonics or max(1, min(60, int(16000 / freq)))
    out = np.zeros(n)
    ph = rng.random() * 6.28
    for k in range(1, h + 1):
        out += np.sin(2 * np.pi * freq * (1 + detune) * k * tt + ph * k) / k
    return out * 0.55


# ---------------------------------------------------------------- voice-over
def split_vo(vo):
    mono = vo.mean(axis=1)
    hop = SR // 100
    rms = np.sqrt(np.convolve(mono ** 2, np.ones(hop) / hop, "same"))[::hop]
    db = 20 * np.log10(rms + 1e-9)
    voiced = db > -40
    segs, start, quiet = [], None, 0
    for i, v in enumerate(voiced):
        if v:
            if start is None:
                start = i
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet >= 40:  # 0.40 s of silence closes a phrase
                segs.append((start, i - quiet + 1))
                start, quiet = None, 0
    if start is not None:
        segs.append((start, len(voiced)))
    return [(a / 100, b / 100) for a, b in segs], db


def inner_onsets(db, a, b, gap=0.12):
    """Word-group onsets inside a phrase (after short internal pauses)."""
    on, quiet, out = True, 0, [a]
    for i in range(int(a * 100), int(b * 100)):
        if db[i] > -36:
            if not on and quiet >= int(gap * 100):
                out.append(i / 100)
            on, quiet = True, 0
        else:
            on, quiet = False, quiet + 1
    return out


vo = load(SRC / "vo-60s.mp3")
segs, vo_db = split_vo(vo)
if len(segs) != 14:
    sys.exit(f"expected 14 VO phrases, found {len(segs)}: {segs}")

# Each block is a run of consecutive phrases (kept with their natural gaps) placed on its
# scene. The visuals' CUE table in index.html follows the onsets printed below.
BLOCKS = [  # (first phrase, last phrase, start time)
    (0, 0, 0.5),     # Every great project starts with a conversation.
    (1, 1, 6.7),     # With Wolf Forge, you're never left wondering.
    (2, 3, 10.9),    # It starts in your portal. Pick your plan, and talk to us right there.
    (4, 4, 16.9),    # The moment you're in, your project is live, and our team already has it.
    (5, 5, 21.9),    # Behind the scenes, we're already planning your first win.
    (6, 7, 27.0),    # Talk to us inside your project. Ask, approve, share. Every message, one place.
    (8, 8, 34.4),    # Need something else? Send a message. A real person replies.
    (9, 9, 39.8),    # Every task, tracked. You can watch the work move.
    (10, 10, 44.5),  # Billing is just as simple. One tap, and it's paid.
    (11, 11, 50.0),  # And every month, your results: clear, honest, yours.
    (12, 12, 55.5),  # Wolf Forge Portal.
    (13, 13, 57.2),  # Start your project today.
]
vo_bus = np.zeros((N, 2))
report = []
for first, last, t in BLOCKS:
    a, b = segs[first][0], segs[last][1]
    pad = 0.06
    clip = vo[max(0, at(a - pad)):at(b + 0.12)].copy()
    clip *= adsr(len(clip), a=0.02, r=0.08)[:, None]
    add(vo_bus, clip, t - pad)
    onsets = [o for i in range(first, last + 1) for o in inner_onsets(vo_db, *segs[i])]
    report.append({"at": round(t, 2), "ends": round(t + b - a, 2), "onsets": [round(t + o - a, 2) for o in onsets]})
print(json.dumps(report))

# ---------------------------------------------------------------- score
music = np.zeros((N, 2))
send = np.zeros((N, 2))  # reverb send
BAR0 = 4.0     # title hit; bars of 2 s from here
LOGO = 55.0    # app icon lockup hit
BUILD = 49.5   # snare roll + riser under the monthly report
DROP = 54.75   # everything cuts out
# Arrangement by section: (start, kick, hats, arp, snare, bass)
SECTIONS = [
    (4.0, 0.55, 0.5, 0.0, 0.0, 0.6),   # title, phone hook: heartbeat pulse
    (10.5, 0.85, 1.0, 1.0, 0.0, 1.0),  # client portal: the groove starts
    (21.5, 1.0, 1.0, 1.0, 0.55, 1.0),  # team + project chat: full
    (34.0, 0.0, 0.6, 0.8, 0.0, 0.7),   # ticket: breakdown, "a real person replies"
    (39.5, 1.0, 1.0, 1.0, 0.55, 1.0),  # explode, billing: back in full
]
NOTE = {"D": 73.42, "Bb": 58.27, "F": 87.31, "C": 65.41, "G": 49.0, "A": 55.0}
PROGRESSION = [("D", [0, 3, 7]), ("Bb", [0, 4, 7]), ("F", [0, 4, 7]), ("C", [0, 4, 7])]
CHORDS = [PROGRESSION[i % 4] for i in range(int((LOGO - BAR0) / 2) - 2)] + [("G", [0, 3, 7]), ("A", [0, 4, 7])]


def chord_at(t):
    i = int((t - BAR0) // 2)
    return CHORDS[min(max(i, 0), len(CHORDS) - 1)]


def section_at(t):
    cur = SECTIONS[0]
    for s in SECTIONS:
        if t >= s[0]:
            cur = s
    return cur


def kick(gain=1.0):
    n = int(0.45 * SR)
    tt = np.arange(n) / SR
    f = 42 + 140 * np.exp(-tt * 38)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7)
    click = rng.standard_normal(n) * np.exp(-tt * 300) * 0.25
    return np.tanh((body + click) * 1.6) * gain


def snare(gain=1.0, length=0.25):
    n = int(length * SR)
    tt = np.arange(n) / SR
    noise = fft_filter(rng.standard_normal(n), lo=1200, hi=9000) * np.exp(-tt * 18)
    tone = np.sin(2 * np.pi * 190 * tt) * np.exp(-tt * 30)
    return (noise * 0.9 + tone * 0.5) * gain


def hat(gain=1.0, open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    tt = np.arange(n) / SR
    return fft_filter(rng.standard_normal(n), lo=7000) * np.exp(-tt * (18 if open_ else 90)) * gain


def mouse_click(gain=1.0):
    """Trackpad-style press/release: two short filtered transients 45 ms apart."""
    n = int(0.09 * SR)
    tt = np.arange(n) / SR
    out = np.zeros(n)
    for start, f, g in ((0, 3200, 1.0), (int(0.045 * SR), 4200, 0.6)):
        m = n - start
        burst = fft_filter(rng.standard_normal(m), lo=1500, hi=9000) * np.exp(-tt[:m] * 600)
        out[start:] += (burst * 0.6 + np.sin(2 * np.pi * f * tt[:m]) * np.exp(-tt[:m] * 380)) * g
    return out * gain


def tick(freq=2400, gain=1.0):
    n = int(0.06 * SR)
    tt = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * tt) * np.exp(-tt * 70) * gain


def pop(gain=1.0, pitch=1.0):
    """Message bubble landing: a short downward pitch blip."""
    n = int(0.12 * SR)
    tt = np.arange(n) / SR
    f = (900 + 700 * np.exp(-tt * 40)) * pitch
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 34) * gain


def chime(gain=1.0):
    """Notification arrival: two soft bell partials, a fifth apart."""
    n = int(1.2 * SR)
    tt = np.arange(n) / SR
    out = np.zeros(n)
    for start, f in ((0, 1318.5), (int(0.11 * SR), 1975.5)):
        m = n - start
        out[start:] += (np.sin(2 * np.pi * f * tt[:m]) + 0.3 * np.sin(2 * np.pi * f * 2.76 * tt[:m])) * np.exp(-tt[:m] * 4.5)
    return out * gain


def buzz(gain=1.0, length=0.38):
    """Phone vibration: a 150 Hz motor hum with a rough amplitude edge."""
    n = int(length * SR)
    tt = np.arange(n) / SR
    motor = np.sign(np.sin(2 * np.pi * 150 * tt)) * 0.6 + np.sin(2 * np.pi * 300 * tt) * 0.4
    return fft_filter(motor, hi=1800) * adsr(n, 0.01, 0.04) * gain


# Intro: sub drone + wind + heartbeat, sucking into the title hit
n_in = at(BAR0)
tt = np.arange(n_in) / SR
swell = np.clip(tt / (BAR0 - 0.3), 0, 1) ** 1.6
drone = (np.sin(2 * np.pi * 36.71 * tt) * 0.5 + np.sin(2 * np.pi * 73.42 * tt) * 0.25 + saw(146.83, n_in, 8) * 0.06) * swell
wind = fft_filter(rng.standard_normal((n_in, 2)), lo=300, hi=2500) * 0.05 * swell[:, None]
add(music, drone * 0.55, 0)
add(music, wind, 0)
for t in (1.0, 1.25, 2.0, 2.25, 3.0, 3.25):
    add(music, kick(0.35 if t % 1 == 0 else 0.22), t)

# Pads, three detuned voices per chord tone
for bar, (root, ivs) in enumerate(CHORDS):
    t0 = BAR0 + bar * 2
    length = min(2.0, LOGO - t0)
    n = int(length * SR) + int(0.3 * SR)
    pad = np.zeros(n)
    for iv in ivs:
        f = NOTE[root] * 4 * 2 ** (iv / 12)
        for d in (-0.004, 0, 0.005):
            pad += saw(f, n, 14, d)
    bright = 2600 if t0 >= BUILD else (1000 if 34.0 <= t0 < 39.5 else 1500)
    pad = fft_filter(pad, hi=bright) * adsr(n, a=0.25, r=0.4) * (0.065 if 34.0 <= t0 < 39.5 else 0.05)
    add(music, pad, t0, pan=-0.2)
    add(music, pad, t0 + 0.012, pan=0.2)
    add(send, pad, t0, 0.6)

# Drums, bass, arp: title → DROP, arranged by section
t = BAR0
step = 0.125
while t < DROP - 1e-9:
    b = round((t - BAR0) / step)  # 16th index
    root, ivs = chord_at(t)
    _, k_g, h_g, a_g, s_g, b_g = section_at(t)
    on_beat = b % 4 == 0
    beat_in_bar = (b // 4) % 4
    building = t >= BUILD
    if on_beat and k_g:
        add(music, kick(k_g), t)
    if b % 4 == 2:
        add(music, hat(0.22 * h_g, open_=b % 8 == 6), t, pan=0.3)
    elif h_g and t >= 10.5:
        add(music, hat(0.08 * h_g), t, pan=-0.25)
    if s_g and on_beat and beat_in_bar in (1, 3) and not building:
        s = snare(s_g)
        add(music, s, t)
        add(send, s, t, 0.35)
    if b_g and (b % 2 == 1 or (b % 2 == 0 and not on_beat)):
        n = int(0.115 * SR)
        f = NOTE[root] * (2 if b % 4 == 3 else 1)
        bs = fft_filter(saw(f, n, 24), hi=900 if t < 21.5 else 1600) * adsr(n, 0.004, 0.03) * 0.42 * b_g
        add(music, bs, t)
    if a_g:
        seq = [0, 1, 2, 1, 2, 3, 2, 1]
        k = seq[b % 8]
        iv = (ivs + [12 + ivs[0]])[k]
        f = NOTE[root] * 8 * 2 ** (iv / 12) * (2 if (b // 8) % 2 and t >= 21.5 else 1)
        n = int(0.2 * SR)
        tt = np.arange(n) / SR
        pl = saw(f, n, 10) * np.exp(-tt * 22) * 0.11 * (0.7 + 0.3 * (b % 4 == 0)) * a_g
        pan = 0.45 if b % 2 else -0.45
        add(music, pl, t, pan=pan)
        add(music, pl * 0.35, t + 0.375, pan=-pan)  # dotted-8th ping-pong
        add(send, pl, t, 0.3)
    t = round(t + step, 6)

# Build: snare roll BUILD → DROP accelerating, rising noise
roll_t = BUILD
while roll_t < DROP:
    rate = 0.5 if roll_t < BUILD + 2.5 else (0.25 if roll_t < DROP - 1.25 else (0.125 if roll_t < DROP - 0.4 else 0.0625))
    g = 0.12 + 0.48 * (roll_t - BUILD) / (DROP - BUILD)
    add(music, snare(g, 0.12), roll_t)
    add(send, snare(g * 0.5, 0.12), roll_t)
    roll_t = round(roll_t + rate, 6)
n_b = at(DROP) - at(BUILD)
tt = np.arange(n_b) / SR
rise = fft_filter(rng.standard_normal((n_b, 2)), lo=2000, hi=12000) * ((tt / tt[-1]) ** 2.5)[:, None] * 0.12
add(music, rise, BUILD)

# Final: Dm(add9) chord bloom + sub + shimmer, LOGO → end
n_f = at(DUR - LOGO)
tt = np.arange(n_f) / SR
fin = np.zeros(n_f)
for f in (146.83, 220.0, 293.66, 349.23, 440.0, 659.25):
    for d in (-0.003, 0.0, 0.004):
        fin += saw(f * (1 + d), n_f, 10)
fin = fft_filter(fin, hi=2200) * np.exp(-tt * 0.45) * adsr(n_f, 0.01, 0.8) * 0.035
sub = np.sin(2 * np.pi * 36.71 * tt) * np.exp(-tt * 0.8) * 0.6 * adsr(n_f, 0.005, 0.5)
shimmer = np.zeros(n_f)
for f in (1174.66, 1760.0, 2349.32, 2637.0):
    shimmer += np.sin(2 * np.pi * f * tt) * (0.5 + 0.5 * np.sin(2 * np.pi * 7 * tt + f))
shimmer *= np.exp(-tt * 0.9) * 0.02
add(music, fin, LOGO)
add(music, sub, LOGO)
add(music, shimmer, LOGO, pan=0.15)
add(send, fin + shimmer * 2, LOGO, 1.0)

music += reverb(send, 2.6) * 0.55

# ---------------------------------------------------------------- SFX
sfx = np.zeros((N, 2))
boom, whoosh, riser, glitch = (load(SRC / f"sfx_{k}.mp3") for k in ("boom", "whoosh", "riser", "glitch"))


def peak_time(x):
    e = np.convolve(np.abs(x.mean(axis=1)), np.ones(480) / 480, "same")
    return int(np.argmax(e)) / SR


SFX_TIMES = json.loads((ROOT / "timeline.json").read_text())
wp, bp, gp = peak_time(whoosh), peak_time(boom), peak_time(glitch)
for t_w, g in SFX_TIMES["whoosh"]:
    add(sfx, whoosh * g, t_w - wp)
for t_b, g in SFX_TIMES["boom"]:
    add(sfx, boom * g, t_b - bp)
suck = boom[::-1].copy()
suck *= np.linspace(0, 1, len(suck))[:, None] ** 2
add(sfx, suck * 0.45, BAR0 - len(suck) / SR)
add(sfx, riser * 0.6, LOGO - len(riser) / SR)
for t_g, g in SFX_TIMES["glitch"]:
    add(sfx, glitch * g, t_g - gp)
for c in SFX_TIMES["click"]:
    add(sfx, mouse_click(0.55), c - 0.01)
for i, c in enumerate(SFX_TIMES["pop"]):
    add(sfx, pop(0.32, 1.0 + 0.08 * (i % 3)), c, pan=0.25 if i % 2 else -0.25)
for c in SFX_TIMES["ping"]:
    add(sfx, tick(2600, 0.18), c, pan=-0.3)
    add(sfx, tick(3900, 0.09), c + 0.03, pan=0.3)
for c in SFX_TIMES["chime"]:
    add(sfx, chime(0.35), c)
for c in SFX_TIMES["buzz"]:
    add(sfx, buzz(0.4), c)
add(sfx, reverb(sfx, 1.4) * 0.18, 0)

# ---------------------------------------------------------------- mix + master
env = np.sqrt(np.convolve(vo_bus.mean(axis=1) ** 2, np.ones(960) / 960, "same"))
env = env / (env.max() + 1e-9)
# attack ~30 ms, release ~300 ms
smooth = np.zeros_like(env)
a_c, r_c = np.exp(-1 / (0.03 * SR)), np.exp(-1 / (0.3 * SR))
acc = 0.0
for i, v in enumerate(env[::48]):
    acc = (a_c ** 48) * acc + (1 - a_c ** 48) * v if v > acc else (r_c ** 48) * acc + (1 - r_c ** 48) * v
    smooth[i * 48:(i + 1) * 48] = acc
duck = 1 - 0.5 * np.clip(smooth * 3, 0, 1)

music /= np.max(np.abs(music)) + 1e-9
sfx /= np.max(np.abs(sfx)) + 1e-9
vo_bus /= np.max(np.abs(vo_bus)) + 1e-9
vo_bus = fft_filter(vo_bus, lo=70)
mix = music * 0.42 * duck[:, None] + sfx * 0.55 + vo_bus * 0.85
fade = np.ones(N)
fade[-at(0.6):] = np.linspace(1, 0, at(0.6)) ** 1.5
mix *= fade[:, None]
voiced = smooth > 0.15
bed = music * 0.42 * duck[:, None] + sfx * 0.55
ratio = 20 * np.log10(np.sqrt(np.mean((vo_bus * 0.85)[voiced] ** 2)) / np.sqrt(np.mean(bed[voiced] ** 2)))
print(f"VO over bed while speaking: {ratio:+.1f} dB")
mix = np.tanh(mix * 1.15) / np.tanh(1.15)

OUT.mkdir(exist_ok=True)
wav = OUT / "soundtrack.wav"
pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes()
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-",
                "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.8:level=false", "-ar", str(SR), str(wav)], input=pcm, check=True)
print(wav)

frames = OUT / "frames.mp4"
if frames.exists():
    final = ROOT / "wolf-forge-portal-showreel.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(frames), "-i", str(wav), "-map", "0:v", "-map", "1:a",
                    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-maxrate", "6M", "-bufsize", "12M",
                    "-pix_fmt", "yuv420p", "-profile:v", "high", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", str(final)],
                   check=True)
    print(final)

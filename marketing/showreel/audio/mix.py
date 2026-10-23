"""Builds the Wolf Forge Portal showreel soundtrack and muxes the final video.

  python3 marketing/showreel/audio/mix.py

Inputs (audio/source/):
  vo-take-b.mp3   ElevenLabs voice-over ("Don", eleven_v4), nine phrases
  sfx_*.mp3       ElevenLabs sound effects (boom, whoosh, riser, glitch)
The score is synthesised here (numpy only) at 120 BPM so every cut lands on a beat.
The VO is split at its pauses and each phrase is placed on its scene; the score
ducks under it. Output: out/soundtrack.wav and wolf-forge-portal-showreel.mp4.
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
DUR = 25.0
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


vo = load(SRC / "vo-take-b.mp3")
segs, vo_db = split_vo(vo)
if len(segs) != 9:
    sys.exit(f"expected 9 VO phrases, found {len(segs)}: {segs}")

# Phrase start times on the video timeline (the visuals' CUE table follows these).
PLACE = [0.45, 3.62, None, 9.6, 12.95, 16.25, 18.25, 21.3, 23.05]
PLACE[2] = segs[2][0]  # "Projects. Tickets. Clients. Billing." keeps its own timing
vo_bus = np.zeros((N, 2))
report = []
for (a, b), t in zip(segs, PLACE):
    pad = 0.06
    clip = vo[at(a - pad):at(b + 0.12)].copy()
    clip *= adsr(len(clip), a=0.02, r=0.08)[:, None]
    add(vo_bus, clip, t - pad)
    report.append({"phrase_at": round(t, 2), "ends": round(t + b - a, 2),
                   "word_onsets": [round(t + o - a, 2) for o in inner_onsets(vo_db, a, b)]})
print(json.dumps(report, indent=1))

# ---------------------------------------------------------------- score
music = np.zeros((N, 2))
send = np.zeros((N, 2))  # reverb send
BEAT = 0.5
BAR0 = 3.5
NOTE = {"D": 73.42, "Bb": 58.27, "F": 87.31, "C": 65.41, "G": 49.0, "A": 55.0}
CHORDS = [("D", [0, 3, 7]), ("Bb", [0, 4, 7]), ("F", [0, 4, 7]), ("C", [0, 4, 7]),
          ("D", [0, 3, 7]), ("Bb", [0, 4, 7]), ("G", [0, 3, 7]), ("A", [0, 4, 7]), ("A", [0, 4, 7])]


def chord_at(t):
    i = int((t - BAR0) // 2)
    return CHORDS[min(max(i, 0), len(CHORDS) - 1)]


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


def tick(freq=2400, gain=1.0):
    n = int(0.06 * SR)
    tt = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * tt) * np.exp(-tt * 70) * gain


# Intro: sub drone + wind + heartbeat, sucking into the 3.5 s hit
n_in = at(3.5)
tt = np.arange(n_in) / SR
swell = np.clip(tt / 3.2, 0, 1) ** 1.6
drone = (np.sin(2 * np.pi * 36.71 * tt) * 0.5 + np.sin(2 * np.pi * 73.42 * tt) * 0.25 + saw(146.83, n_in, 8) * 0.06) * swell
wind = fft_filter(rng.standard_normal((n_in, 2)), lo=300, hi=2500) * 0.05 * swell[:, None]
add(music, drone * 0.55, 0)
add(music, wind, 0)
for t in (0.5, 0.75, 1.5, 1.75, 2.5, 2.75):
    add(music, kick(0.35 if t % 1 == 0.5 else 0.22), t)

# Pads (whole piece from the hit), three detuned voices per chord tone
for bar in range(9):
    t0 = BAR0 + bar * 2
    if t0 >= 21.0:
        break
    root, ivs = CHORDS[bar]
    length = min(2.0, 21.0 - t0)
    n = int(length * SR) + int(0.3 * SR)
    pad = np.zeros(n)
    for iv in ivs:
        f = NOTE[root] * 4 * 2 ** (iv / 12)
        for d in (-0.004, 0, 0.005):
            pad += saw(f, n, 14, d)
    pad = fft_filter(pad, hi=1400 if t0 < 17.5 else 2600) * adsr(n, a=0.25, r=0.4) * 0.05
    add(music, pad, t0, pan=-0.2)
    add(music, pad, t0 + 0.012, pan=0.2)
    add(send, pad, t0, 0.6)

# Drums, bass, arp: 3.5 → 20.75, then a dropout into the logo hit
t = 3.5
step = 0.125
while t < 20.75 - 1e-9:
    b = round((t - BAR0) / step)  # 16th index
    root, ivs = chord_at(t)
    on_beat = b % 4 == 0
    beat_in_bar = (b // 4) % 4
    building = t >= 18.0
    if on_beat:
        add(music, kick(1.0 if t >= 12.5 else 0.85), t)
    if b % 4 == 2:
        add(music, hat(0.22, open_=b % 8 == 6), t, pan=0.3)
    elif t >= 5.5:
        add(music, hat(0.08), t, pan=-0.25)
    if t >= 12.5 and on_beat and beat_in_bar in (1, 3) and not building:
        s = snare(0.55)
        add(music, s, t)
        add(send, s, t, 0.35)
    # bass: 8th notes, side-chained feel via short notes off the kick
    if b % 2 == 1 or (b % 2 == 0 and not on_beat):
        n = int(0.115 * SR)
        f = NOTE[root] * (2 if b % 4 == 3 else 1)
        bs = fft_filter(saw(f, n, 24), hi=900 if t < 12.5 else 1600) * adsr(n, 0.004, 0.03) * 0.42
        add(music, bs, t)
    # arp: 16ths across two octaves from the first product shot
    if t >= 5.5:
        seq = [0, 1, 2, 1, 2, 3, 2, 1]
        k = seq[b % 8]
        iv = (ivs + [12 + ivs[0]])[k]
        f = NOTE[root] * 8 * 2 ** (iv / 12) * (2 if (b // 8) % 2 and t >= 12.5 else 1)
        n = int(0.2 * SR)
        tt = np.arange(n) / SR
        pl = saw(f, n, 10) * np.exp(-tt * 22) * 0.11 * (0.7 + 0.3 * (b % 4 == 0))
        pan = 0.45 if b % 2 else -0.45
        add(music, pl, t, pan=pan)
        add(music, pl * 0.35, t + 0.375, pan=-pan)  # dotted-8th ping-pong
        add(send, pl, t, 0.3)
    t = round(t + step, 6)

# Build: snare roll 18 → 20.75 accelerating, rising noise
roll_t = 18.0
while roll_t < 20.75:
    rate = 0.25 if roll_t < 19.5 else (0.125 if roll_t < 20.25 else 0.0625)
    g = 0.15 + 0.45 * (roll_t - 18.0) / 2.75
    add(music, snare(g, 0.12), roll_t)
    add(send, snare(g * 0.5, 0.12), roll_t)
    roll_t = round(roll_t + rate, 6)
n_b = at(20.75) - at(18.0)
tt = np.arange(n_b) / SR
rise = fft_filter(rng.standard_normal((n_b, 2)), lo=2000, hi=12000) * ((tt / tt[-1]) ** 2.5)[:, None] * 0.12
add(music, rise, 18.0)

# Final: Dm(add9) chord bloom + sub + shimmer, 21 → 25
n_f = at(4.0)
tt = np.arange(n_f) / SR
fin = np.zeros(n_f)
for f in (146.83, 220.0, 293.66, 349.23, 440.0, 659.25):
    for d in (-0.003, 0.0, 0.004):
        fin += saw(f * (1 + d), n_f, 10)
fin = fft_filter(fin, hi=2200) * np.exp(-tt * 0.55) * adsr(n_f, 0.01, 0.6) * 0.035
sub = np.sin(2 * np.pi * 36.71 * tt) * np.exp(-tt * 0.9) * 0.6 * adsr(n_f, 0.005, 0.5)
shimmer = np.zeros(n_f)
for f in (1174.66, 1760.0, 2349.32, 2637.0):
    shimmer += np.sin(2 * np.pi * f * tt) * (0.5 + 0.5 * np.sin(2 * np.pi * 7 * tt + f))
shimmer *= np.exp(-tt * 1.1) * 0.02
add(music, fin, 21.0)
add(music, sub, 21.0)
add(music, shimmer, 21.0, pan=0.15)
add(send, fin + shimmer * 2, 21.0, 1.0)

music += reverb(send, 2.6) * 0.55

# ---------------------------------------------------------------- SFX
sfx = np.zeros((N, 2))
boom, whoosh, riser, glitch = (load(SRC / f"sfx_{k}.mp3") for k in ("boom", "whoosh", "riser", "glitch"))


def peak_time(x):
    e = np.convolve(np.abs(x.mean(axis=1)), np.ones(480) / 480, "same")
    return int(np.argmax(e)) / SR


wp = peak_time(whoosh)
for i, cut in enumerate((5.5, 9.5, 12.5, 16.0, 17.23)):
    add(sfx, whoosh * (0.5 if i < 4 else 0.32), cut - wp)
bp = peak_time(boom)
add(sfx, boom * 0.95, 3.5 - bp)
add(sfx, boom * 0.95, 21.0 - bp)
add(sfx, boom * 0.35, 14.56 - bp)
suck = boom[::-1].copy()
suck *= np.linspace(0, 1, len(suck))[:, None] ** 2
add(sfx, suck * 0.45, 3.5 - len(suck) / SR)
add(sfx, riser * 0.6, 21.0 - len(riser) / SR)
gp = peak_time(glitch)
for t_g, g in ((12.62, 0.5), (14.5, 0.6), (19.31, 0.45)):
    add(sfx, glitch * g, t_g - gp)
for c in (5.67, 6.72, 7.58, 8.49):
    add(sfx, tick(2600, 0.25), c, pan=-0.3)
    add(sfx, tick(3900, 0.12), c + 0.03, pan=0.3)
for c in (17.23, 17.36):
    add(sfx, tick(1800, 0.2), c)
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
                    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-maxrate", "9M", "-bufsize", "18M",
                    "-pix_fmt", "yuv420p", "-profile:v", "high", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", str(final)],
                   check=True)
    print(final)

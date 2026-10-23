# Wolf Forge Portal — 25s showreel

`wolf-forge-portal-showreel.mp4` — 1920×1080, 30 fps, H.264 + AAC, -14 LUFS.

Built only from what is in this repo: the wolf mark and app icon in `public/branding/`,
the real White Label Studio screenshots in `docs/qa/`, the brand fonts (Sora, Inter) and
the palette from `src/app/globals.css` (`#000d51` navy, `#d9a92f` / `#f1c85a` gold).

| Time | Scene | VO |
| --- | --- | --- |
| 0.0–3.5 | Gold wolf mark draws on with a light sweep | "Every pack… needs a leader." |
| 3.5–5.5 | Title slam, per-letter z-depth | "Wolf Forge Portal." |
| 5.5–9.5 | Real desktop in 3D; gold pill walks the sidebar on each word | "Projects. Tickets. Clients. Billing." |
| 9.5–12.5 | Wall of real screens collapses into one | "Your entire operation — in one place." |
| 12.5–16.0 | UI explode: 13 layers cut from the real screen lift and snap back | "Built in layers. Engineered to move." |
| 16.0–18.0 | Desktop, then real mobile renders spring in | "Desktop. Mobile." |
| 18.0–21.0 | Circle wipe from Navy to the Forest Premium template | "Your brand. Your colors." |
| 21.0–25.0 | App icon lockup + wordmark | "Wolf Forge Portal. Lead the pack." |

There's a mesh gradient, gold embers, film grain and a vignette across the whole piece. Every cut
lands on the 120 BPM grid of the score.

## Audio

- **Voice-over:** ElevenLabs `eleven_v4`, voice "Don – Movie Trailers". The mix splits it at its
  pauses and places each phrase on its scene (`audio/source/vo-take-b.mp3`).
- **SFX:** ElevenLabs `eleven_text_to_sound_v2`: boom, whoosh, riser and UI glitch (`audio/source/sfx_*.mp3`).
- **Music:** synthesised in `audio/mix.py` at 120 BPM in D minor. It covers the intro drone, the
  driving section, the build with a snare roll and the final chord bloom, and it ducks under
  the VO. The ElevenLabs connector in use can't generate music.

## Rebuild

```bash
cd marketing/showreel
npm i --no-save playwright@1.62.1          # or symlink an existing node_modules
CHROMIUM_PATH=/path/to/chrome node render.mjs   # -> out/frames.mp4 (~4 min)
python3 audio/mix.py                         # -> out/soundtrack.wav + final MP4
```

`node render.mjs --stills 4,12.8` renders single frames. If you serve the folder through `render.mjs`, you can open
`index.html?t=13.4` to inspect a frame or `?play` to watch it in real time.

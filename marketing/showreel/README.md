# Wolf Forge Portal — showreel

`wolf-forge-portal-showreel.mp4` — 28s, 1920×1080, 30 fps, H.264 + AAC, -14 LUFS.

The piece follows a user through the app, from the Dashboard to Settings. A POV cursor clicks
each sidebar item. One in-app camera pulls out to the navigation before every click, then zooms
in on the detail that matters (revenue, a project status, an urgent ticket, a lead, a paid
invoice).

| Time | Scene | Camera | VO |
| --- | --- | --- | --- |
| 0.0–3.5 | Gold wolf mark draws on | slow push | "Every pack… needs a leader." |
| 3.5–5.0 | Title slam | dives through the title | "Wolf Forge Portal." |
| 5.0–7.2 | **01 Dashboard** | far, tilted → full app → zoom to Total Revenue | — |
| 7.2–10.0 | **02 Projects · 03 Tickets · 04 Clients · 05 Billing** | out to the nav, click, in to the status / Urgent / Lead / Paid detail | "Projects. Tickets. Clients. Billing." |
| 10.0–11.0 | Back to Dashboard | click Dashboard, pull to full | — |
| 11.0–14.5 | Every page as a wall | zoom out, then collapse back into the Dashboard | "Your entire operation — in one place." |
| 14.5–18.0 | UI explode of the real Dashboard | 3D tilt, layers lift, snap back | "Built in layers. Engineered to move." |
| 18.0–20.0 | Desktop + real mobile renders | — | "Desktop. Mobile." |
| 20.0–23.5 | **06 Settings → White Label Studio** | zoom to sidebar, click Settings, zoom to tabs, then the Navy → Forest Premium recolor | "Your brand. Your colors." |
| 23.5–28.0 | App icon lockup | — | "Wolf Forge Portal. Lead the pack." |

Mesh gradient, gold embers, film grain and a vignette run throughout. Cuts and clicks land on
the 120 BPM grid of the score.

## Sources

- **Screens (`captures/`)** are real renders of this app, captured by `capture/capture.mjs` from
  the local stack with the demo data in `capture/seed-demo.sql`. The demo companies and
  "Alex Morgan" are sample data, not customers.
- **White Label Studio** frames are the QA screenshots in `docs/qa/white-label-studio-v3/`.
- **Brand:** `public/branding/` (wolf mark, app icon), Sora and Inter, plus the navy and gold palette.
- **Voice-over:** ElevenLabs `eleven_v4`, voice "Don – Movie Trailers"
  (`audio/source/vo-take-b.mp3`). `audio/mix.py` splits it at the pauses and places each phrase.
- **SFX:** ElevenLabs `eleven_text_to_sound_v2`: boom, whoosh, riser, glitch. The mouse clicks
  and focus pings are synthesised.
- **Music:** synthesised in `audio/mix.py` (D minor, 120 BPM). It ducks under the VO.

## Rebuild

```bash
# 1. (only to refresh the screens) local stack + demo data + capture
npx supabase start
npm run qa:local-login                       # local QA accounts
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f marketing/showreel/capture/seed-demo.sql
echo LOCAL_UI_QA_BYPASS=true >> .env.local   # local-only auto sign-in for the QA account
npm run dev
node marketing/showreel/capture/capture.mjs

# 2. frames + soundtrack
cd marketing/showreel
CHROMIUM_PATH=/path/to/chrome node render.mjs   # -> out/frames.mp4 (~6 min)
python3 audio/mix.py                            # -> out/soundtrack.wav + final MP4
```

`render.mjs` needs Playwright (a repo dev dependency) resolvable from this folder. `node render.mjs --stills 6.9,8.6` renders single frames.

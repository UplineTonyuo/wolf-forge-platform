# Wolf Forge Portal — 60s client story

`wolf-forge-portal-showreel.mp4` — 60s, 1920×1080, 30 fps, H.264 + AAC, -14 LUFS.

The film is made for Wolf Forge's clients. It follows one project from start to finish
(sample client **Harbor Fitness**, **SEO Growth Plan**) and shows both sides: the client
portal ("You") and the Wolf Forge team ("Team"). A chip at the top of the frame says
whose screen we are on. Communication comes first: the film opens on a message arriving.

| Time | Chapter | What happens | VO |
| --- | --- | --- | --- |
| 0:00 | — | Gold wolf mark, title slam | "Every great project starts with a conversation." |
| 0:06 | Hook | Phone buzzes: "New message on your project". Tap opens the project, then a rewind to "How it started" | "With Wolf Forge, you're never left wondering." |
| 0:10 | 01 Your portal | Client dashboard → Investments (Store) → SEO Growth Plan → **Talk to your team** | "It starts in your portal. Pick your plan, and talk to us right there." |
| 0:16 | 02 Project live | Team side: the project slides into Projects, already assigned | "The moment you're in, your project is live, and our team already has it." |
| 0:21 | 03 Team on it | The team's own chat about the new project, message by message | "Behind the scenes, we're already planning your first win." |
| 0:26 | 04 Project chat | Split screen: the same project chat on the client side and the team side, each message landing on both | "Talk to us inside your project. Ask, approve, share. Every message, one place." |
| 0:34 | 05 Support | Client sends a ticket; a person on the team replies from the Inbox; the reply lands for the client | "Need something else? Send a message. A real person replies." |
| 0:39 | 06 Progress | The project page explodes into layers; delivery progress (3 of 5) glows | "Every task, tracked. You can watch the work move." |
| 0:44 | 07 Billing | Invoice Unpaid → one tap → Paid | "Billing is just as simple. One tap, and it's paid." |
| 0:49 | 08 Results | The October report, stepped through: +38% traffic, #3 (was #11), 5,120 profile views | "And every month, your results: clear, honest, yours." |
| 0:55 | — | App icon lockup, **Start your project today**, `portal.wolfforge.com` | "Wolf Forge Portal. Start your project today." |

The effects from the first cut carry through: mesh gradient, gold embers, film grain,
vignette, light sweeps, UI explode, in/out camera zooms, a POV cursor with click ripples,
and focus rings.

## Sources

- **Screens (`captures/story/`)** are real renders of this app, captured by
  `capture/capture-story.mjs` from the local stack with sample data
  (`capture/seed-demo.sql`, then `capture/seed-story.sql`). Harbor Fitness, Maya Chen,
  Alex Morgan, Jordan Reyes and Sam Carter are demo people, not customers.
  `captures/story/boxes.json` records where each zoom, click and message sits on screen.
- **Voice-over:** ElevenLabs `eleven_v4`, voice "Don – Movie Trailers", with a warm read
  (`audio/source/vo-60s.mp3`).
- **SFX:** ElevenLabs boom, whoosh, riser and glitch. The mouse clicks, message pops,
  notification chime and phone buzz are synthesised in `audio/mix.py`.
- **Music:** synthesised in `audio/mix.py` (D minor, 120 BPM). It has a heartbeat intro,
  a groove from the portal, a breakdown under support, and a build into the lockup. It
  ducks under the VO.
- **Timing:** `timeline.json` holds every cue and sound-effect time. Both `index.html` and
  `audio/mix.py` read it.

## Rebuild

```bash
# 1. (only to refresh the screens) local stack, sample data, capture
npx supabase start
npm run qa:local-login
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f marketing/showreel/capture/seed-demo.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f marketing/showreel/capture/seed-story.sql
echo LOCAL_UI_QA_BYPASS=true >> .env.local   # local-only quick access for the staff side
npm run dev
node marketing/showreel/capture/capture-story.mjs

# 2. frames + soundtrack
cd marketing/showreel
CHROMIUM_PATH=/path/to/chrome node render.mjs   # -> out/frames.mp4 (~12 min)
python3 audio/mix.py                            # -> out/soundtrack.wav + final MP4
```

`node render.mjs --stills 29.6,46.3` renders single frames. When the folder is served
through `render.mjs`, `index.html?t=29.6` inspects one frame and `?play` runs it in real time.

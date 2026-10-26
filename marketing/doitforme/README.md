# DoItForMe — app-flow video (October 2026 team presentation)

For the slide "SECOND WIN – Built the tool called DoItForMe".

- `doitforme-app-flow.mp4` — 42s, 1920×1080, 30 fps, H.264, silent (captions only).
- `doitforme-result-slide.png` — 1920×1080 still of scene 7 (result), for use as a slide image.

| Time | Scene | Caption |
| --- | --- | --- |
| 0–3s | Hook | Before: every client site checked by hand. No proof anything was fixed. |
| 3–8s | Audit: URL types in, crawl bar fills, counter to 501 | 1. Audit – crawls the whole site in minutes |
| 8–13s | Findings drop into RED (needs a human) and YELLOW (approve) | 2. Finds what's broken – and sorts what a robot can fix |
| 13–18s | Title draft, 70 → 56 characters | 3. Drafts the fix |
| 18–22s | Cursor ticks "Approve this exact value" | 4. A human approves – nothing changes without it |
| 22–28s | Cards flip YELLOW → GREEN, "Verified live" | 5. Applies it, then proves it on the live page |
| 28–34s | 2 issue types → 0, 96 fixes verified in one day | Real result: one client site, one day |
| 34–39s | By hand ~18 hours vs DoItForMe ~30 minutes | (footnote: manual time estimated; tool time measured) |
| 39–42s | DoItForMe – Audit. Fix. Verify. | — |

The only numbers on screen are the ones from the brief. The UI cards are generic mockups.
The sample page title ("… | Example Co") is fictional: the 70-character draft loses
"Fast " and " Plumbers" to become the 56-character fix.

Rebuild (the composition is `index.html`; every frame is a pure function of time):

```bash
CHROMIUM_PATH=/path/to/chrome node marketing/doitforme/render.mjs            # MP4
CHROMIUM_PATH=/path/to/chrome node marketing/doitforme/render.mjs --slide 33.4  # slide PNG
```

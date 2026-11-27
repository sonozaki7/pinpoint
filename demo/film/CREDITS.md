# Pinpoint demo v3 — credits and licenses

Everything in `demo/out/pinpoint-demo-v3.mp4` is either recorded on this Mac
from the project's own app, drawn in Remotion for this film, or one
free-license photo. No third-party brand assets or music; the only stock asset
is the photo below.

## Photo

| File | What | Source | License | Used |
|---|---|---|---|---|
| `public/stills/train-window.jpg` | Blurred city street through a train window, no recognisable faces or logos | [Pexels photo 30332689](https://www.pexels.com/photo/view-of-urban-street-through-a-train-window-30332689/) by Arseny Kosterin | [Pexels License](https://www.pexels.com/license/) — free to use, modify, and publish, no attribution required | Background POV in scenes 2 and 5; darkened 45% and blurred in the edit |

Downloaded 2026-11-27 at 2400×1600 from the Pexels CDN. The license page was
checked on the same day. No identifiable person is the subject; the tiny
figures in the distance are not recognisable at the delivered size.

## Type

| Asset | Source | License |
|---|---|---|
| Inter Variable (`public/fonts/InterVariable.woff2`, also loaded via `@fontsource-variable/inter`) | [Inter by Rasmus Andersson](https://rsms.me/inter/) | SIL Open Font License 1.1 |

## Voice

| Asset | Source | License |
|---|---|---|
| Kokoro-82M (`demo/film/.models/kokoro-v1.0.onnx`, `.models/voices-v1.0.bin`) — narrator `af_heart`, user note `am_michael` | [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via `kokoro-onnx` | Apache-2.0 |
| Voice processing | local ffmpeg only; nothing sent to a speech service | — |

## Footage

The glasses screen is the real Pinpoint app running in the official Even Hub
simulator against the real demo server, recorded with
`demo/scripts/record-sim.mjs` from the frozen checkout `ebc1251`. The clips are
`demo/recordings/simple-{plan,payment,inbox}.mp4` and the copies used by the
film are in `public/clips/`. The inbox order and scripted voice notes were the
only recording aids; they live in the frozen checkout, not in the product.

The Telegram view in scene 7 is a **designed reconstruction** of a Telegram
chat, not a screen capture. The available real capture
(`demo/recordings/telegram-quotes.png`) shows the earlier technical plan, which
this cut must not show; the phone is labelled "Telegram · sample workspace" on
screen. It uses the same review text the server composed for this run.

## Music

None. The film is voice-only, so there is no music license to clear.

## Icons

The Pinpoint mark is drawn from the project's own `apps/site/favicon.svg`
geometry. The ring, arrow, pulses, and microphone are original line art made
for this film. No Even, Telegram, or other brand icon files are bundled.


---

# Final cut (`demo/out/pinpoint-demo-final.mp4`) — additions

## POV photos (Pexels License: free to use and modify, no attribution required; credited anyway)

| File in `public/stills/final/` | Pexels photo | Photographer (Pexels profile) | Used for |
|---|---|---|---|
| `walk-street.jpg` | [Empty Urban Street with Modern Buildings at Dawn, 31846889](https://www.pexels.com/photo/empty-urban-street-with-modern-buildings-at-dawn-31846889/) | Dr. Mohammad Hoque (@dr-mohammad-hoque-86842308) | Morning walk, first POV |
| `walk-crossing.jpg` | [Pedestrian Crossing in Partially Sun Shadow, 17318333](https://www.pexels.com/photo/pedestrian-crossing-in-partially-sun-shadow-17318333/) | Alvin Chelsea (@alvin-chelsea-230969113) | Morning walk, second POV |
| `cafe.jpg` | [Cup of Coffee on a Table by the Window Facing the Street in a Cafe, 5865683](https://www.pexels.com/photo/cup-of-coffee-on-a-table-by-the-window-facing-the-street-in-a-cafe-5865683/) | Rachel Claire (@rachel-claire) | Everyday, café POV |

Each is cropped to 16:9 and darkened and tinted in the edit. No identifiable person is the subject. Photographer names are as listed on each Pexels page (checked 2026-11-27).

## Footage and proofs

- **Glasses footage**: the official Even Hub simulator 0.9.5 running the real Pinpoint glasses app from the frozen commit `3be2c16` ("Glasses final"), against the real Pinpoint server in its built-in sample workspace (`PINPOINT_MODE=cloud`, scripted voice). Recorded with `demo/scripts/record-final.mjs`. The simulator cannot send the OS hold-menu choice, so `demo/scripts/apply-record-aid.mjs` adds a ~20-line file-poll to the frozen copy that delivers the same `menu` event (and the wear on/off); the film draws the hold menu itself and says so on screen.
- **Real T3 Code runs** (project pinpoint, Codex): `src/pinpoint-final/t3-real.json`.
- **Real Notion, Gmail, Telegram** screenshots: `public/proof/`.
- The landlord line is changed by the server's AI fallback (DeepSeek API, key from the owner's own `.env`, never shown).
- Voices: Kokoro-82M (Apache-2.0), `af_heart` narrator and `am_michael` for the spoken notes. No music.

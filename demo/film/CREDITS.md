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

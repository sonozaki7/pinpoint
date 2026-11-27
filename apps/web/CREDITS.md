# Credits and licenses

Everything on https://pinpoint.qolso.com that we did not write ourselves.

## Imagery

| Asset | Source | License |
|---|---|---|
| `apps/site/media/scene/bryanston-park-sunrise-1k.hdr` (lighting and reflections in the 3D hero) | "Bryanston Park Sunrise" by Dario Barresi, [Poly Haven](https://polyhaven.com/a/bryanston_park_sunrise) | CC0 1.0 (public domain) |
| `apps/site/media/scene/outdoor-scene.jpg` (the softly blurred backdrop behind the 3D glasses) | Tone-mapped, downsized and blurred from the same Poly Haven HDRI | CC0 1.0 |
| `apps/site/media/scene/pov-outdoor.jpg` (the outdoor view in "Put them on") | A cropped, softly blurred still of the same Poly Haven HDRI | CC0 1.0 |
| `apps/site/media/scene/hero-poster*.jpg` (fallback for no WebGL, reduced motion, low power) | Rendered from our own 3D scene (`apps/web/src/scene/hero.ts`) over the same HDRI | CC0 1.0 for the HDRI; the scene is ours |

CC0 needs no attribution; we credit Poly Haven and Dario Barresi anyway.

## Our own designs

The glasses, the ring and the hand are drawn by us (no logos, not a copy of any product photo):
`apps/web/src/scene/hero.ts` (three.js geometry and materials) and `apps/web/src/pov/hand.svg`.
The glasses display is the real Pinpoint glasses app screen, painted by `apps/web/src/scene/display.ts`.

## Typefaces (SIL Open Font License 1.1)

- Instrument Serif (Rodrigo Fuenzalida, Jordan Egstad)
- Inter (Rasmus Andersson)
- IBM Plex Mono (IBM)

## Libraries

| Package | License |
|---|---|
| [three](https://github.com/mrdoob/three.js) 0.187.0 | MIT |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (build-time only) | MIT |
| [Vite](https://vite.dev) and TypeScript (build-time only) | MIT / Apache-2.0 |

## Trademarks

Even Realities, G2, R1, T3 Code, Notion, Gmail, Google and Telegram belong to their owners.
Pinpoint is not affiliated with or endorsed by any of them; the names say what Pinpoint works with.

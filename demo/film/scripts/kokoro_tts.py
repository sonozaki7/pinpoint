#!/usr/bin/env python3
"""Kokoro TTS helper for the Pinpoint film.

Reads a JSON job: {model, voices, voice, speed, lang, result, lines:[{id,text,out}]}
Writes one 24 kHz mono PCM16 wav per line and a JSON result with durations.

The model is Apache-2.0 (hexgrad/Kokoro-82M), served by kokoro-onnx. This runs
entirely on this Mac; nothing is sent to a service.
"""

import json
import sys
import time

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro


def trim(samples: np.ndarray, sr: int) -> np.ndarray:
    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if x.size == 0:
        return x
    peak = float(np.max(np.abs(x)))
    if peak <= 0:
        return x
    threshold = max(0.006, peak * 0.012)
    loud = np.flatnonzero(np.abs(x) > threshold)
    if loud.size == 0:
        return x
    start = max(0, int(loud[0]) - int(0.035 * sr))
    end = min(x.size, int(loud[-1]) + int(0.09 * sr))
    return x[start:end]


def main() -> int:
    job = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    kokoro = Kokoro(job["model"], job["voices"])
    results = []
    for line in job["lines"]:
        started = time.time()
        samples, sr = kokoro.create(
            line["text"],
            voice=job["voice"],
            speed=float(job.get("speed", 1.0)),
            lang=job.get("lang", "en-us"),
        )
        x = trim(samples, sr)
        sf.write(line["out"], x, sr, subtype="PCM_16")
        seconds = len(x) / sr
        results.append({"id": line["id"], "seconds": round(seconds, 4), "sampleRate": sr, "genSeconds": round(time.time() - started, 2)})
        print(f"{line['id']:<12} {seconds:6.2f}s", flush=True)
    json.dump(results, open(job["result"], "w", encoding="utf-8"), indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

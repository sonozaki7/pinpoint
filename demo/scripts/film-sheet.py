#!/usr/bin/env python3
"""Time-labelled contact sheet of a video: film-sheet.py video.mp4 out.png --every 3 [--from 0 --to 999] [--cols 4] [--width 480]
Each frame is labelled with its time (m:ss). Needs ffmpeg."""
import argparse, os, subprocess, tempfile, math
ap = argparse.ArgumentParser()
ap.add_argument("video"); ap.add_argument("out")
ap.add_argument("--every", type=float, default=3); ap.add_argument("--from", dest="t0", type=float, default=0)
ap.add_argument("--to", dest="t1", type=float, default=1e9); ap.add_argument("--cols", type=int, default=4); ap.add_argument("--width", type=int, default=480)
ap.add_argument("--times", default="")
a = ap.parse_args()
dur = float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",a.video]).decode())
if a.times: times = [float(x) for x in a.times.split(",")]
else:
    times = []; t = a.t0
    while t < min(a.t1, dur - 0.05): times.append(t); t += a.every
h = round(a.width * 9 / 16)
tmp = tempfile.mkdtemp()
inputs, chains = [], []
for i, t in enumerate(times):
    f = os.path.join(tmp, f"{i:03d}.png")
    subprocess.check_call(["ffmpeg","-loglevel","error","-y","-ss",f"{t:.2f}","-i",a.video,"-frames:v","1","-vf",f"scale={a.width}:{h}",f])
    inputs += ["-i", f]
    label = f"{int(t//60)}\\:{int(t%60):02d}"
    chains.append(f"[{i}]drawtext=text='{label}':x=6:y=6:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=4[f{i}]")
rows = math.ceil(len(times) / a.cols)
layout = "|".join(f"{(i%a.cols)*a.width}_{(i//a.cols)*h}" for i in range(len(times)))
fc = ";".join(chains) + ";" + "".join(f"[f{i}]" for i in range(len(times))) + f"xstack=inputs={len(times)}:layout={layout}[o]"
subprocess.check_call(["ffmpeg","-loglevel","error","-y",*inputs,"-filter_complex",fc,"-map","[o]","-frames:v","1","-update","1",a.out])
print(a.out, len(times), "frames")

#!/usr/bin/env bash
# Turns recorded simulator frames (green-on-transparent RGBA PNGs, 576x288)
# into an mp4: composited on black, nearest-neighbour 2x (1152x576), 30 fps.
#
#   demo/scripts/frames-to-mp4.sh --root demo/shots/tmp --all
#   demo/scripts/frames-to-mp4.sh --root demo/shots/tmp --scene auth
#   demo/scripts/frames-to-mp4.sh --scene auth --fps 10 --grain --crf 16
#
# Input:  <root>/<scene>/00001.png ... plus <root>/<scene>/meta.json (fps)
# Output: <out>/<scene>.mp4 and, with --all, <out>/hero.mp4 (scenes joined in
#         --order). Defaults: --out demo/shots/tmp/out.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
root="$repo/demo/shots/tmp"
out=""
scenes=""
all_done=0
fps=""
crf="18"
order="inbox,auth,deps,inbox-morning"
audio=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) root="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --scene) scenes="${scenes:+$scenes,}$2"; shift 2 ;;
    --all) all_done=1; shift ;;
    --fps) fps="$2"; shift 2 ;;
    --crf) crf="$2"; shift 2 ;;
    --order) order="$2"; shift 2 ;;
    --audio) audio="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

command -v ffmpeg >/dev/null || { echo "ffmpeg is not installed" >&2; exit 1; }

abspath() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
root="$(abspath "$root")"

if [[ -z "$out" ]]; then out="$root/out"; fi
out="$(abspath "$out")"
mkdir -p "$out"

scene_fps() { # scene_fps <scene> -> fps from meta.json, or --fps, or 10
  local scene="$1" meta="$root/$1/meta.json"
  if [[ -n "$fps" ]]; then printf '%s' "$fps"; return; fi
  if [[ -f "$meta" ]]; then
    node -e 'const m=require(process.argv[1]);const f=Number(m.fps)||10;process.stdout.write(String(Math.max(1,Math.round(f*100)/100)))' "$meta" 2>/dev/null && return
  fi
  printf '10'
}

render_scene() { # render_scene <scene> -> mp4 in $out
  local scene="$1" dir="$root/$1" rate
  [[ -d "$dir" ]] || { echo "no frames for scene '$scene' in $dir" >&2; return 1; }
  if ! ls "$dir"/[0-9][0-9][0-9][0-9][0-9].png >/dev/null 2>&1; then
    echo "no PNG frames in $dir" >&2; return 1
  fi
  rate="$(scene_fps "$scene")"
  echo "== $scene: $(ls "$dir"/[0-9][0-9][0-9][0-9][0-9].png | wc -l | tr -d ' ') frames, ${rate} fps in, 30 fps out"
  # bg = black canvas, fg = RGBA frame; overlay keeps the alpha, so green text
  # stays green on black. Scale with neighbour so glyph edges stay crisp.
  ffmpeg -hide_banner -loglevel error -y \
    -framerate "$rate" -start_number 1 -i "$dir/%05d.png" \
    -f lavfi -i "color=c=black:s=576x288:r=$rate" \
    -filter_complex "[0:v]format=rgba[fg];[1:v][fg]overlay=shortest=1:format=auto,scale=1152:576:flags=neighbor,fps=30,format=yuv420p[v]" \
    -map "[v]" -c:v libx264 -preset medium -crf "$crf" -pix_fmt yuv420p -movflags +faststart \
    "$out/$scene.mp4"
}

if [[ "$all_done" -eq 1 ]]; then
  IFS=',' read -ra wanted <<< "$order"
else
  [[ -n "$scenes" ]] || { echo "give --scene <name> or --all" >&2; exit 2; }
  IFS=',' read -ra wanted <<< "$scenes"
fi

rendered=()
for scene in "${wanted[@]}"; do
  scene="$(echo "$scene" | tr -d ' ')"
  [[ -z "$scene" ]] && continue
  if [[ -d "$root/$scene" ]]; then
    render_scene "$scene"
    rendered+=("$scene")
  elif [[ "$all_done" -eq 1 ]]; then
    echo "-- skipping $scene (not recorded)" >&2
  else
    echo "no frames for scene '$scene'" >&2
  fi
done

if [[ "$all_done" -eq 1 && ${#rendered[@]} -gt 0 ]]; then
  list="$(mktemp)"
  for scene in "${rendered[@]}"; do
    echo "file '$out/$scene.mp4'" >> "$list"
  done
  concat_args=(-f concat -safe 0 -i "$list")
  if [[ -n "$audio" ]]; then
    ffmpeg -hide_banner -loglevel error -y "${concat_args[@]}" -i "$audio" \
      -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "$out/hero.mp4"
  else
    ffmpeg -hide_banner -loglevel error -y "${concat_args[@]}" -c copy -movflags +faststart "$out/hero.mp4"
  fi
  rm -f "$list"
  echo "== hero: $out/hero.mp4 (${rendered[*]})"
fi

echo
ls -lh "$out"/*.mp4 2>/dev/null || true

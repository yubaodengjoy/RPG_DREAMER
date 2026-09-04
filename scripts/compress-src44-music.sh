#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
assets="$root/src-44/src/dist/assets"
ffmpeg_bin="${FFMPEG_BIN:-ffmpeg}"

if ! command -v "$ffmpeg_bin" >/dev/null 2>&1; then
  if [[ -x /mnt/c/ffmpeg/bin/ffmpeg.exe ]]; then
    ffmpeg_bin=/mnt/c/ffmpeg/bin/ffmpeg.exe
  else
    echo "FFmpeg was not found. Set FFMPEG_BIN to its executable path." >&2
    exit 1
  fi
fi

tracks=(
  town-loop-CWHGv1M9
  grove-loop-B4cTFNMX
  battle-loop-DENyJQgL
)

for track in "${tracks[@]}"; do
  "$ffmpeg_bin" -hide_banner -loglevel error -y \
    -i "$assets/$track.wav" \
    -map_metadata -1 -vn -c:a libmp3lame -b:a 96k -ar 44100 \
    "$assets/$track.mp3"
done

mapfile -t bundles < <(find "$assets" -maxdepth 1 -type f -name 'index-*.js')
if [[ ${#bundles[@]} -ne 1 ]]; then
  echo "Expected one entry bundle in $assets; found ${#bundles[@]}." >&2
  exit 1
fi

perl -pi -e '
  s/town-loop-CWHGv1M9\.wav/town-loop-CWHGv1M9.mp3/g;
  s/grove-loop-B4cTFNMX\.wav/grove-loop-B4cTFNMX.mp3/g;
  s/battle-loop-DENyJQgL\.wav/battle-loop-DENyJQgL.mp3/g;
' "${bundles[0]}"

echo "Compressed the three large src-44 music loops to 96 kbps MP3."

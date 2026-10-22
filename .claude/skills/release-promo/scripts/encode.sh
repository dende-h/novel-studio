#!/usr/bin/env bash
# 録画したコマ（startRecording が書いた frames.txt）を X に載せる mp4 にする（release-promo スキル）。
#   使い方: encode.sh <録画フォルダ> [出力ファイル]
# H.264・yuv420p・30fps・faststart（X と note でそのまま再生できる形）。音は付けない。
# あわせて 3 秒おきの一覧画像 tile.png を作る（中身の確認用）。
set -euo pipefail

DIR="${1:?録画フォルダを指定してください}"
OUT="${2:-$DIR/promo.mp4}"
cd "$DIR"
[ -f frames.txt ] || { echo "frames.txt がありません（録画が終わっていない？）" >&2; exit 1; }

ffmpeg -v error -y -f concat -safe 0 -i frames.txt \
  -vf "fps=30,format=yuv420p" -c:v libx264 -preset slow -crf 18 -movflags +faststart "$OUT"
ffmpeg -v error -y -i "$OUT" -vf "fps=1/3,scale=640:-1,tile=4x4" -frames:v 1 tile.png
ffprobe -v error -show_entries stream=width,height,r_frame_rate:format=duration,size -of compact "$OUT"
echo "一覧画像: $DIR/tile.png"

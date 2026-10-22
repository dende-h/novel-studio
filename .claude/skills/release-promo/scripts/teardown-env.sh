#!/usr/bin/env bash
# 撮影用の一時コピーを片付ける（release-promo スキル）。
#   使い方: teardown-env.sh <作業フォルダ>
# 5174 番の vite を止め、worktree を消す。撮った画像や動画は消さない。
set -uo pipefail

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WORK="${1:?作業フォルダを指定してください}"

PID="$(ss -ltnp 2>/dev/null | grep ':5174 ' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)"
if [ -n "$PID" ]; then
  kill "$PID" && echo "vite を止めた（pid $PID）"
fi
if [ -e "$WORK/wt" ]; then
  git -C "$REPO" worktree remove --force "$WORK/wt" && echo "worktree を消した"
fi
git -C "$REPO" worktree prune
rm -rf "$WORK/video/frames"

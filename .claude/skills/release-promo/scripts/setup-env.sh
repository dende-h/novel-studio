#!/usr/bin/env bash
# 撮影用の一時コピーを作る（release-promo スキル）。
#   使い方: setup-env.sh <作業フォルダ> [git の参照（既定: HEAD）]
# - <作業フォルダ>/wt に git worktree を切り、会員判定だけを外す（ゲストのまま有料・無料登録の画面を撮るため）
# - node_modules と解析辞書（public/dict）は本体へのリンクで済ませる
# - vite を 5174 番で起こす設定 vite.promo.config.ts を置く（起動は呼び出し側で、バックグラウンドに）
# 本体の作業ツリーは書き換えない。片付けは teardown-env.sh。
set -euo pipefail

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WORK="${1:?作業フォルダを指定してください}"
REF="${2:-HEAD}"
WT="$WORK/wt"

mkdir -p "$WORK"
if [ -e "$WT" ]; then
  echo "既に $WT があります。teardown-env.sh で片付けてから作り直してください" >&2
  exit 1
fi
git -C "$REPO" worktree add --detach "$WT" "$REF" >/dev/null
git -C "$WT" log --oneline -1

ln -s "$REPO/node_modules" "$WT/node_modules"
if [ -d "$REPO/public/dict" ]; then
  ln -s "$REPO/public/dict" "$WT/public/dict"
else
  echo "注意: public/dict がありません（本体で node scripts/fetch-dict.mjs を回して取ってから。無いと推敲の「くわしい確認」が使えない）" >&2
fi

# 会員判定を外す（見つからなければ知らせる。判定の場所が変わったらここを直す）
patch() {
  local file="$1" from="$2" to="$3"
  if grep -qF "$from" "$WT/$file"; then
    sed -i "s/$(printf '%s' "$from" | sed 's/[][\/.*^$]/\\&/g')/$to/" "$WT/$file"
    echo "外した: $file"
  else
    echo "見つからない（判定の書き方が変わった？）: $file — $from" >&2
  fi
}
patch src/ui/Root.tsx "const canUseCreativeTools = status === 'free' || status === 'member'" "const canUseCreativeTools = true"
patch src/ui/components/ExportDialog/export-dialog.tsx "const gameUnlocked = auth.status === 'free' || auth.status === 'member'" "const gameUnlocked = true"

cat > "$WT/vite.promo.config.ts" <<EOF
import { mergeConfig } from 'vite'
import base from './vite.config'
export default mergeConfig(base, {
  server: { port: 5174, strictPort: true, fs: { allow: ['$REPO', '.'] } },
})
EOF

cat <<EOF
準備できました。vite はバックグラウンドで起こしてください:
  cd "$WT" && VITE_CLERK_PUBLISHABLE_KEY= ./node_modules/.bin/vite --config vite.promo.config.ts
起動の確認: curl -s -o /dev/null -w '%{http_code}' localhost:5174  （200 になるまで待つ）
EOF

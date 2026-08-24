#!/usr/bin/env bash
# fixtures/ に対する検出件数の回帰チェック。
# ルール・辞書・fixture を意図的に変えたら、下の期待値を更新すること。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

EXPECTED_NOVEL_BAD=13
EXPECTED_NOVEL_GOOD=0
EXPECTED_COPY_BAD=9

count() {
  local config="$1" file="$2"
  pnpm exec textlint --config "$config" --format json "$file" 2>/dev/null |
    node -e "
      let s = ''
      process.stdin.on('data', (c) => { s += c })
      process.stdin.on('end', () => {
        const results = JSON.parse(s)
        console.log(results.reduce((n, r) => n + r.messages.length, 0))
      })
    " || true
}

fail=0
check() {
  local label="$1" expected="$2" actual="$3"
  if [ "${actual}" != "${expected}" ]; then
    echo "FAIL: ${label}: expected ${expected}, got ${actual}" >&2
    fail=1
  else
    echo "OK: ${label}: ${actual} findings"
  fi
}

check "novel-bad.txt" "${EXPECTED_NOVEL_BAD}" "$(count .textlintrc.novel.json fixtures/novel-bad.txt)"
check "novel-good.txt" "${EXPECTED_NOVEL_GOOD}" "$(count .textlintrc.novel.json fixtures/novel-good.txt)"
check "copy-bad.txt" "${EXPECTED_COPY_BAD}" "$(count .textlintrc.copy.json fixtures/copy-bad.txt)"

if [ "${fail}" -ne 0 ]; then
  echo "fixture regression check FAILED" >&2
  exit 1
fi
echo "fixture regression check PASSED"

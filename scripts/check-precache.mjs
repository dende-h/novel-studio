#!/usr/bin/env node
// build 後の dist/sw.js のプリキャッシュに、推敲画面の解析器（.wasm）と辞書（dict/）が入っていないことを確かめる（COT-40）。
// 入っていれば、執筆画面しか使わない人にも十数 MB を配ることになるので終了コード 1。
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sw = readFileSync(join(root, 'dist', 'sw.js'), 'utf8')
// generateSW はプリキャッシュを {url:"…",revision:…} の並びで埋め込む。runtimeCaching の関数本体は見ない。
const urls = [...sw.matchAll(/\{url:"([^"]+)"/g)].map((m) => m[1])
if (urls.length === 0) {
  console.error('[check-precache] dist/sw.js からプリキャッシュの一覧を読めませんでした')
  process.exit(1)
}
const bad = urls.filter((u) => u.endsWith('.wasm') || u.startsWith('dict/') || u.includes('/dict/'))
if (bad.length > 0) {
  console.error(`[check-precache] プリキャッシュに入れてはいけないファイルがあります: ${bad.join(', ')}`)
  process.exit(1)
}
console.log(`[check-precache] OK（${urls.length} 件・.wasm と dict/ は無し）`)

#!/usr/bin/env node
// 推敲画面の形態素解析に使う辞書の zip を public/dict/ に置く（COT-40・COT-59）。
//
// - 辞書は IPADIC 6.2.0 に SudachiDict の今の言葉を足して作り直したもの（scripts/build-dict.mjs で作り、
//   このリポジトリの GitHub Release に置いた）。lindera-wasm（package.json）と同じ版の形式にそろえること
//   （6.x の間に辞書の形式が変わった前例がある：dict.da → dict.trie + dict.valsidx）。
// - URL とハッシュはここで固定する。名前は scripts/dict-file.mjs と共有する。
// - 既にあってハッシュが合えば何もしない。取れない・ハッシュが違えば終了コード 1（黙って辞書なしで出さない）。
// - `--optional` を付けると、取れないときは警告だけで終了コード 0（dev・test 用。build は付けない）。
// - ライセンス表記を public/dict/ に取り出す：NOTICE.txt → NOTICE-ipadic.txt、NOTICE-sudachidict.txt はそのまま。
// - public/dict/ の別の名前の zip（前の版）は消す。手元のビルドに古い辞書を混ぜないため。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { DICT_FILE } from './dict-file.mjs'

const DICT_URL = `https://github.com/dende-h/novel-studio/releases/download/dict-ipadic-sudachi-20260723/${DICT_FILE}`
const DICT_SHA256 = '088546a5a78fa4b69fe1967b81b64677b4cd4877d85c8a3c8fbf3ea86969a3b7'
/** zip の中のライセンス表記 → public/dict/ での名前。 */
const NOTICES = [
  ['lindera-ipadic/NOTICE.txt', 'NOTICE-ipadic.txt'],
  ['lindera-ipadic/NOTICE-sudachidict.txt', 'NOTICE-sudachidict.txt'],
]

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'dict')
const zipPath = join(outDir, DICT_FILE)
const optional = process.argv.includes('--optional')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** zip の中の1エントリを取り出す（中央ディレクトリを読む最小実装。stored と deflate のみ）。 */
function extractEntry(zip, name) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('zip の終端が見つかりません')
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10)
    const size = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const entry = zip.toString('utf8', p + 46, p + 46 + nameLen)
    if (entry === name) {
      const lNameLen = zip.readUInt16LE(local + 26)
      const lExtraLen = zip.readUInt16LE(local + 28)
      const start = local + 30 + lNameLen + lExtraLen
      const data = zip.subarray(start, start + size)
      return method === 0 ? data : inflateRawSync(data)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`${name} が zip にありません`)
}

function fail(message) {
  if (optional) {
    console.warn(`[fetch-dict] ${message}（--optional のため続行。推敲画面のくわしい確認は使えません）`)
    process.exit(0)
  }
  console.error(`[fetch-dict] ${message}`)
  process.exit(1)
}

function writeNotices(zip) {
  for (const [entry, name] of NOTICES) {
    const path = join(outDir, name)
    if (!existsSync(path)) writeFileSync(path, extractEntry(zip, entry))
  }
}

/** 前の版の zip を消す（いまの名前のものだけを残す）。 */
function removeOldZips() {
  if (!existsSync(outDir)) return
  for (const name of readdirSync(outDir)) {
    if (name.endsWith('.zip') && name !== DICT_FILE) rmSync(join(outDir, name))
  }
}

async function main() {
  removeOldZips()
  if (existsSync(zipPath) && sha256(readFileSync(zipPath)) === DICT_SHA256) {
    writeNotices(readFileSync(zipPath))
    return
  }
  let buf
  try {
    const res = await fetch(DICT_URL, { redirect: 'follow' })
    if (!res.ok) return fail(`辞書を取得できませんでした（HTTP ${res.status}）: ${DICT_URL}`)
    buf = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    return fail(`辞書を取得できませんでした: ${e instanceof Error ? e.message : String(e)}`)
  }
  const got = sha256(buf)
  if (got !== DICT_SHA256) return fail(`辞書のハッシュが一致しません（期待 ${DICT_SHA256}・実際 ${got}）`)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(zipPath, buf)
  for (const [, name] of NOTICES) rmSync(join(outDir, name), { force: true })
  writeNotices(buf)
  console.log(`[fetch-dict] ${DICT_FILE} を public/dict/ に置きました`)
}

await main()

#!/usr/bin/env node
// 推敲画面の形態素解析に使う IPADIC 辞書（Lindera 配布の zip）を public/dict/ に置く（COT-40）。
//
// - 版とハッシュはここで固定する。lindera-wasm（package.json）と同じ版にそろえること
//   （6.x の間に辞書の形式が変わった前例がある：dict.da → dict.trie + dict.valsidx）。
// - 既にあってハッシュが合えば何もしない。取れない・ハッシュが違えば終了コード 1（黙って辞書なしで出さない）。
// - `--optional` を付けると、取れないときは警告だけで終了コード 0（dev・test 用。build は付けない）。
// - NOTICE.txt（IPADIC のライセンス表記）を public/dict/NOTICE-ipadic.txt に取り出す。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

export const DICT_VERSION = '6.2.0'
export const DICT_FILE = `lindera-ipadic-${DICT_VERSION}.zip`
const DICT_URL = `https://github.com/lindera/lindera/releases/download/v${DICT_VERSION}/${DICT_FILE}`
const DICT_SHA256 = '5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72'
const NOTICE_ENTRY = 'lindera-ipadic/NOTICE.txt'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'dict')
const zipPath = join(outDir, DICT_FILE)
const noticePath = join(outDir, 'NOTICE-ipadic.txt')
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

async function main() {
  if (existsSync(zipPath) && sha256(readFileSync(zipPath)) === DICT_SHA256) {
    if (!existsSync(noticePath)) writeFileSync(noticePath, extractEntry(readFileSync(zipPath), NOTICE_ENTRY))
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
  writeFileSync(noticePath, extractEntry(buf, NOTICE_ENTRY))
  console.log(`[fetch-dict] ${DICT_FILE} を public/dict/ に置きました`)
}

await main()

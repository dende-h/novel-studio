#!/usr/bin/env node
// 推敲画面の解析辞書を作り直す（COT-59）。IPADIC に SudachiDict の今の言葉（普通名詞）を足して zip にする。
// 手で回す（CI では回さない）。できた zip はこのリポジトリの GitHub Release に置き、scripts/fetch-dict.mjs が
// ハッシュを固定して取る。版を上げるときは下の定数を替えて回し、出たハッシュを fetch-dict.mjs に写す。
//   node scripts/build-dict.mjs            → public/dict/<DICT_FILE> を作る
//   node scripts/build-dict.mjs --out <p>  → 置き場所を変える
//
// 手順:
//   1. 固定した元データを取り、SHA-256 を照合する（IPADIC のソース・SudachiDict の small/core・lindera CLI）
//   2. lindera CLI で IPADIC をそのまま作り直す（公式の辞書とバイト単位で一致することを確かめる）
//   3. その辞書を lindera-wasm で引き、SudachiDict の普通名詞の区切られ方を調べて、足す語を選ぶ
//      （選び方は src/core/proofread/morph/dict-supplement.ts。Node の型除去でそのまま読む）
//   4. 足す語を Sudachi.csv として IPADIC のソースに加え、もう一度 lindera build する
//   5. NOTICE（IPADIC・SudachiDict）を入れて zip にし、13MB を超えたら失敗で止める
// 元データと作業ファイルは node_modules/.cache/build-dict/ に置く（2回目以降は取り直さない）。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { crc32, deflateRawSync, gunzipSync, inflateRawSync } from 'node:zlib'
import { DICT_FILE } from './dict-file.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = join(root, 'node_modules', '.cache', 'build-dict')
const outArg = process.argv.indexOf('--out')
const outPath = outArg > 0 ? resolve(process.argv[outArg + 1]) : join(root, 'public', 'dict', DICT_FILE)

const LINDERA_VERSION = '6.2.0'
const SUDACHI_VERSION = '20260723'
const SOURCES = {
  ipadic: {
    url: 'https://Lindera.dev/mecab-ipadic-2.7.0-20250920.tar.gz',
    sha256: 'a7ba9f645ffe7094e56ae1c4a81d100df8fbb1e28bbe1792622e9728e162db3d',
  },
  small: {
    url: `http://sudachi.s3-website-ap-northeast-1.amazonaws.com/sudachidict-raw/v0/${SUDACHI_VERSION}/small_lex.zip`,
    sha256: 'b578ac9545899783d5d7e30d5d78d5d9dcf40b36965d4af0663ec2eb041c1093',
  },
  core: {
    url: `http://sudachi.s3-website-ap-northeast-1.amazonaws.com/sudachidict-raw/v0/${SUDACHI_VERSION}/core_lex.zip`,
    sha256: 'a2b39e1572adab08a649b1390b134517adc55f1d733c59358b113298788bf31c',
  },
  cli: {
    url: `https://github.com/lindera/lindera/releases/download/v${LINDERA_VERSION}/lindera-x86_64-unknown-linux-gnu-${LINDERA_VERSION}.zip`,
    sha256: '5d337f211a409e4b2fbfbfaef3e8603ec5c956cef522820f95b027f50d709b19',
  },
}
/** 公式の lindera-ipadic-6.2.0.zip の中身。手順2で作り直した辞書がこれと一致することを確かめる。 */
const OFFICIAL_SHA256 = {
  'metadata.json': '305addfbf05e41d985a1541035c79a7b6f8ae254e4bc94f1721be21adf31068f',
  'dict.trie': 'b176188057bbd78fa73c2161db1f00fbabf9afbc3471732c4b549bf707413dfb',
  'dict.valsidx': 'f1b17f1c4682a5bd42dabe95ab7cefb461c888b839a18d213dd5c7133d3a1a76',
  'dict.vals': '62af946542a17c4f16cf1122cb069b5d26f7cf652066b3b846cc4c230b6a8aa1',
  'dict.wordsidx': 'a38e0b55d6e0fa67555078f8beb6f634f264b2a6b2ea2c9a7aa111f085ada721',
  'dict.words': 'fc1d924e12af84a352feccce35b772383322760ee2b3da4be0e173ad82953938',
  'matrix.mtx': '915733be6589bee90b8f2af5cd314c384a1f9a2fc3af498384555986447b168b',
  'char_def.bin': 'ef37cf70d7e72ec023bec8e632783a6fe255b2d5fd1bce22600b595fccae48b1',
  'unk.bin': '3eeebe0ef3f8907be325aa3acb0ccbd4ccb6f5ac20ff3dd0742ff1af1c468da6',
}
const DICT_FILES = Object.keys(OFFICIAL_SHA256)
const MAX_ZIP_BYTES = 13 * 1000 * 1000

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const log = (msg) => console.log(`[build-dict] ${msg}`)

async function fetchPinned(name) {
  const { url, sha256: want } = SOURCES[name]
  const path = join(cache, 'src', url.split('/').pop())
  if (existsSync(path) && sha256(readFileSync(path)) === want) return readFileSync(path)
  log(`取得: ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`取得できませんでした（HTTP ${res.status}）: ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256(buf)
  if (got !== want) throw new Error(`ハッシュが一致しません（${name}・期待 ${want}・実際 ${got}）`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buf)
  return buf
}

/** zip の全エントリ（stored と deflate のみ）。 */
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('zip の終端が見つかりません')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map()
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    if (!name.endsWith('/')) out.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** tar.gz を展開する（先頭のディレクトリを外す・通常のファイルだけ）。 */
function untarGz(buf, dest) {
  const tar = gunzipSync(buf)
  let p = 0
  while (p + 512 <= tar.length) {
    const header = tar.subarray(p, p + 512)
    if (header.every((b) => b === 0)) break
    const field = (from, len) => header.toString('utf8', from, from + len).replace(/\0.*$/su, '')
    const name = (field(345, 155) ? `${field(345, 155)}/` : '') + field(0, 100)
    const size = Number.parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1)
    const body = tar.subarray(p + 512, p + 512 + size)
    const rel = name.split('/').slice(1).join('/')
    if ((type === '0' || type === '') && rel) {
      const path = join(dest, rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, body)
    }
    p += 512 + Math.ceil(size / 512) * 512
  }
}

/** CSV の1行を列に分ける（ダブルクォートの中のカンマを扱う）。 */
function splitCsv(line) {
  if (!line.includes('"')) return line.split(',')
  const cols = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      cols.push(cur)
      cur = ''
    } else cur += c
  }
  cols.push(cur)
  return cols
}

/**
 * raw deflate に圧縮する。Node の zlib（Chromium 版）は辞書の trie を 1 割ほど大きく圧縮するので、
 * 系統の gzip -9 を使い、gzip のヘッダ（10 バイト・-n で名前と時刻なし）と末尾（8 バイト）を外す。
 * 展開して元と一致することを確かめる。gzip が無ければ Node の zlib に戻す。
 */
function deflate(data) {
  try {
    const gz = execFileSync('gzip', ['-9', '-n', '-c'], { input: data, maxBuffer: 1 << 30 })
    if (gz[0] !== 0x1f || gz[1] !== 0x8b || gz[3] !== 0) throw new Error('gzip のヘッダが想定と違います')
    const raw = gz.subarray(10, gz.length - 8)
    if (!inflateRawSync(raw).equals(data)) throw new Error('gzip の出力を展開すると元と一致しません')
    return raw
  } catch (e) {
    log(`gzip を使えないので Node の zlib で圧縮します（${e instanceof Error ? e.message : e}）`)
    return deflateRawSync(data, { level: 9 })
  }
}

/** 決まった日時で zip を作る（同じ入力なら同じバイト列になる）。 */
function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  const DOS_TIME = 0
  const DOS_DATE = (0 << 9) | (1 << 5) | 1 // 1980-01-01
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const deflated = deflate(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 の名前
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, deflated)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + deflated.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

function linderaBuild(cli, src, dest) {
  rmSync(dest, { recursive: true, force: true })
  execFileSync(
    cli,
    ['build', '--src', src, '--dest', dest, '--metadata', join(root, 'scripts', 'dict', 'ipadic-metadata.json')],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
}

async function loadTokenizer(dictDir) {
  const require = createRequire(join(root, 'package.json'))
  const pkgDir = dirname(require.resolve('lindera-wasm'))
  const lindera = await import(pathToFileURL(join(pkgDir, 'lindera_wasm.js')).href)
  lindera.initSync({ module: readFileSync(join(pkgDir, 'lindera_wasm_bg.wasm')) })
  const dict = lindera.loadDictionaryFromBytes(
    ...DICT_FILES.map((n) => new Uint8Array(readFileSync(join(dictDir, n)))),
  )
  const builder = new lindera.TokenizerBuilder()
  builder.setDictionaryInstance(dict)
  builder.setMode('normal')
  builder.setKeepWhitespace(true)
  return builder.build()
}

async function main() {
  const { classifySplit, parseSudachiRow, selectSupplement } = await import(
    pathToFileURL(join(root, 'src', 'core', 'proofread', 'morph', 'dict-supplement.ts')).href
  )
  const work = join(cache, 'work')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })

  // 1. 元データ
  const ipadicSrc = join(work, 'ipadic-src')
  untarGz(await fetchPinned('ipadic'), ipadicSrc)
  const cli = join(work, 'lindera')
  writeFileSync(cli, unzip(await fetchPinned('cli')).get('lindera'))
  chmodSync(cli, 0o755)
  const lexicons = []
  for (const name of ['small', 'core']) {
    const files = unzip(await fetchPinned(name))
    lexicons.push([name, files.get(`${name}_lex.csv`).toString('utf8')])
  }

  // 2. IPADIC をそのまま作り直し、公式と一致することを確かめる
  const baseDir = join(work, 'out-base')
  linderaBuild(cli, ipadicSrc, baseDir)
  for (const [name, want] of Object.entries(OFFICIAL_SHA256)) {
    const got = sha256(readFileSync(join(baseDir, name)))
    if (got !== want) throw new Error(`作り直した IPADIC が公式と違います（${name}）`)
  }
  log('IPADIC を作り直し、公式の辞書と一致しました')

  // 3. 足す語を選ぶ
  const tokenizer = await loadTokenizer(baseDir)
  const splitOf = (surface) =>
    classifySplit(
      tokenizer.tokenize(surface).map((t) => ({
        surface: t.surface,
        unknown: (t.details[6] ?? '*') === '*',
        pos1: t.details[1] ?? '*',
      })),
    )
  const nouns = []
  for (const [source, text] of lexicons) {
    for (const line of text.split('\n')) {
      if (!line) continue
      const n = parseSudachiRow(splitCsv(line), source)
      if (n) nouns.push(n)
    }
  }
  const rows = selectSupplement(nouns, splitOf)
  log(`SudachiDict の普通名詞 ${nouns.length} 行のうち ${rows.length} 語を足します`)

  // 4. 足した辞書を作る
  const supSrc = join(work, 'ipadic-src-sup')
  cpSync(ipadicSrc, supSrc, { recursive: true })
  writeFileSync(join(supSrc, 'Sudachi.csv'), `${rows.join('\n')}\n`)
  const supDir = join(work, 'out-sup')
  linderaBuild(cli, supSrc, supDir)

  // 5. zip にする
  const entries = DICT_FILES.map((n) => [`lindera-ipadic/${n}`, readFileSync(join(supDir, n))])
  entries.push(['lindera-ipadic/NOTICE.txt', readFileSync(join(root, 'scripts', 'dict', 'NOTICE-ipadic.txt'))])
  entries.push([
    'lindera-ipadic/NOTICE-sudachidict.txt',
    readFileSync(join(root, 'scripts', 'dict', 'NOTICE-sudachidict.txt')),
  ])
  const out = zip(entries)
  if (out.length > MAX_ZIP_BYTES) throw new Error(`zip が大きすぎます（${out.length} バイト・上限 ${MAX_ZIP_BYTES}）`)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, out)
  log(`${outPath} を作りました（${out.length} バイト）`)
  log(`SHA-256: ${sha256(out)}`)
  log(`中身: ${readdirSync(supDir).join(' ')}`)
}

await main()

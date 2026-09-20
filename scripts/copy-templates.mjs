#!/usr/bin/env node
/**
 * 運営テンプレ（背景・立ち絵・効果音・BGM）を R2 の別バケットへ写す（ふつうは stg → 本番）。
 *
 *   pnpm templates:copy-to-prod            # novel-studio-media-stg → novel-studio-media
 *   pnpm templates:copy-to-prod -- --dry-run
 *   node scripts/copy-templates.mjs --from <bucket> --to <bucket> [--dry-run] [--manifest <file>]
 *
 * 目録 `_templates/manifest.json` を写し元から読み、そこに載っている実体（＋画像のサムネ）を
 * 1 つずつ `wrangler r2 object get / put --remote` で運ぶ。最後に目録を書く。
 * 写し先に既にある目録は**捨てずに合流**する（写し先だけにある項目は残し、同じ kind/slug は
 * 写し元で上書き）＝本番だけで足した素材を消さない。
 *
 * 前提: wrangler の認証（`pnpm exec wrangler login` 済み、または CLOUDFLARE_API_TOKEN と
 * CLOUDFLARE_ACCOUNT_ID）。R2 の読み書き権限が要る。ネットワーク越しに 1 件ずつ運ぶので、
 * 数十件なら数分かかる。途中で落ちたら、そのまま再実行してよい（同じ内容の上書きは無害）。
 *
 * キーの規則は functions/api/_lib/templates-store.ts（templateObjectKey）と
 * src/core/game/templates.ts（TEMPLATE_EXT_BY_MIME）に合わせてある。変えるときは両方を見る。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PREFIX = '_templates/'
const MANIFEST_KEY = `${PREFIX}manifest.json`
const EXT_BY_MIME = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
}
const extOf = (mime) => EXT_BY_MIME[mime] ?? (mime.startsWith('audio/') ? 'mp3' : 'webp')
const objectKey = (kind, slug, thumb, ext) => `${PREFIX}${kind}/${slug}${thumb ? '.thumb' : ''}.${ext}`

function parseArgs(argv) {
  const opts = { from: 'novel-studio-media-stg', to: 'novel-studio-media', dryRun: false, manifest: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--from') opts.from = argv[++i] ?? ''
    else if (a === '--to') opts.to = argv[++i] ?? ''
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--manifest') opts.manifest = argv[++i] ?? ''
    else if (a === '--help' || a === '-h') {
      console.log('usage: copy-templates.mjs [--from <bucket>] [--to <bucket>] [--dry-run] [--manifest <file>]')
      process.exit(0)
    } else {
      console.error(`unknown option: ${a}`)
      process.exit(2)
    }
  }
  if (!opts.from || !opts.to || opts.from === opts.to) {
    console.error('--from と --to に別々のバケット名を渡してください')
    process.exit(2)
  }
  return opts
}

/** wrangler を子プロセスで呼ぶ（pnpm exec 経由＝素の wrangler は PATH に無い）。 */
function wrangler(args, { allowFail = false } = {}) {
  const r = spawnSync('pnpm', ['exec', 'wrangler', ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  if (r.status !== 0 && !allowFail) {
    console.error(r.stdout)
    console.error(r.stderr)
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} が失敗しました（exit ${r.status}）`)
  }
  return r
}

function getObject(bucket, key, file) {
  const r = wrangler(['r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--file', file], { allowFail: true })
  return r.status === 0 && existsSync(file)
}

function putObject(bucket, key, file, contentType) {
  wrangler(['r2', 'object', 'put', `${bucket}/${key}`, '--remote', '--file', file, '--content-type', contentType])
}

function readManifestFile(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (parsed?.v !== 1 || !Array.isArray(parsed.entries)) throw new Error('目録の形が違います（v: 1・entries[] を期待）')
  return parsed
}

/** 目録の 1 項目が指す R2 のオブジェクト（実体＋画像ならサムネ）。 */
function objectsOf(entry) {
  const list = [{ key: objectKey(entry.kind, entry.slug, false, extOf(entry.mime)), mime: entry.mime }]
  if (entry.thumbHash && String(entry.mime).startsWith('image/')) {
    const mime = entry.thumbMime ?? entry.mime
    list.push({ key: objectKey(entry.kind, entry.slug, true, extOf(mime)), mime })
  }
  return list
}

/** 写し先の目録に写し元を合流する（同じ kind/slug は写し元が勝つ・写し先だけの項目は残す）。 */
export function mergeManifests(target, source) {
  const id = (e) => `${e.kind}/${e.slug}`
  const fromSource = new Set(source.entries.map(id))
  const kept = (target?.entries ?? []).filter((e) => !fromSource.has(id(e)))
  const categories = {}
  for (const kind of ['bg', 'sprite', 'se', 'bgm']) {
    categories[kind] = { ...(target?.categories?.[kind] ?? {}), ...(source.categories?.[kind] ?? {}) }
  }
  return {
    v: 1,
    updatedAt: Math.max(source.updatedAt ?? 0, target?.updatedAt ?? 0, Date.now()),
    categories,
    entries: [...kept, ...source.entries],
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const work = mkdtempSync(join(tmpdir(), 'kotonoha-templates-'))
  try {
    // 1. 写し元の目録
    const srcManifestFile = join(work, 'source.json')
    if (opts.manifest) {
      writeFileSync(srcManifestFile, readFileSync(opts.manifest))
    } else if (!getObject(opts.from, MANIFEST_KEY, srcManifestFile)) {
      throw new Error(`${opts.from} に ${MANIFEST_KEY} がありません（写し元が空か、認証が通っていません）`)
    }
    const source = readManifestFile(srcManifestFile)
    const plan = source.entries.flatMap((e) => objectsOf(e).map((o) => ({ ...o, label: `${e.kind}/${e.slug}` })))
    console.log(`${opts.from} → ${opts.to}: 目録 ${source.entries.length} 項目・オブジェクト ${plan.length} 件`)
    for (const p of plan) console.log(`  ${p.key}  (${p.mime})`)
    if (opts.dryRun) {
      console.log('--dry-run なので何も書きません')
      return
    }

    // 2. 実体を 1 件ずつ運ぶ（目録より先に置く＝目録が指す先が無い瞬間を作らない）
    let done = 0
    const missing = []
    for (const p of plan) {
      const file = join(work, p.key.replaceAll('/', '__'))
      if (!getObject(opts.from, p.key, file)) {
        missing.push(p.key)
        console.warn(`  取れず（写し元に無い）: ${p.key}`)
        continue
      }
      putObject(opts.to, p.key, file, p.mime)
      rmSync(file, { force: true })
      done++
      console.log(`  [${done}/${plan.length}] ${p.key}`)
    }

    // 3. 目録（写し先の既存と合流してから書く）
    const dstManifestFile = join(work, 'target.json')
    const target = getObject(opts.to, MANIFEST_KEY, dstManifestFile) ? readManifestFile(dstManifestFile) : null
    const merged = mergeManifests(target, source)
    const mergedFile = join(work, 'merged.json')
    writeFileSync(mergedFile, JSON.stringify(merged))
    putObject(opts.to, MANIFEST_KEY, mergedFile, 'application/json')
    console.log(
      `目録を書きました: ${merged.entries.length} 項目（写し元 ${source.entries.length}・写し先だけの項目 ${
        merged.entries.length - source.entries.length
      }）`,
    )
    if (missing.length > 0) {
      console.warn(`写し元に実体が無かった項目が ${missing.length} 件あります。目録には載っているので、配信では 404 になります:`)
      for (const k of missing) console.warn(`  ${k}`)
      process.exitCode = 1
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()

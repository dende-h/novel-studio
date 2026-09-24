/**
 * 機能紹介の動画を 1 本録る。
 *
 *   node tools/x-tutorial/record.ts <台本id>     … 指定の台本
 *   node tools/x-tutorial/record.ts --today      … 今日（日本時間）の順番の台本
 *   node tools/x-tutorial/record.ts --list       … 台本の一覧
 *   node tools/x-tutorial/record.ts <台本.ts>    … 並びに入れる前の台本ファイルを試し撮り
 *
 * 出力（tools/x-tutorial/out/、git 管理外）：
 *   <id>.mp4        … X に上げる動画（H.264・1280×720・30fps）
 *   <id>.post.txt   … 投稿文
 *   <id>-frames/    … 目視確認用のコマ（PNG）
 * 最後の行に結果を JSON で出す（ルーティンの Claude が読む）。
 *
 * アプリは http://localhost:5173 で動いていればそれを使い、無ければゲストモードで起動して
 * 終わったら止める（E2E と同じく Clerk を切る＝ログイン無しの空の端末で撮る）。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  extractFrames,
  probeDuration,
  recordScenario,
  type Scenario,
  toMp4,
} from './lib/stage.ts'
import { findScenario, pickForDate, SCENARIOS } from './scenarios/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const OUT = join(HERE, 'out')
const BASE_URL = process.env.X_TUTORIAL_BASE_URL ?? 'http://localhost:5173'

/** X の API 経由の動画の上限（tweet_video）。 */
const MAX_SECONDS = 140
const MAX_BYTES = 512 * 1024 * 1024

const isUp = async () => {
  try {
    return (await fetch(BASE_URL)).ok
  } catch {
    return false
  }
}

async function ensureApp(): Promise<ChildProcess | undefined> {
  if (await isUp()) return undefined
  const port = new URL(BASE_URL).port || '5173'
  const child = spawn('pnpm', ['dev', '--port', port, '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, VITE_CLERK_PUBLISHABLE_KEY: '' },
    stdio: 'ignore',
    detached: true,
  })
  for (let i = 0; i < 60; i++) {
    if (await isUp()) return child
    await new Promise((r) => setTimeout(r, 1000))
  }
  // 起動を諦めるときは、自分で立てたサーバを残さない。
  if (child.pid) process.kill(-child.pid)
  throw new Error(`アプリが ${BASE_URL} で起動しなかった`)
}

/** 台本ファイルが export している最初の Scenario を返す。 */
async function loadScenarioFile(file: string): Promise<Scenario | undefined> {
  const mod = (await import(pathToFileURL(resolve(file)).href)) as Record<string, unknown>
  return Object.values(mod).find(
    (v): v is Scenario => typeof v === 'object' && v !== null && 'run' in v && 'id' in v,
  )
}

async function main() {
  const arg = process.argv[2]
  if (!arg || arg === '--list') {
    for (const s of SCENARIOS) console.log(`${s.id}\t${s.title}`)
    return
  }
  const scenario =
    arg === '--today'
      ? pickForDate(new Date())
      : arg.endsWith('.ts')
        ? await loadScenarioFile(arg)
        : findScenario(arg)
  if (!scenario) throw new Error(`台本 ${arg} が無い（--list で一覧）`)

  const app = await ensureApp()
  try {
    const webm = await recordScenario(scenario, BASE_URL, OUT)
    const mp4 = join(OUT, `${scenario.id}.mp4`)
    toMp4(webm, mp4)
    const seconds = probeDuration(mp4)
    const bytes = statSync(mp4).size
    const frames = extractFrames(mp4, join(OUT, `${scenario.id}-frames`))
    const postFile = join(OUT, `${scenario.id}.post.txt`)
    writeFileSync(postFile, `${scenario.post}\n`)

    const problems: string[] = []
    if (seconds > MAX_SECONDS) problems.push(`長すぎる（${seconds.toFixed(1)} 秒 > ${MAX_SECONDS}）`)
    if (bytes > MAX_BYTES) problems.push(`大きすぎる（${bytes} バイト）`)
    console.log(
      JSON.stringify({
        id: scenario.id,
        title: scenario.title,
        mp4,
        seconds: Number(seconds.toFixed(1)),
        bytes,
        postFile,
        frames,
        problems,
      }),
    )
    if (problems.length) process.exitCode = 1
  } finally {
    if (app?.pid) process.kill(-app.pid)
  }
}

// 落ちたときも最後の行を JSON にする（ルーティンの Claude が理由を読める）。詳細は stderr へ。
try {
  await main()
} catch (e) {
  console.error(e)
  const message = e instanceof Error ? e.message.split('\n')[0] : String(e)
  console.log(JSON.stringify({ id: process.argv[2], problems: [`録画に失敗: ${message}`] }))
  process.exitCode = 1
}

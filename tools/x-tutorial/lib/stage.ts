/**
 * 録画の舞台：ブラウザを立ち上げ、画面を録り、字幕と見出しを重ねる。
 *
 * 字幕は Playwright 1.59+ の page.screencast.showOverlay で「画面の上に HTML を重ねて」
 * 録画へ焼き込む。フォントはアプリが同梱している Noto Sans JP をそのまま使えるので、
 * 実行環境に日本語フォントが無くても文字化けしない（ffmpeg の字幕焼き込みでは要る）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test'

/**
 * 録画の画角。スマホの小さな画面で見られるので、PC レイアウト（本文とプレビューが並ぶ lg＝1024px〜）
 * のうち一番狭い幅で撮り、toMp4 で X の横長推奨 1280×720 へ 1.25 倍に拡大して文字を大きく見せる。
 */
export const VIEWPORT = { width: 1024, height: 576 }
const SCALE = 1.25
/** 録画の枠はブラウザの表示サイズ（CSS px）と揃える。大きくすると余白が灰色で埋まる。 */
const VIDEO_SIZE = VIEWPORT

const FONT = "'Noto Sans JP Variable','Hiragino Sans','Yu Gothic',sans-serif"

/** クラウド環境（Claude Code on the web）には Chromium が /opt/pw-browsers に入っている。 */
const CHROMIUM_PATH =
  process.env.PW_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)

export interface Stage {
  page: Page
  /** 画面下に字幕を出す（前の字幕は消える）。空文字で消すだけ。自動では折り返さないので、
   *  1 行に収まらない字幕は \n で区切る（全角 30 字ほどが 1 行の目安）。 */
  caption: (text: string) => Promise<void>
  /** 画面を覆う見出しカードを出して ms だけ待つ（冒頭・締めに使う）。 */
  card: (text: CardText, ms?: number) => Promise<void>
  /** 人が打っているように 1 文字ずつ入力する。 */
  typeSlow: (selector: string, text: string, delay?: number) => Promise<void>
  /** 見せるための間。 */
  hold: (ms: number) => Promise<void>
}

export interface CardText {
  /** 上の小見出し。 */
  kicker: string
  title: string
  /** 下の添え書き。省略時はアプリ名。 */
  foot?: string
}

export interface Scenario {
  /** ファイル名・ローテーションのキー（英小文字とハイフン）。 */
  id: string
  /** 機能の名前（動画の見出し・投稿文の主語）。 */
  title: string
  /** 投稿文。280 字（全角は 2 と数える）に収め、URL は入れない（料金とリーチの両面で不利）。 */
  post: string
  /**
   * 誰として撮るか。構想の道具（プロット・アウトライン・相関図・マインドマップ）は無料の
   * アカウント登録で出る機能なので 'free' で撮る（既定 'guest'）。投稿文でもその旨を添える。
   */
  as?: 'guest' | 'free'
  /** 録画を始める前の下ごしらえ（作品や話を作っておく等）。ここは動画に映らない。 */
  setup?: (page: Page) => Promise<void>
  /** 画面を操作する台本。所要 30〜60 秒を目安に。 */
  run: (stage: Stage) => Promise<void>
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\n/g, '<br>')

const captionHtml = (text: string) => `
<div style="position:fixed;left:50%;bottom:36px;transform:translateX(-50%);
  padding:10px 26px;border-radius:12px;background:rgba(24,36,26,.86);color:#fff;
  font:600 24px/1.55 ${FONT};text-align:center;letter-spacing:.03em;white-space:nowrap;
  box-shadow:0 8px 28px rgba(0,0,0,.28)">${escapeHtml(text)}</div>`

const cardHtml = ({ kicker, title, foot = 'コトノハ-leaf-' }: CardText) => `
<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:18px;background:#f6f3ea;
  font-family:${FONT};color:#1f2a20;text-align:center">
  <div style="font-size:22px;letter-spacing:.2em;color:#2c5b27;font-weight:600">${escapeHtml(kicker)}</div>
  <div style="font-size:52px;font-weight:700;letter-spacing:.04em;line-height:1.35">${escapeHtml(title)}</div>
  <div style="font-size:20px;color:#5b6358;letter-spacing:.12em">${escapeHtml(foot)}</div>
</div>`

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 無料会員（status 'free'）として撮るための差し替え。開発サーバが配る auth-context.ts の
 * ゲスト既定（GUEST_AUTH_STATE）の status だけを 'free' に書き換える。available は false の
 * ままなので、ログイン UI も Clerk の読み込みも起きない。アプリのコードには手を入れない。
 */
async function actAsFreeAccount(context: BrowserContext) {
  let patched = false
  await context.route(/\/src\/ui\/auth\/auth-context\.ts(\?|$)/, async (route) => {
    const res = await route.fetch()
    const body = await res.text()
    const next = body.replace(/status:\s*(["'])guest\1/, 'status: "free"')
    patched ||= next !== body
    await route.fulfill({ response: res, body: next })
  })
  return { patched: () => patched }
}

/**
 * 台本を 1 本録って webm を返す。アプリは baseURL で起動済みであること（record.ts が面倒を見る）。
 * 初回ダイアログは E2E と同じく ns-onboarded を立てて出さない。データは新しいコンテキスト
 * ＝空の IndexedDB から台本が作るので、利用者のデータには一切触れない。
 */
export async function recordScenario(
  scenario: Scenario,
  baseURL: string,
  outDir: string,
): Promise<string> {
  mkdirSync(outDir, { recursive: true })
  const webm = join(outDir, `${scenario.id}.webm`)
  rmSync(webm, { force: true })

  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH })
    const context = await browser.newContext({
      baseURL,
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    })
    await context.addInitScript(() => {
      try {
        localStorage.setItem('ns-onboarded', '1')
      } catch {}
    })
    const asFree = scenario.as === 'free' ? await actAsFreeAccount(context) : undefined
    const page = await context.newPage()
    await page.goto('/')
    await page.getByRole('heading', { name: 'マイライブラリ' }).waitFor()
    if (asFree && !asFree.patched()) {
      throw new Error('無料会員として撮る差し替えが効かなかった（auth-context.ts の形が変わった？）')
    }
    await scenario.setup?.(page)
    // Web フォントが揃ってから録り始める（最初の数フレームで字形が入れ替わるのを避ける）。
    await page.evaluate(() => document.fonts.ready)

    let current: { dispose: () => Promise<void> } | undefined
    const clear = async () => {
      await current?.dispose()
      current = undefined
    }
    const stage: Stage = {
      page,
      caption: async (text) => {
        await clear()
        if (text) current = await page.screencast.showOverlay(captionHtml(text))
      },
      card: async (text, ms = 2600) => {
        await clear()
        const d = await page.screencast.showOverlay(cardHtml(text))
        await wait(ms)
        await d.dispose()
      },
      typeSlow: async (selector, text, delay = 90) => {
        await page.locator(selector).pressSequentially(text, { delay })
      },
      hold: wait,
    }

    await page.screencast.start({ path: webm, size: VIDEO_SIZE })
    await scenario.run(stage)
    await clear()
    await page.screencast.stop()
    await context.close()
  } finally {
    await browser?.close()
  }
  return webm
}

/**
 * X が受け付ける mp4（H.264 / yuv420p / 30fps / faststart）へ変換する。
 * 無音トラックを足すのは、音声なしの動画を弾く・変換に失敗するクライアントがあるため。
 */
export function toMp4(webm: string, mp4: string) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel', 'error',
      '-i', webm,
      '-f', 'lavfi',
      '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-shortest',
      '-vf', 'fps=30,scale=1280:720:flags=lanczos,format=yuv420p',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-profile:v', 'high',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      mp4,
    ],
    { stdio: 'inherit' },
  )
}

/** 目視確認用に n 枚のコマを PNG で切り出す（ルーティンの Claude が Read で見る）。 */
export function extractFrames(mp4: string, dir: string, count = 6): string[] {
  mkdirSync(dir, { recursive: true })
  const duration = probeDuration(mp4)
  const files: string[] = []
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) * duration) / count
    const file = join(dir, `frame-${String(i + 1).padStart(2, '0')}.png`)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', mp4, '-frames:v', '1', file])
    files.push(file)
  }
  return files
}

export function probeDuration(file: string): number {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ])
  return Number.parseFloat(out.toString().trim())
}

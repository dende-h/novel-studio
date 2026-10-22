// 紹介用のスクショと動画を撮る共通部品（release-promo スキル）。
// 台本（examples/*.mjs を写して作る）から import して使う。Playwright はリポジトリの node_modules から読む。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../../../package.json', import.meta.url))
export const { chromium } = require('@playwright/test')

/** setup-env.sh で起こした一時コピーの vite。 */
export const BASE = process.env.PROMO_BASE ?? 'http://localhost:5174/'
const OVERLAY = fileURLToPath(new URL('./overlay.js', import.meta.url))

/**
 * 新しいページを開く。初回の案内（FirstRunDialog）は出さない。
 * - スクショ: { width: 1440, height: 900, scale: 2 }（note に載せても文字がつぶれない）
 * - 動画: { width: 1280, height: 800, overlay: true }（テロップ・タイトル・マウス位置を重ねる）
 * headless の Chromium は日本語の UI 文字列を持たないので、<input type="file"> は英語で写る。写さない切り取り方にする。
 */
export async function openPage(browser, { width = 1440, height = 900, scale = 1, overlay = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    locale: 'ja-JP',
  })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('ns-onboarded', '1')
    } catch {}
  })
  if (overlay) await ctx.addInitScript({ path: OVERLAY })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  return { ctx, page, errors }
}

/** スクショ。shot＝画面全体か clip（CSS ピクセル）、el＝要素だけ。どちらも <out>/<name>.png。 */
export function shooter(page, out) {
  mkdirSync(out, { recursive: true })
  return {
    shot: (name, opts = {}) => page.screenshot({ path: `${out}/${name}.png`, ...opts }),
    el: (name, locator) => locator.screenshot({ path: `${out}/${name}.png` }),
    /** 要素の上端から、stopAt の要素の手前までを切り取る（ダイアログの下の英語の file input を避けるとき）。 */
    above: async (name, locator, stopAt, gap = 12) => {
      const box = await locator.boundingBox()
      const stop = await stopAt.boundingBox()
      await page.screenshot({
        path: `${out}/${name}.png`,
        clip: { x: box.x, y: box.y, width: box.width, height: stop.y - box.y - gap },
      })
    },
  }
}

/** 重ね表示（overlay.js）を動かす。caption(null) で消す。card(html) は全画面のタイトル・終わりの画面。 */
export function promo(page) {
  const call = (fn, arg) => page.evaluate(([f, a]) => window.__promo[f](a), [fn, arg])
  return {
    ready: () => page.waitForFunction(() => !!window.__promo),
    caption: (text) => call('caption', text ?? null),
    card: (html) => call('card', html ?? null),
    cursor: (on) => call('cursor', on),
  }
}

/** 動画用のクリック。マウスを動かして（overlay の丸が追う）、少し待ってから押す。 */
export function tapper(page) {
  return async function tap(locator, after = 350) {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    if (!box) throw new Error(`見えない要素を押そうとした: ${locator}`)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(380)
    await page.mouse.down()
    await page.waitForTimeout(60)
    await page.mouse.up()
    await page.waitForTimeout(after)
  }
}

/**
 * 録画。Playwright の recordVideo は画質が粗いので、CDP の screencast で JPEG のコマを受け取る。
 * コマは画面が変わったときだけ届くので、時刻の差を長さにして <out>/frames.txt（ffmpeg concat 用）を書く。
 * 書き出しは encode.sh <out>。
 */
export async function startRecording(ctx, page, out, { quality = 92 } = {}) {
  rmSync(`${out}/frames`, { recursive: true, force: true })
  mkdirSync(`${out}/frames`, { recursive: true })
  const vp = page.viewportSize()
  const cdp = await ctx.newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const n = String(frames.length).padStart(5, '0')
    writeFileSync(`${out}/frames/${n}.jpg`, Buffer.from(data, 'base64'))
    frames.push({ file: `frames/${n}.jpg`, t: metadata.timestamp })
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId })
    } catch {}
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality,
    maxWidth: vp.width,
    maxHeight: vp.height,
  })
  return {
    async stop() {
      const end = Date.now() / 1000
      await cdp.send('Page.stopScreencast')
      await page.waitForTimeout(300)
      if (frames.length === 0) throw new Error('コマが1枚も届いていません')
      const lines = []
      frames.forEach((f, i) => {
        const next = frames[i + 1]?.t ?? Math.max(end, f.t + 0.5)
        lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(3)}`)
      })
      lines.push(`file '${frames.at(-1).file}'`)
      writeFileSync(`${out}/frames.txt`, `${lines.join('\n')}\n`)
      return { frames: frames.length, seconds: Number((end - frames[0].t).toFixed(1)) }
    },
  }
}

// ── アプリの操作（画面の文言が変わったらここを直す） ──────────────────────

/** 作品一覧の「データ管理」→「テキストから作品を作る」で、貼り付けた本文から作品を作り、執筆画面を開く。 */
export async function importText(page, { text, title, episodes, hooks = {}, tap }) {
  const press = tap ?? ((l) => l.click())
  await page.goto(BASE)
  await page.getByRole('heading', { name: 'マイライブラリ' }).waitFor()
  await hooks.library?.()
  await press(page.getByRole('button', { name: 'データ管理' }))
  await press(page.getByRole('menuitem', { name: 'テキストから作品を作る' }))
  const dialog = page.getByRole('dialog', { name: 'テキストから作品を作る' })
  await press(dialog.getByRole('button', { name: '貼り付け' }))
  await dialog.getByRole('textbox', { name: '本文', exact: true }).fill(text)
  if (episodes) await dialog.getByText(`${episodes} 話に分かれます`).waitFor()
  const titleBox = dialog.getByLabel('作品タイトル')
  await titleBox.fill('')
  if (tap) await titleBox.pressSequentially(title, { delay: 90 })
  else await titleBox.fill(title)
  await page.waitForTimeout(400)
  await hooks.preview?.(dialog)
  await press(dialog.getByRole('button', { name: '作品を作る' }))
  await dialog.getByText(new RegExp(`「${title}」を作りました`)).waitFor()
  await hooks.done?.(dialog)
  await press(dialog.getByRole('button', { name: '執筆を始める' }))
  await page.locator('textarea[aria-label="本文"]').waitFor()
}

/** サイドナビの項目（「本文を書く」「推敲」「用語集」など）を開く。 */
export const sideNav = (page, label) => page.getByText(label, { exact: true })

/** 推敲画面の「確認する項目」をすべてオンにする（初めて開くと全部オフ）。 */
export const PROOFREAD_RULES = [
  '字下げ',
  '閉じ括弧の前の句読点',
  '！？の後の空白',
  '三点リーダー・ダッシュ',
  '半角の約物',
  '同じ語の連続',
  '表記ゆれ',
  '一文の中の同じ助詞',
  'ら抜き言葉',
]
export async function enableProofreadRules(page, tap) {
  for (const name of PROOFREAD_RULES) {
    const btn = page.getByRole('button', { name, exact: true })
    if ((await btn.getAttribute('aria-pressed')) !== 'true') await (tap ? tap(btn, 60) : btn.click())
  }
}

/** 推敲画面の指摘のカード（本文や見出しの文字で絞る）。 */
export const findingCard = (page, ...texts) => {
  let l = page.locator('li[data-finding-key]')
  for (const t of texts) l = l.filter({ hasText: t })
  return l.first()
}

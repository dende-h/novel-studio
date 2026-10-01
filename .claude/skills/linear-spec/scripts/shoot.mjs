#!/usr/bin/env node
// 現状画面のスクショを撮る（linear-spec スキルの「撮影 → プロトタイプ」工程用）。
//
// 使い方:
//   node .claude/skills/linear-spec/scripts/shoot.mjs <plan.json>
//
// plan.json:
// {
//   "baseURL": "http://localhost:5173",          // 省略可
//   "outDir": "docs/specs/COT-12/screens",
//   "shots": [
//     {
//       "name": "library",                      // → library-desktop.png / library-mobile.png
//       "viewports": ["desktop", "mobile"],     // 省略時 ["desktop"]
//       "steps": [                              // 撮る前の操作（省略可）
//         { "goto": "/" },
//         { "click": { "role": "button", "name": "新しい作品" } },
//         { "fill": { "label": "作品タイトル", "value": "試し書き" } },
//         { "click": { "role": "button", "name": "作成", "exact": true } },
//         { "waitFor": { "role": "heading", "name": "試し書き" } },
//         { "press": "Escape" },
//         { "hash": "#/write" },
//         { "wait": 300 }
//       ],
//       "fullPage": false,                      // 省略可
//       "clip": { "selector": ".sidebar" }      // 省略可：その要素だけ撮る
//     }
//   ]
// }
//
// 前提: dev サーバがゲストモード（VITE_CLERK_PUBLISHABLE_KEY=''）で起動していること。
// 各 shot は新しいブラウザコンテキスト（空の IndexedDB）で走る。作品などが要る画面は steps で作る。
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, devices } from '@playwright/test'

const planPath = process.argv[2]
if (!planPath) {
  console.error('usage: shoot.mjs <plan.json>')
  process.exit(2)
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const baseURL = plan.baseURL ?? 'http://localhost:5173'
const outDir = resolve(plan.outDir ?? 'screens')
mkdirSync(outDir, { recursive: true })

const VIEWPORTS = {
  desktop: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  mobile: devices['Pixel 5'],
}

const locate = (page, t) => {
  if (t.selector) return page.locator(t.selector).first()
  if (t.label) return page.getByLabel(t.label, { exact: t.exact })
  if (t.text) return page.getByText(t.text, { exact: t.exact }).first()
  return page.getByRole(t.role, { name: t.name, exact: t.exact }).first()
}

const runStep = async (page, s) => {
  if (s.goto !== undefined) return page.goto(baseURL + s.goto)
  if (s.hash !== undefined) return page.evaluate((h) => { location.hash = h }, s.hash)
  if (s.click) return locate(page, s.click).click()
  if (s.fill) return locate(page, s.fill).fill(s.fill.value)
  if (s.press) return page.keyboard.press(s.press)
  if (s.waitFor) return locate(page, s.waitFor).waitFor({ state: 'visible', timeout: 10_000 })
  if (s.wait) return page.waitForTimeout(s.wait)
  if (s.eval) return page.evaluate(s.eval)
  throw new Error(`unknown step: ${JSON.stringify(s)}`)
}

const browser = await chromium.launch()
const results = []
let failed = false
for (const shot of plan.shots) {
  for (const vp of shot.viewports ?? ['desktop']) {
    const file = join(outDir, `${shot.name}-${vp}.png`)
    const context = await browser.newContext({ ...VIEWPORTS[vp], colorScheme: shot.colorScheme ?? 'light' })
    // 初回ダイアログ（FirstRunDialog）を出さない。e2e/smoke.spec.ts と同じ前提。
    await context.addInitScript(() => {
      try { localStorage.setItem('ns-onboarded', '1') } catch {}
    })
    const page = await context.newPage()
    try {
      const steps = shot.steps ?? [{ goto: '/' }]
      if (steps[0]?.goto === undefined) await page.goto(`${baseURL}/`)
      for (const s of steps) await runStep(page, s)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(300)
      if (shot.clip?.selector) await page.locator(shot.clip.selector).first().screenshot({ path: file })
      else await page.screenshot({ path: file, fullPage: !!shot.fullPage })
      results.push({ ok: true, file })
    } catch (e) {
      failed = true
      const errFile = file.replace(/\.png$/, '.error.png')
      await page.screenshot({ path: errFile }).catch(() => {})
      results.push({ ok: false, file: errFile, error: String(e.message ?? e).split('\n')[0] })
    }
    await context.close()
  }
}
await browser.close()
console.log(JSON.stringify(results, null, 2))
process.exit(failed ? 1 : 0)

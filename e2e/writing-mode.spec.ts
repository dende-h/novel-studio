import { expect, type Locator, type Page, test } from '@playwright/test'

test.use({ baseURL: process.env.WRITING_E2E_BASE_URL ?? 'http://localhost:5173' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ns-onboarded', '1'))
})

async function openWriter(page: Page, mobile = false) {
  await page.goto('/')
  await page.getByRole('button', { name: /新規プロジェクト/ }).click()
  await page.getByLabel('作品タイトル').fill('集中のテスト')
  await page.getByRole('button', { name: '作成', exact: true }).click()
  await page.getByRole('button', { name: '「集中のテスト」を執筆' }).click()
  if (mobile) await page.getByRole('button', { name: 'メニュー', exact: true }).click()
  await page.getByRole('button', { name: '新しいエピソード', exact: true }).click()
  await page.getByLabel('話タイトル').fill('第一話')
  await page.getByRole('button', { name: '追加', exact: true }).click()
  return page.getByRole('textbox', { name: '本文', exact: true })
}

async function caretError(ta: Locator) {
  return ta.evaluate(async (element) => {
    const el = element as HTMLTextAreaElement
    const path = '/src/ui/_utils/caretCoordinates.ts'
    const { getCaretCoordinates } = await import(path)
    const c = getCaretCoordinates(el, el.selectionStart)
    const rect = el.getBoundingClientRect()
    const viewport = window.visualViewport
    const top = Math.max(rect.top, viewport?.offsetTop ?? 0)
    let bottom = Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight))
    const obstruction = el.parentElement?.querySelector('[data-writing-obstruction]')
    if (obstruction) bottom = Math.min(bottom, obstruction.getBoundingClientRect().top)
    return Math.abs(rect.top + c.top + c.height / 2 - (top + bottom) / 2) / c.height
  })
}

async function placeCaret(ta: Locator, position: number) {
  await ta.focus()
  await ta.evaluate((el, position) => {
    const input = el as HTMLTextAreaElement
    input.setSelectionRange(position, position)
    input.dispatchEvent(new Event('select', { bubbles: true }))
  }, position)
}

test('集中表示で同じ本文・選択・undoを保ち、IMEとEscapeを奪わない', async ({ page }) => {
  const ta = await openWriter(page)
  await ta.fill('残す本文')
  await ta.press('End')
  await ta.press('x')
  await ta.evaluate((el) => {
    ;(el as HTMLTextAreaElement).setSelectionRange(1, 3)
    ;(window as Window & { originalTextarea?: Element }).originalTextarea = el
  })
  await page.getByRole('button', { name: '集中モード', exact: true }).click()
  await expect(page.getByRole('button', { name: '集中モードを終了' })).toBeVisible()
  expect(await ta.evaluate((el) => el === (window as Window & { originalTextarea?: Element }).originalTextarea)).toBe(true)
  expect(await ta.evaluate((el) => [(el as HTMLTextAreaElement).selectionStart, (el as HTMLTextAreaElement).selectionEnd])).toEqual([1, 3])
  await expect(page.getByRole('button', { name: '用語集', exact: true })).toHaveCount(0)
  await ta.dispatchEvent('compositionstart')
  await ta.press('Alt+Shift+f')
  await expect(page.getByRole('button', { name: '集中モードを終了' })).toBeVisible()
  await ta.dispatchEvent('compositionend')
  await ta.press('Escape')
  await expect(page.getByRole('button', { name: '集中モードを終了' })).toBeVisible()
  await ta.press('Alt+Shift+f')
  await expect(page.getByRole('button', { name: '集中モード', exact: true })).toBeVisible()
  await ta.press('Control+z')
  await expect(ta).toHaveValue('残す本文')
  await page.getByRole('button', { name: '集中モード', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '保存済み' })).toBeVisible()
  await page.reload()
  await page.goto('/')
  await page.getByRole('button', { name: '「集中のテスト」を執筆' }).click()
  await expect(page.getByRole('button', { name: '集中モードを終了' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '本文', exact: true })).toHaveValue('残す本文')
})

test('追従は通常表示でも先頭末尾・折返しを中央へ寄せ、読み返しと選択・IMEを保つ', async ({ page }) => {
  const ta = await openWriter(page)
  await page.getByRole('button', { name: '入力行を中央に保つ' }).click()
  await ta.focus()
  await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  const text = `${'折り返す文章。'.repeat(60)}\n${'次の行。\n'.repeat(80)}最後の行`
  await ta.fill(text)
  for (const position of [0, 200, text.length]) {
    await placeCaret(ta, position)
    await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  }
  await ta.evaluate((el) => { el.scrollTop -= 150 })
  const manual = await ta.evaluate((el) => el.scrollTop)
  await page.waitForTimeout(200)
  expect(await ta.evaluate((el) => el.scrollTop)).toBeCloseTo(manual, 0)
  await ta.press('ArrowLeft')
  await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  await ta.evaluate((el) => { (el as HTMLTextAreaElement).setSelectionRange(0, 100) })
  await page.waitForTimeout(100)
  expect(await ta.evaluate((el) => (el as HTMLTextAreaElement).selectionEnd)).toBe(100)
  await placeCaret(ta, text.length)
  await ta.dispatchEvent('compositionstart')
  await ta.evaluate((el) => { el.scrollTop -= 100 })
  const duringIme = await ta.evaluate((el) => el.scrollTop)
  await ta.dispatchEvent('input')
  await page.waitForTimeout(100)
  expect(await ta.evaluate((el) => el.scrollTop)).toBeCloseTo(duringIme, 0)
  await ta.dispatchEvent('compositionend')
  await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  await page.setViewportSize({ width: 1100, height: 780 })
  await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  await ta.evaluate((el) => { el.style.fontSize = '17px' })
  await ta.press('ArrowLeft')
  await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  await expect(ta).toHaveValue(text)
})

test.describe('393pxの集中表示', () => {
  test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true })
  test('元のプレビュー面へ復帰し、候補と保存・終了操作を残す', async ({ page }) => {
    const ta = await openWriter(page, true)
    await ta.fill('スマホの本文')
    await page.getByRole('button', { name: 'プレビュー', exact: true }).click()
    await expect(ta).toBeHidden()
    await page.getByRole('button', { name: '集中モード', exact: true }).click()
    await expect(ta).toBeVisible()
    await expect(page.getByRole('button', { name: 'ルビ', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '入力行を中央に保つ' }).click()
    await ta.fill('@葉')
    await ta.focus()
    await expect(page.getByRole('listbox', { name: '参照候補' })).toBeVisible()
    await placeCaret(ta, 2)
    await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
    const exit = page.getByRole('button', { name: '集中モードを終了' })
    const box = await exit.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(393)
    await expect(page.getByRole('status').filter({ hasText: '保存済み' })).toBeVisible()
    await exit.click()
    await expect(ta).toBeHidden()
    await page.getByRole('button', { name: '本文', exact: true }).click()
    await expect(ta).toHaveValue('@葉')
  })
})


test('集中モードの全画面は外部終了に追従し、集中終了時にも解除する', async ({ page }) => {
  await openWriter(page)
  await page.getByRole('button', { name: '履歴', exact: true }).click()
  await expect(page.getByRole('button', { name: '履歴を閉じる' })).toBeVisible()
  await page.getByRole('button', { name: '集中モード', exact: true }).click()
  await expect(page.getByRole('button', { name: '履歴を閉じる' })).toHaveCount(0)
  await page.getByRole('button', { name: '全画面にする' }).click()
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true)
  await page.evaluate(() => document.exitFullscreen())
  await expect(page.getByRole('button', { name: '集中モードを終了' })).toBeVisible()
  await expect(page.getByRole('button', { name: '全画面にする' })).toBeVisible()
  await page.getByRole('button', { name: '全画面にする' }).click()
  await expect(page.getByRole('button', { name: '全画面を終了' })).toBeVisible()
  await page.getByRole('button', { name: '集中モードを終了' }).click()
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
  await expect(page.getByRole('button', { name: '履歴を閉じる' })).toBeVisible()
})

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
    if (getComputedStyle(el).writingMode === 'vertical-rl') {
      return Math.abs(c.left + c.width / 2 - el.clientWidth / 2) / c.width
    }
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
  const typewriter = page.getByRole('button', { name: '入力行を中央に保つ' })
  await ta.press('Alt+Shift+g')
  await expect(typewriter).toHaveAttribute('aria-pressed', 'true')
  await ta.press('Alt+Shift+g')
  await expect(typewriter).toHaveAttribute('aria-pressed', 'false')
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

test.describe('393pxでは集中・行を中央に・本文の縦書きを出さない（PC だけの機能）', () => {
  test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true })
  test('PC で設定した値が残っていても、横書き・通常表示のまま書ける', async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of ['ns-writing-focus', 'ns-writing-typewriter', 'ns-writing-vertical']) {
        localStorage.setItem(key, '1')
      }
    })
    const ta = await openWriter(page, true)
    await expect(page.getByRole('button', { name: /^集中モード/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '入力行を中央に保つ' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: '本文の組み方向' })).toHaveCount(0)
    expect(await ta.evaluate((el) => getComputedStyle(el).writingMode)).toBe('horizontal-tb')
    await ta.fill('スマホの本文')
    await ta.press('Alt+Shift+f')
    await ta.press('Alt+Shift+g')
    await expect(page.getByRole('button', { name: '集中モードの表示設定' })).toHaveCount(0)
    await expect(ta).toHaveValue('スマホの本文')
    expect(
      await page.evaluate(() => [
        localStorage.getItem('ns-writing-focus'),
        localStorage.getItem('ns-writing-typewriter'),
        localStorage.getItem('ns-writing-vertical'),
      ]),
    ).toEqual(['1', '1', '1'])
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


test('集中・追従ボタンはダッシュの右に並び、集中時の表示を個別に記憶する', async ({ page }) => {
  const ta = await openWriter(page)
  const dash = await page.getByRole('button', { name: 'ダッシュ', exact: true }).boundingBox()
  const focus = await page.getByRole('button', { name: '集中モード', exact: true }).boundingBox()
  expect(focus?.x).toBeGreaterThan(dash?.x ?? 0)
  await page.getByRole('button', { name: '集中モード', exact: true }).click()
  await expect(page.getByRole('button', { name: 'ダッシュ', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '集中モードの表示設定' }).click()
  await page.getByRole('menuitemcheckbox', { name: '記法・ショートカットを表示' }).click()
  await expect(page.getByRole('button', { name: 'ダッシュ', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '集中モードの表示設定' }).click()
  await page.getByRole('menuitemcheckbox', { name: '操作ボタンを表示' }).click()
  await expect(page.getByRole('button', { name: '集中モードを終了', exact: true })).toHaveCount(0)
  await expect(ta).toBeVisible()
  await page.reload()
  await page.goto('/')
  await page.getByRole('button', { name: '「集中のテスト」を執筆' }).click()
  await expect(page.getByRole('button', { name: 'ダッシュ', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '集中モードを終了', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '集中モードの表示設定' }).click()
  await page.getByRole('menuitemcheckbox', { name: '操作ボタンを表示' }).click()
  await expect(page.getByRole('button', { name: '集中モードを終了', exact: true })).toBeVisible()
})

test('縦書き入力は同じ本文を保持し、集中時は全幅で列を中央に保つ', async ({ page }) => {
  const ta = await openWriter(page)
  const value = ('夏の風が木々を揺らし、白い雲が流れる。'.repeat(12) + '\n').repeat(12)
  await ta.fill(value)
  await ta.evaluate((el) => { (window as Window & { original?: Element }).original = el; (el as HTMLTextAreaElement).setSelectionRange(1, 3) })
  await page.getByRole('group', { name: '本文の組み方向' }).getByRole('button', { name: '縦書き', exact: true }).click()
  await expect(ta).toHaveCSS('writing-mode', 'vertical-rl')
  expect(await ta.evaluate((el) => el === (window as Window & { original?: Element }).original)).toBe(true)
  expect(await ta.evaluate((el) => [(el as HTMLTextAreaElement).selectionStart, (el as HTMLTextAreaElement).selectionEnd])).toEqual([1, 3])
  await page.getByRole('button', { name: '集中モード', exact: true }).click()
  const box = await ta.boundingBox()
  expect(box?.width).toBeGreaterThan((page.viewportSize()?.width ?? 1280) - 2)
  await expect(ta).toHaveCSS('scrollbar-width', 'thin')
  await page.getByRole('button', { name: '入力行を中央に保つ', exact: true }).click()
  for (const position of [0, 150, value.length]) {
    await placeCaret(ta, position)
    await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  }
  await placeCaret(ta, 0)
  await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  await ta.hover()
  await page.mouse.wheel(0, 180)
  await expect.poll(() => ta.evaluate((el) => el.scrollLeft)).toBeLessThan(-50)
  const manual = await ta.evaluate((el) => el.scrollLeft)
  await page.waitForTimeout(150)
  expect(await ta.evaluate((el) => el.scrollLeft)).toBeCloseTo(manual, 0)
  await placeCaret(ta, 150)
  await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  await ta.dispatchEvent('compositionstart')
  const scroll = await ta.evaluate((el) => el.scrollLeft)
  await ta.dispatchEvent('input')
  await page.waitForTimeout(100)
  expect(await ta.evaluate((el) => el.scrollLeft)).toBeCloseTo(scroll, 0)
  await ta.dispatchEvent('compositionend')
  await page.getByRole('button', { name: '集中モードの表示設定' }).click()
  await page.getByRole('menuitemcheckbox', { name: '本文を縦書きにする' }).click()
  await expect(ta).toHaveCSS('writing-mode', 'horizontal-tb')
  await expect(ta).toHaveValue(value)
  await placeCaret(ta, value.length)
  await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
})

test('プレビューはホイールで横に読め、入力位置へ縦横とも追従する', async ({ page }) => {
  const ta = await openWriter(page)
  const text = Array.from({ length: 60 }, (_, i) => `段落${i}。${'漢字《かんじ》と《《強調》》の文章。'.repeat(i === 40 ? 80 : 12)}`).join('\n')
  await ta.fill(text)
  const preview = page.locator('article.preview')
  const paragraph = preview.locator('p').nth(40)
  const position = text.indexOf('段落40') + 8
  await placeCaret(ta, position)
  const visible = () => paragraph.evaluate((p) => {
    const parent = p.closest('article')
    if (!parent) return false
    const a = parent.getBoundingClientRect()
    const b = p.getBoundingClientRect()
    return b.right > a.left && b.left < a.right && b.bottom > a.top && b.top < a.bottom
  })
  await expect.poll(visible).toBe(true)
  const before = await preview.evaluate((el) => el.scrollLeft)
  await preview.hover()
  await page.mouse.wheel(0, 250)
  await expect.poll(() => preview.evaluate((el) => el.scrollLeft)).toBeLessThan(before - 100)
  const manual = await preview.evaluate((el) => el.scrollLeft)
  await page.waitForTimeout(200)
  expect(await preview.evaluate((el) => el.scrollLeft)).toBe(manual)
  await placeCaret(ta, position)
  await expect.poll(visible).toBe(true)
  const endPosition = text.indexOf('\n段落41')
  await placeCaret(ta, endPosition)
  const tailVisible = () => paragraph.evaluate((p) => {
    const article = p.closest('article')
    if (!article || !p.lastChild) return false
    const node = p.lastChild
    const range = document.createRange()
    const length = node.textContent?.length ?? 0
    range.setStart(node, Math.max(0, length - 1))
    range.setEnd(node, length)
    const b = range.getBoundingClientRect()
    const vertical = getComputedStyle(article).writingMode === 'vertical-rl'
    const a = (vertical ? article : article.parentElement!).getBoundingClientRect()
    return b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom
  })
  await expect.poll(tailVisible).toBe(true)
  await page.getByRole('group', { name: 'プレビューの組み方向' }).getByRole('button', { name: '横書き', exact: true }).click()
  await expect.poll(tailVisible).toBe(true)
  await expect.poll(visible).toBe(true)
  expect(await preview.evaluate((el) => el.parentElement!.scrollTop)).toBeGreaterThan(1000)
  await placeCaret(ta, 0)
  await expect.poll(() => preview.evaluate((el) => el.parentElement!.scrollTop)).toBeLessThan(100)
  await ta.dispatchEvent('compositionstart')
  await ta.fill(`${text}変換中`)
  await expect.poll(() => preview.evaluate((el) => el.parentElement!.scrollTop)).toBeLessThan(100)
  await ta.dispatchEvent('compositionend')
  await expect.poll(() => preview.evaluate((el) => el.parentElement!.scrollTop)).toBeGreaterThan(1000)
})

test('縦書きで中央追従を保ったまま集中表示を解除してもプレビューに重ならない', async ({ page }) => {
  await page.setViewportSize({ width: 1900, height: 920 })
  const ta = await openWriter(page)
  const value = ('縦書きの本文がプレビューと重ならず、入力位置を中央に保つ。'.repeat(30) + '\n').repeat(27)
  await ta.fill(value)
  await page.getByRole('group', { name: '本文の組み方向' }).getByRole('button', { name: '縦書き', exact: true }).click()
  await page.getByRole('button', { name: '入力行を中央に保つ', exact: true }).click()
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '集中モード', exact: true }).click()
    await placeCaret(ta, Math.floor(value.length / 2))
    await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: '集中モードを終了', exact: true }).click()
    await expect(page.locator('article.preview')).toBeVisible()
    await expect.poll(() => ta.evaluate((el) => {
      const textarea = el.getBoundingClientRect()
      const editor = el.parentElement!.getBoundingClientRect()
      return textarea.right - editor.right
    })).toBeLessThanOrEqual(1)
    await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  }
  await page.setViewportSize({ width: 1100, height: 760 })
  await expect.poll(() => ta.evaluate((el) => el.getBoundingClientRect().right - el.parentElement!.getBoundingClientRect().right)).toBeLessThanOrEqual(1)
  await expect.poll(() => caretError(ta)).toBeLessThanOrEqual(1)
  await expect(ta).toHaveValue(value)
})

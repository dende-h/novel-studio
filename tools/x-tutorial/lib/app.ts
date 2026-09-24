/**
 * 台本から使う、アプリの共通操作。ラベルは E2E（e2e/smoke.spec.ts）と同じものを使う。
 * 画面の文言が変わったらここと E2E を一緒に直す。
 */
import type { Page } from '@playwright/test'

export const BODY = 'textarea[aria-label="本文"]'

/** ライブラリで作品を作る（作成後もライブラリに留まる）。 */
export async function createWork(page: Page, title: string) {
  await page.getByRole('button', { name: '新しい作品' }).click()
  await page.getByLabel('作品タイトル').fill(title)
  await page.getByRole('button', { name: '作成', exact: true }).click()
  await page.getByRole('heading', { name: title }).waitFor()
}

/** 作品カードからエディタへ入る。 */
export async function openWriter(page: Page, title: string) {
  await page.getByRole('button', { name: `「${title}」を執筆` }).click()
}

/** エディタで話を足す（足した話が開く）。 */
export async function addEpisode(page: Page, title: string) {
  await page.getByRole('button', { name: '新しいエピソード', exact: true }).click()
  await page.getByLabel('話タイトル').fill(title)
  await page.getByRole('button', { name: '追加', exact: true }).click()
  await page.getByRole('button', { name: title, exact: true }).waitFor()
}

/** 本文を一度に入れて、自動保存が終わるまで待つ（下ごしらえ用。動画で見せる入力は typeSlow）。 */
export async function fillBody(page: Page, text: string) {
  await page.locator(BODY).fill(text)
  await page.getByText('保存済み').waitFor()
}

/** 作品を作って話を 1 つ足し、本文まで入れた状態にする（下ごしらえの定番）。 */
export async function seedWork(
  page: Page,
  work: string,
  episodes: { title: string; body: string }[],
) {
  await createWork(page, work)
  await openWriter(page, work)
  for (const ep of episodes) {
    await addEpisode(page, ep.title)
    await fillBody(page, ep.body)
  }
}

/** 本文の textarea で、word の最初の出現を選択状態にする（記法ボタンは選択を囲む）。 */
export async function selectWord(page: Page, word: string) {
  await page.locator(BODY).evaluate((el, w) => {
    const ta = el as HTMLTextAreaElement
    const at = ta.value.indexOf(w)
    ta.focus()
    ta.setSelectionRange(at, at + w.length)
  }, word)
}

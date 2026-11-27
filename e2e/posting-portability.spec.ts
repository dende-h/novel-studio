import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const fixtures = resolve('docs/specs/posting-import-fixtures')
const fixture = (path: string) => resolve(fixtures, path)

async function openLibrary(page: Page) {
  await page.addInitScript(() => localStorage.setItem('ns-onboarded', '1'))
  await page.goto('/')
  await page.getByRole('button', { name: '原稿を取り込む' }).click()
}

test('複数TXTとエラーを一緒に確認し、ZIPから既存作品に追加できる', async ({ page }) => {
  await openLibrary(page)
  const dialog = page.getByRole('dialog', { name: '原稿を取り込む' })
  const files = dialog.getByLabel('原稿ファイル', { exact: true })
  await files.setInputFiles([fixture('manuscript/03.txt'), fixture('manuscript/01.txt'), fixture('rejected/image-renamed.txt'), fixture('manuscript/02.txt')])
  await expect(dialog.getByLabel('1話目のタイトル')).toHaveValue('01')
  await expect(dialog.getByLabel('3話目のタイトル')).toHaveValue('03')
  await expect(dialog.getByRole('button', { name: '作品を作る' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'image-renamed.txtを外す' }).click()
  await dialog.getByLabel('作品名', { exact: true }).fill('取込テスト')
  await dialog.getByRole('button', { name: '作品を作る' }).click()
  await expect(page).toHaveURL(/#\/write/)
  await page.goto('/')
  await page.getByRole('button', { name: '原稿を取り込む' }).click()
  await files.setInputFiles(fixture('observed/kakuyomu.zip'))
  await expect(dialog.getByLabel('1話目のタイトル')).toHaveValue('灯り　第一夜')
  await dialog.getByRole('combobox', { name: /^保存先/ }).selectOption({ label: '取込テスト（3話）に追加' })
  await dialog.getByRole('button', { name: '話を追加', exact: true }).click()
  await expect(page.getByText('灯り 第三夜', { exact: true })).toBeVisible()
})

test('フォルダの相対パスとPDF・EPUBの話順をプレビューする', async ({ page }) => {
  await openLibrary(page)
  const dialog = page.getByRole('dialog', { name: '原稿を取り込む' })
  await dialog.getByLabel('原稿フォルダ', { exact: true }).setInputFiles(fixture('observed/folder'))
  await expect(dialog.getByLabel('3話目のタイトル')).toHaveValue('01_原稿')
  await expect(dialog.getByLabel('元の本文')).toHaveValue(await readFile(fixture('observed/folder/章2/01_原稿.txt'), 'utf8'))
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: '原稿を取り込む' }).click()
  await dialog.getByLabel('原稿ファイル', { exact: true }).setInputFiles(fixture('mock/hameln-standard.epub'))
  await expect(dialog.getByLabel('1話目のタイトル')).toHaveValue('灯り　第一夜')
  await expect(dialog.getByLabel('3話目のタイトル')).toHaveValue('灯り 第三夜')
  await expect(dialog.locator('ruby').first()).toContainText('灯台')
  await dialog.getByRole('button', { name: 'hameln-standard.epubを外す' }).click()
  await dialog.getByLabel('原稿ファイル', { exact: true }).setInputFiles(fixture('mock/estar-vertical.pdf'))
  await expect(dialog.getByLabel('1話目のタイトル')).toHaveValue('灯り　第一夜', { timeout: 20_000 })
  await expect(dialog.getByLabel('3話目のタイトル')).toHaveValue('灯り 第三夜')
  await expect(dialog.getByLabel('元の本文')).toHaveValue(/灯台を点ける。/)
  const expected = JSON.parse(await readFile(fixture('expectations.json'), 'utf8')) as { vertical_pdf: [string, string][] }
  for (const [index, [, body]] of expected.vertical_pdf.entries()) {
    await dialog.getByRole('button', { name: '本文', exact: true }).nth(index).click()
    const actual = await dialog.getByLabel('元の本文').inputValue()
    expect(actual.replace(/\s/g, '')).toContain(body.replace(/\s/g, ''))
  }
  await expect(dialog.getByRole('button', { name: '元のPDFを開く' })).toBeVisible()
})

test('ログイン不要の変換から原稿を引き継いで、単話の取込・取消・書き出しができる', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ns-onboarded', '1'))
  await page.goto('/notation-converter/')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await expect(page.getByRole('heading', { name: '小説のルビ・傍点 記法変換' })).toBeVisible()
  const input = page.getByLabel('元の本文', { exact: true })
  await input.fill('[[rb:灯台 > とうだい]]を点ける。\n[[unknown:今も残す]]\n[pixivimage:12]')
  await expect(page.getByLabel('変換後の本文')).toHaveValue(/灯台《とうだい》を点ける。/)
  await expect(page.getByText('3行目　[pixivimage:12]　投稿先で差し替え')).toBeVisible()
  await page.getByRole('button', { name: '本文をコピー' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('灯台《とうだい》')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'TXTで保存', exact: true }).click()
  const download = await downloadPromise
  expect(await readFile((await download.path())!, 'utf8')).toContain('[[unknown:今も残す]]')
  await page.getByRole('button', { name: 'この原稿で書き始める' }).click()
  const create = page.getByRole('dialog', { name: '原稿を取り込む' })
  await expect(create.getByLabel('貼り付ける原稿')).toHaveValue(/今も残す/)
  await create.getByRole('button', { name: '作品を作る' }).click()
  await expect(page).toHaveURL(/#\/write/)
  await page.getByRole('button', { name: '話のメニュー' }).click()
  await page.getByRole('menuitem', { name: '本文を取り込む' }).click()
  const episode = page.getByRole('dialog', { name: '本文を取り込む' })
  const episodeFile = episode.getByLabel('TXTファイルを選ぶ')
  await episodeFile.setInputFiles(fixture('observed/kakuyomu.zip'))
  await expect(episode.getByRole('alert')).toContainText('複数話はホーム')
  await episodeFile.setInputFiles({ name: '続き.txt', mimeType: 'text/plain', buffer: Buffer.from('｜続き《つづき》\n') })
  await episode.getByRole('button', { name: '変更後の本文を確認' }).click()
  await expect(episode.getByLabel('変更後の本文（記法付き）')).toHaveValue(/続き《つづき》\n$/)
  await episode.getByRole('button', { name: '末尾に追加' }).click()
  await expect(episode).toBeHidden()
  await page.getByRole('button', { name: '話のメニュー' }).click()
  await page.getByRole('menuitem', { name: '本文の取り込みを取り消す' }).click()
  await expect(page.getByText('本文の取り込みを取り消しました')).toBeVisible()
  await page.getByRole('button', { name: '書き出し', exact: true }).click()
  const exported = page.getByRole('dialog', { name: 'プロジェクトの書き出し' })
  await exported.getByText('Web投稿形式', { exact: true }).click()
  await exported.getByRole('combobox', { name: '投稿先', exact: true }).selectOption('pixiv')
  await expect(exported.getByLabel('投稿用の本文')).toHaveValue(/^\[\[rb:灯台 > とうだい\]\]/)
  await expect(exported.getByLabel('投稿用の本文')).not.toHaveValue(/続き/)
  await expect(exported.getByLabel('投稿用の本文')).toHaveValue(/今も残す/)
  const zip = page.waitForEvent('download')
  await exported.getByText('カクヨム互換ZIP（作品全体）', { exact: true }).click()
  await exported.getByRole('button', { name: 'カクヨム互換ZIPを保存' }).click()
  expect((await zip).suggestedFilename()).toMatch(/_カクヨム互換\.zip$/)
})

test('ルート直下のカクヨム原稿の全パスを記録し、失敗行を外して再選択できる', async ({ page }) => {
  await openLibrary(page)
  const dialog = page.getByRole('dialog', { name: '原稿を取り込む' })
  const files = dialog.getByLabel('原稿ファイル', { exact: true })
  const about = { name: 'about.txt', mimeType: 'text/plain', buffer: Buffer.from('〖タイトル〗\n作品\n〖目次〗\n1. 話') }
  const chapter = { name: 'episode_0001.txt', mimeType: 'text/plain', buffer: Buffer.from('〖タイトル〗\n話\n〖本文（1行）〗\n確認する本文') }
  await files.setInputFiles([about, chapter])
  await expect(dialog.getByLabel('1話目のタイトル')).toHaveValue('話')
  await files.setInputFiles(chapter)
  await expect(dialog.getByRole('alert')).toContainText('同じ相対パス')
  await dialog.getByRole('button', { name: 'episode_0001.txtを外す' }).click()
  await expect(dialog.getByRole('button', { name: '作品を作る' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'about.txtを外す' }).click()
  await files.setInputFiles([about, { ...chapter, buffer: Buffer.from('〖タイトル〗\n壊れた話') }])
  await expect(dialog.getByRole('alert')).toContainText('本文の見出し')
  await dialog.getByRole('button', { name: 'about.txtを外す' }).click()
  await files.setInputFiles([about, chapter])
  await expect(dialog.getByLabel('1話目のタイトル')).toHaveValue('話')
  await expect(dialog.getByRole('button', { name: '作品を作る' })).toBeEnabled()
})

test('読取中に閉じた画面のWorkerを終了し、開き直した画面を更新しない', async ({ page }) => {
  await page.addInitScript(() => {
    const workers = { hold: true, sent: 0, terminated: 0 }
    Object.assign(window, { __testManuscriptWorkers: workers })
    const NativeWorker = Worker
    window.Worker = class extends NativeWorker {
      private manuscript: boolean
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.manuscript = String(url).includes('manuscript.worker')
      }
      postMessage(message: unknown, transfer: Transferable[] = []) {
        if (this.manuscript) {
          workers.sent += 1
          if (workers.hold) return
        }
        super.postMessage(message, transfer)
      }
      terminate() {
        if (this.manuscript) workers.terminated += 1
        super.terminate()
      }
    }
  })
  await openLibrary(page)
  const dialog = page.getByRole('dialog', { name: '原稿を取り込む' })
  const files = dialog.getByLabel('原稿ファイル', { exact: true })
  await files.setInputFiles(fixture('manuscript/01.txt'))
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__testManuscriptWorkers').sent)).toBe(1)
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__testManuscriptWorkers').terminated)).toBe(1)
  await page.evaluate(() => { Reflect.get(window, '__testManuscriptWorkers').hold = false })
  await page.getByRole('button', { name: '原稿を取り込む' }).click()
  await files.setInputFiles(fixture('manuscript/02.txt'))
  await expect(dialog.getByLabel('1話目のタイトル')).toHaveValue('02')
  await expect(dialog.getByLabel('2話目のタイトル')).toHaveCount(0)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
})

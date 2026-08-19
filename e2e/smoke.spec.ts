import { expect, type Page, test } from '@playwright/test'

// 初回のみ出る保存の仕組みの説明（FirstRunDialog）は、新規コンテキストの各テストで毎回
// 前面に出て見出しを覆い・クリックを奪う。アプリ起動前に「表示済み」フラグ（use-local-flag の
// 'ns-onboarded'='1'）を立てて出さないようにする。ダイアログ自体の検証は unit 側で担保。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ns-onboarded', '1')
    } catch {}
  })
})

/** サイドバーの「新しい作品」から作品を作る（作成後もライブラリに留まる）。 */
const createWork = async (page: Page, title: string) => {
  await page.getByRole('button', { name: '新しい作品' }).click()
  await page.getByLabel('作品タイトル').fill(title)
  await page.getByRole('button', { name: '作成', exact: true }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

/** 作品カード（全面クリック）でエディタへ入る。 */
const openWriter = (page: Page, title: string) =>
  page.getByRole('button', { name: `「${title}」を執筆` }).click()

/** エディタ内で話を追加する。 */
const addEpisode = async (page: Page, title: string) => {
  await page.getByRole('button', { name: '新しいエピソード', exact: true }).click()
  await page.getByLabel('話タイトル').fill(title)
  await page.getByRole('button', { name: '追加', exact: true }).click()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
}

test('入口にマイライブラリ見出しが出る', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'マイライブラリ' })).toBeVisible()
})

/**
 * 参照 [[ ]] にルビ・傍点を重ねた書き方（記法ボタンを続けて押すと自然にこの形になる）。
 * プレビューでリンクと装飾の両方が効き、保存→再読込（blocks 往復）でも記法が失われないこと。
 */
test('参照とルビ・傍点を重ねてもプレビューに反映され、再読込でも保たれる', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '重ね記法E2E')
  await openWriter(page, '重ね記法E2E')
  await addEpisode(page, '第一話')

  const textarea = page.getByRole('textbox', { name: '本文' })
  // 親文字がかな混じりなので ｜ が正本形（漢字だけだと自動ルビへ正規化される）。
  const body = '[[｜お嬢さん《おじょうさん》]]\n[[《《強調》》]]'
  await textarea.fill(body)

  await expect(page.locator('.preview .ref ruby rt')).toHaveText('おじょうさん')
  await expect(page.locator('.preview .ref em.dots')).toHaveText('強調')

  await expect(page.getByText('保存済み')).toBeVisible()
  await page.goto('/')
  await openWriter(page, '重ね記法E2E')
  await expect(page.getByRole('textbox', { name: '本文' })).toHaveValue(body)
})

test('作品作成→執筆→ライブプレビュー→再読込で本文が永続（IndexedDB）', async ({ page }) => {
  await page.goto('/')

  await createWork(page, '作品E2E')
  // 作成だけでは遷移しない（一覧に出る）。カードのクリックでエディタへ。
  await openWriter(page, '作品E2E')

  await addEpisode(page, '第一話')

  // 本文入力 → ライブプレビューが追従
  const textarea = page.getByRole('textbox', { name: '本文' })
  await textarea.fill('漢字《かんじ》\n《《重要》》')
  await expect(page.locator('.preview ruby rt')).toHaveText('かんじ')
  await expect(page.locator('.preview em.dots')).toHaveText('重要')

  // 自動保存を待ち、ライブラリへ戻って執筆し直しても復元できる
  await expect(page.getByText('保存済み')).toBeVisible()
  await page.goto('/')
  await openWriter(page, '作品E2E')
  await expect(page.getByRole('textbox', { name: '本文' })).toHaveValue('漢字《かんじ》\n《《重要》》')
})

test('作品メタ（著者・あらすじ）を編集 → リスト表示に反映され再読込でも残る', async ({
  page,
}) => {
  await page.goto('/')
  await createWork(page, 'メタ作品')

  // カードのケバブメニュー「情報を編集」からメタを入力
  await page.getByRole('button', { name: '「メタ作品」のメニュー' }).click()
  await page.getByRole('menuitem', { name: '情報を編集' }).click()
  await page.getByLabel('著者').fill('山田太郎')
  await page.getByLabel('あらすじ').fill('冒険の物語')
  await page.getByRole('button', { name: '保存' }).click()

  // リスト表示に著者が反映され、再読込しても永続している
  await page.getByRole('button', { name: 'リスト表示' }).click()
  await expect(page.getByText('著者: 山田太郎')).toBeVisible()
  await page.goto('/')
  await expect(page.getByText('著者: 山田太郎')).toBeVisible()
})

test('話の削除 → 一覧から消える', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '削除作品')
  await openWriter(page, '削除作品')

  await addEpisode(page, '第一話')

  // 各話の削除ボタン → 確認ダイアログ → 削除
  // 削除ボタンは行ホバーで現れる（opacity-0 → group-hover）。行を先にホバーして可視化する。
  await page.getByRole('button', { name: '第一話', exact: true }).hover()
  await page.getByRole('button', { name: '「第一話」を削除' }).click()
  await page.getByRole('button', { name: '削除する' }).click()
  await expect(page.getByRole('button', { name: '第一話', exact: true })).toHaveCount(0)
})

test('本文欄がエディタペイン幅いっぱいに広がる（折り返しが狭くならない）', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '幅テスト')
  await openWriter(page, '幅テスト')
  await addEpisode(page, '第一話')

  const textarea = page.getByRole('textbox', { name: '本文' })
  await textarea.waitFor()
  // textarea が固有幅(~312px)に縮まず、エディタ列（親要素）幅の9割以上を占有する
  const dims = await textarea.evaluate((el) => ({
    tw: el.getBoundingClientRect().width,
    pw: el.parentElement ? el.parentElement.getBoundingClientRect().width : 0,
  }))
  expect(dims.pw).toBeGreaterThan(400)
  expect(dims.tw).toBeGreaterThan(dims.pw * 0.9)
})

test('長い無改行の本文がプレビューの紙面内で折り返す（縦書き・横書きとも飛び出さない）', async ({
  page,
}) => {
  await page.goto('/')
  await createWork(page, '折返しテスト')
  await openWriter(page, '折返しテスト')
  await addEpisode(page, '第一話')

  const textarea = page.getByRole('textbox', { name: '本文' })
  await textarea.waitFor()
  await textarea.fill('a'.repeat(300))

  const paper = page.locator('.preview')
  await paper.waitFor()
  // 既定は縦書き：紙面の固定高さを超えて下へ飛び出さない（列へ折り返す）
  const v = await paper.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  expect(v.sh).toBeLessThanOrEqual(v.ch + 2)

  // 横書きに切替：紙面幅を超えて右へ飛び出さない（行へ折り返す）
  await page.getByRole('button', { name: '横書き' }).click()
  const h = await paper.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  expect(h.sw).toBeLessThanOrEqual(h.cw + 2)
})

test('長い無改行の本文でも履歴カードがパネル幅を超えず復元ボタンが届く', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '履歴折返し')
  await openWriter(page, '履歴折返し')
  await addEpisode(page, '第一話')

  await page.getByRole('textbox', { name: '本文' }).fill('a'.repeat(300))
  await expect(page.getByText('保存済み')).toBeVisible()

  await page.getByRole('button', { name: '履歴' }).click()
  const panel = page.getByText('ローカル・セーフティネット').locator('xpath=ancestor::aside')
  await panel.waitFor()
  const card = page
    .getByText('現在の版')
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")]')
  const excerpt = card.locator('p')
  // 抜粋が折り返し、横方向にはみ出さない（スクロール幅が見た目幅を超えない）
  const ex = await excerpt.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  expect(ex.sw).toBeLessThanOrEqual(ex.cw + 2)
  // カード右端がパネル右端を超えない＝はみ出して操作不能にならない
  const panelBox = await panel.boundingBox()
  const cardBox = await card.boundingBox()
  expect((cardBox?.x ?? 0) + (cardBox?.width ?? 0)).toBeLessThanOrEqual(
    (panelBox?.x ?? 0) + (panelBox?.width ?? 0) + 2,
  )
})

test('対応下限〜の狭い画面では履歴ドロワーがオーバーレイ表示で本文幅を狭めない', async ({
  page,
}) => {
  // 対応範囲（lg=1024 以上）かつ xl=1280 未満＝オーバーレイ域
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/')
  await createWork(page, 'オーバーレイ')
  await openWriter(page, 'オーバーレイ')
  await addEpisode(page, '第一話')
  await page.getByRole('textbox', { name: '本文' }).waitFor()

  const paneWidth = () =>
    page.evaluate(() => {
      const pane = document.querySelector('main > div')
      return pane instanceof HTMLElement ? pane.clientWidth : 0
    })
  const before = await paneWidth()
  await page.getByRole('button', { name: '履歴' }).click()
  await expect(page.getByText('ローカル・セーフティネット')).toBeVisible()
  const after = await paneWidth()
  // オーバーレイなので本文ペイン幅は変わらない（インライン列なら ~300px 狭まる）
  expect(Math.abs(after - before)).toBeLessThan(20)
})

test('履歴ドロワーをトグルで開閉できる', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '履歴作品')
  await openWriter(page, '履歴作品')

  await addEpisode(page, '第一話')

  // 初期は履歴ドロワー非表示
  await expect(page.getByText('ローカル・セーフティネット')).toHaveCount(0)

  // 履歴トグルで開く → 閉じるボタンで閉じる
  await page.getByRole('button', { name: '履歴' }).click()
  await expect(page.getByText('ローカル・セーフティネット')).toBeVisible()
  await page.getByRole('button', { name: '履歴を閉じる' }).click()
  await expect(page.getByText('ローカル・セーフティネット')).toHaveCount(0)
})

test('エディタの一括置換で本文をまとめて書き換えられる', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '置換作品')
  await openWriter(page, '置換作品')
  await addEpisode(page, '第一話')

  const textarea = page.getByRole('textbox', { name: '本文' })
  await textarea.fill('猫が来た。猫が鳴いた。')

  await page.getByRole('button', { name: '置換' }).click()
  await page.getByLabel('検索する語').fill('猫')
  await expect(page.getByText('2件 見つかりました')).toBeVisible()
  await page.getByLabel('置換後の語').fill('犬')
  await page.getByRole('button', { name: 'すべて置換' }).click()
  await expect(textarea).toHaveValue('犬が来た。犬が鳴いた。')
})

test('ライブラリの作品名検索で絞り込める', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '静謐の森')
  await createWork(page, '春の列車')

  const search = page.getByRole('searchbox', { name: '作品名で検索' })
  await search.fill('列車')
  await expect(page.getByRole('heading', { name: '春の列車' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '静謐の森' })).toHaveCount(0)

  await search.fill('存在しない題名')
  await expect(page.getByText(/一致する作品がありません/)).toBeVisible()
})

test('サイドバーのマイライブラリでエディタから戻れる', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '戻る作品')
  await openWriter(page, '戻る作品')

  // エディタのサイドバー「マイライブラリ」（戻るリンク）でライブラリへ
  const backLink = page.getByRole('button', { name: 'マイライブラリ' })
  await expect(backLink).toBeVisible()
  await backLink.click()
  await expect(page.getByRole('heading', { name: 'マイライブラリ' })).toBeVisible()
})

// 「スマホ幅では非対応案内を全面表示」のテストは、ライブラリ／エディタをスマホ対応した
// 時点で仕様ごと廃止した。狭幅の回帰は e2e/mobile.spec.ts（mobile プロジェクト）が担う。

test('作品の削除 → ライブラリから消える', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '消える作品')

  // カードのケバブメニューから削除 → 確認 → カードが消える
  await page.getByRole('button', { name: '「消える作品」のメニュー' }).click()
  await page.getByRole('menuitem', { name: 'ゴミ箱へ移動' }).click()
  await page.getByRole('button', { name: 'ゴミ箱へ移動' }).click()
  await expect(page.getByRole('heading', { name: '消える作品' })).toHaveCount(0)
})

test('ゲスト（pk 不在）では同期 UI が一切出ない（Phase 2 ゲスト回帰）', async ({ page }) => {
  // pnpm dev は VITE_CLERK_PUBLISHABLE_KEY 無しで起動するため常にゲスト。
  // 同期コードは結線済み（main→Root→useSync）だが、ゲストでは全層 no-op になり
  // SyncStatusBanner は null を返す。見出しが出る＝同期コードを積んでも壊れず、
  // かつバナー文言・「今すぐ同期」が一切出ないことを確認する（執筆動作は他テストが担保）。
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'マイライブラリ' })).toBeVisible()

  await expect(page.getByText('別の端末でログイン')).toHaveCount(0)
  await expect(page.getByText('保存容量の上限')).toHaveCount(0)
  await expect(page.getByText('オフラインのため同期を保留')).toHaveCount(0)
  await expect(page.getByText('同期中…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '今すぐ同期' })).toHaveCount(0)
})

/**
 * index.html の「起動前の受け」は、アプリが起動できなかったときだけ 1 回自動で取り直す。
 * 起動後に遅れて失敗した動的チャンクまで拾うと、main.tsx が毎回リトライ記録を消すため
 * 無限に再読み込みが繰り返される（本番で実際に起き、白画面のまま復帰できなくなった）。
 * 起動後の module script 失敗では再読み込みが走らないことを固定する。
 */
test('起動後に module script が失敗しても自動再読み込みが走らない', async ({ page }) => {
  let navigations = 0
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations++
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'マイライブラリ' })).toBeVisible()
  expect(await page.evaluate(() => window.__nsBooted === true)).toBe(true)

  // 起動後に動的チャンクの取得が失敗する状況を作る（Clerk のチャンクなどで実際に起きた）
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const s = document.createElement('script')
        s.type = 'module'
        s.src = '/assets/this-chunk-does-not-exist.js'
        s.addEventListener('error', () => resolve())
        s.addEventListener('load', () => resolve())
        document.head.appendChild(s)
      })
  )
  await page.waitForTimeout(2000)

  // 最初の 1 回（goto）以外にナビゲーションが起きていない＝再読み込みループしていない
  expect(navigations).toBe(1)
  await expect(page.getByRole('heading', { name: 'マイライブラリ' })).toBeVisible()
})

/**
 * 復元前の差分ダイアログは変更が多いと最大高（800px）を超える。DialogBody の子が
 * flex で押し潰されると overflow-hidden な差分ボックスの中身がクリップされ、
 * スクロールもできず「画面に入る分しか読めない」状態になる（実際に起きた不具合）。
 * 本文がスクロールでき、末尾の差分まで辿れることを確認する。
 */
test('復元の差分ダイアログは変更が多くても本文をスクロールして最後まで読める', async ({
  page,
}) => {
  await page.goto('/')
  await createWork(page, '差分スクロール')
  await openWriter(page, '差分スクロール')
  await addEpisode(page, '第一話')

  const textarea = page.getByRole('textbox', { name: '本文' })
  const base = Array.from(
    { length: 120 },
    (_, i) => `${i}行目の本文です。${'あ'.repeat(40)}`
  ).join('\n')
  await textarea.fill(base)
  await expect(page.getByText('保存済み')).toBeVisible()

  // 履歴は 90 秒以内の保存を最新版へ合体する。実時間を待つ代わりに記録済みの版の時刻を
  // 過去へずらし、次の保存が「新しい版」として積まれる（＝復元できる版が生まれる）ようにする。
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('novel-studio', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite')
          const store = tx.objectStore('kv')
          const keys = store.getAllKeys()
          keys.onsuccess = () => {
            for (const key of keys.result.map(String).filter((k) => k.startsWith('snap:'))) {
              const got = store.get(key)
              got.onsuccess = () => {
                const snaps = got.result as { at: number }[]
                store.put(
                  snaps.map((s) => ({ ...s, at: s.at - 600_000 })),
                  key
                )
              }
            }
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      })
  )

  // 離れた多数の行を書き換える（＝差分がダイアログに収まらない）
  await textarea.fill(
    base
      .split('\n')
      .map((l, i) => (i % 3 === 0 ? `${l}（ここを加筆しました）` : l))
      .join('\n')
  )

  await page.getByRole('button', { name: '履歴' }).click()
  const panel = page.getByText('ローカル・セーフティネット').locator('xpath=ancestor::aside')
  // 自動保存で版が積まれるまで待つ（現在の版には復元ボタンが出ない）
  const restore = panel.getByRole('button', { name: 'この版を復元' })
  await expect(restore).toHaveCount(1)
  await restore.click()

  const body = page.getByRole('dialog').locator('[data-slot=dialog-body]')
  await expect(body).toBeVisible()
  const { scrollH, clientH } = await body.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
  }))
  // 収まりきらない量の差分がある＝スクロールできなければ読めない
  expect(scrollH).toBeGreaterThan(clientH * 2)
  const scrolledTo = await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight
    return el.scrollTop
  })
  expect(scrolledTo).toBeGreaterThan(0)
})

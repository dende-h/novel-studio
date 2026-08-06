import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { Work } from '@/core/schema'

/**
 * 公開サイトへの投稿ダイアログ。
 * 誓約（規約同意）を勝手に立てないこと・公開できないときに理由が伝わることを固定する。
 */

const ORIGIN = 'https://platform.example'

/** VITE_PLATFORM_ORIGIN は取り込み時に読まれるので、stub してから動的 import する。 */
async function loadDialog() {
  vi.stubEnv('VITE_PLATFORM_ORIGIN', ORIGIN)
  vi.resetModules()
  return import('./publish-dialog')
}

function makeWork(overrides: Partial<Work> = {}): Work {
  return {
    id: 'w1',
    title: '銀河の詩',
    episodes: [{ id: 'e1', title: '第一話', blocks: parseEpisodeBody('むかしむかし') }],
    ...overrides,
  }
}

/** 投稿 API の応答をひとつ返す fetch スタブ。 */
function stubFetch(body: Record<string, unknown>, status = 200) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status, statusText: 'OK' }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 送信されたバンドルの work.platform を取り出す。 */
function sentPlatform(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return (JSON.parse(init.body as string) as { work: Work }).work.platform
}

const getToken = async () => 'jwt'

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('PublishDialog（入力と誓約）', () => {
  it('誓約は既定でオフ。「公開して投稿」は押せず、理由をその場に出す', async () => {
    const { PublishDialog } = await loadDialog()
    render(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={makeWork()}
        getToken={getToken}
        onPersist={() => {}}
      />,
    )

    expect(screen.getByRole('checkbox', { name: /全年齢向け/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /一次創作/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '公開して投稿' })).toBeDisabled()
    expect(screen.getByText(/上の誓約2つにチェックが必要です/)).toBeInTheDocument()
  })

  it('誓約が片方だけでは「公開して投稿」は押せない', async () => {
    const { PublishDialog } = await loadDialog()
    render(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={makeWork()}
        getToken={getToken}
        onPersist={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /全年齢向け/ }))
    expect(screen.getByRole('button', { name: '公開して投稿' })).toBeDisabled()
  })

  it('誓約なしでも「下書きとして投稿」はでき、visibility=draft で送る', async () => {
    const { PublishDialog } = await loadDialog()
    const fetchMock = stubFetch({ ok: true, published: false, manageUrl: '/dashboard' })
    render(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={makeWork()}
        getToken={getToken}
        onPersist={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '下書きとして投稿' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(sentPlatform(fetchMock)).toMatchObject({
      visibility: 'draft',
      declaredAllAges: false,
      declaredOriginal: false,
    })
    expect(await screen.findByText(/下書きとして投稿しました/)).toBeInTheDocument()
  })

  it('誓約2つとあらすじ・ジャンル・タグ・完結・形式を載せて公開投稿する', async () => {
    const { PublishDialog } = await loadDialog()
    const fetchMock = stubFetch({
      ok: true,
      published: true,
      publishBlocked: null,
      manageUrl: '/dashboard/works/x/episodes',
      workUrl: '/works/x',
    })
    const onPersist = vi.fn()
    render(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={makeWork()}
        getToken={getToken}
        onPersist={onPersist}
      />,
    )

    fireEvent.change(screen.getByLabelText('あらすじ'), { target: { value: '星をめぐる話' } })
    fireEvent.change(screen.getByLabelText('ジャンル'), { target: { value: 'SF' } })
    fireEvent.change(screen.getByLabelText(/タグ/), { target: { value: '宇宙、旅' } })
    fireEvent.click(screen.getByRole('switch', { name: /完結している/ }))
    fireEvent.click(screen.getByRole('button', { name: '読み切り' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /全年齢向け/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /一次創作/ }))
    fireEvent.click(screen.getByRole('button', { name: '公開して投稿' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(sentPlatform(fetchMock)).toEqual({
      genre: 'SF',
      tags: ['宇宙', '旅'],
      declaredAllAges: true,
      declaredOriginal: true,
      visibility: 'public',
      isCompleted: true,
      kind: 'oneshot',
    })

    // 公開できたら読者ページの導線を出す
    expect(await screen.findByText(/公開しました/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /公開ページを開く/ })).toHaveAttribute(
      'href',
      `${ORIGIN}/works/x`,
    )

    // 次に開いたとき・再投稿のために、入力と投稿結果を作品へ保存する
    expect(onPersist).toHaveBeenCalledTimes(1)
    const [workId, values] = onPersist.mock.calls[0] as [
      string,
      { platform: Record<string, unknown> },
    ]
    expect(workId).toBe('w1')
    expect(values.platform).toMatchObject({ visibility: 'public', workUrl: `${ORIGIN}/works/x` })
    expect(values.platform.lastPublishedAt).toEqual(expect.any(Number))
  })

  it('タグが上限を超えると投稿できず、理由を出す', async () => {
    const { PublishDialog } = await loadDialog()
    const fetchMock = stubFetch({ ok: true })
    render(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={makeWork()}
        getToken={getToken}
        onPersist={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText(/タグ/), { target: { value: 'あ、い、う、え、お、か' } })

    expect(screen.getByRole('alert')).toHaveTextContent('タグは5件までです')
    expect(screen.getByRole('button', { name: '下書きとして投稿' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('PublishDialog（投稿結果の見せ方）', () => {
  it('誓約が欠けて公開されなかったら、何をすればよいか伝える', async () => {
    const { PublishDialog } = await loadDialog()
    stubFetch({
      ok: true,
      published: false,
      publishBlocked: 'declarations-missing',
      manageUrl: '/dashboard',
    })
    render(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={makeWork()}
        getToken={getToken}
        onPersist={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '下書きとして投稿' }))

    expect(await screen.findByText(/2つの誓約にチェックを入れて/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /公開ページを開く/ })).toBeNull()
    // 下書きでも管理画面へは行ける
    expect(screen.getByRole('link', { name: /管理画面を開く/ })).toHaveAttribute(
      'href',
      `${ORIGIN}/dashboard`,
    )
  })

  it('失敗したら理由と登録導線を出し、作品には何も保存しない', async () => {
    const { PublishDialog } = await loadDialog()
    stubFetch(
      { error: 'not-author', message: '作者登録が必要です', registerUrl: '/dashboard' },
      403,
    )
    const onPersist = vi.fn()
    render(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={makeWork()}
        getToken={getToken}
        onPersist={onPersist}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '下書きとして投稿' }))

    expect(await screen.findByText('作者登録が必要です')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /作者登録へ進む/ })).toHaveAttribute(
      'href',
      `${ORIGIN}/dashboard`,
    )
    expect(onPersist).not.toHaveBeenCalled()
  })
})

describe('PublishDialog（前回の投稿設定の引き継ぎ）', () => {
  it('保存済みの設定と誓約を復元する（作者自身が前に立てた宣言なので復元する）', async () => {
    const { PublishDialog } = await loadDialog()
    render(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={makeWork({
          description: '前回のあらすじ',
          platform: {
            genre: '恋愛',
            tags: ['青春'],
            declaredAllAges: true,
            declaredOriginal: true,
            visibility: 'public',
            isCompleted: true,
            kind: 'oneshot',
            lastPublishedAt: 1,
          },
        })}
        getToken={getToken}
        onPersist={() => {}}
      />,
    )

    expect(screen.getByLabelText('あらすじ')).toHaveValue('前回のあらすじ')
    expect(screen.getByLabelText('ジャンル')).toHaveValue('恋愛')
    expect(screen.getByLabelText(/タグ/)).toHaveValue('青春')
    expect(screen.getByRole('checkbox', { name: /全年齢向け/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /一次創作/ })).toBeChecked()
    expect(screen.getByRole('button', { name: '読み切り' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '公開して投稿' })).toBeEnabled()
  })
})

describe('parseTags / validateTags（自由タグ）', () => {
  it('読点・カンマ・改行で区切り、空と重複を落とす', async () => {
    const { parseTags } = await loadDialog()
    expect(parseTags('宇宙、旅,宇宙\n 冒険 、')).toEqual(['宇宙', '旅', '冒険'])
    expect(parseTags('')).toEqual([])
  })

  it('5件まで・1件30字までに収まっているかを判定する', async () => {
    const { validateTags } = await loadDialog()
    expect(validateTags(['a', 'b', 'c', 'd', 'e'])).toBeNull()
    expect(validateTags(['a', 'b', 'c', 'd', 'e', 'f'])).toContain('5件まで')
    expect(validateTags(['あ'.repeat(31)])).toContain('30字まで')
  })
})

describe('PublishDialog（設定の作り直し）', () => {
  it('ジャンルを「未選択」に戻したら、前回のジャンルを送らない', async () => {
    const { PublishDialog } = await loadDialog()
    const fetchMock = stubFetch({ ok: true, published: false, manageUrl: '/dashboard' })
    render(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={makeWork({ platform: { genre: '恋愛', lastPublishedAt: 7 } })}
        getToken={getToken}
        onPersist={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('ジャンル'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きとして投稿' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(sentPlatform(fetchMock)).not.toHaveProperty('genre')
  })
})

describe('PublishDialog（投稿後の再描画）', () => {
  it('投稿結果を作品へ保存して work が差し替わっても、結果と導線を消さない', async () => {
    const { PublishDialog } = await loadDialog()
    stubFetch({ ok: true, published: true, manageUrl: '/dashboard', workUrl: '/works/x' })
    const before = makeWork()
    const { rerender } = render(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={before}
        getToken={getToken}
        onPersist={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /全年齢向け/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /一次創作/ }))
    fireEvent.click(screen.getByRole('button', { name: '公開して投稿' }))
    expect(await screen.findByText(/公開しました/)).toBeInTheDocument()

    // 保存で work が新しいオブジェクトになる（store 経由の実際の流れを再現）
    rerender(
      <PublishDialog
        open
        onOpenChange={() => {}}
        work={{ ...before, platform: { visibility: 'public', lastPublishedAt: 1 } }}
        getToken={getToken}
        onPersist={() => {}}
      />,
    )

    expect(screen.getByText(/公開しました/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /公開ページを開く/ })).toBeInTheDocument()
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { Work } from '@/core/schema'
import { PublishPage } from './publish-page'

/**
 * 公開ページ。ここは**取り消しの効かない行為**の入口なので、
 * 「何が公開されるのか」「いつ反映されるのか」が画面の状態と一致することを固定する。
 */

const publishWorkToPlatform = vi.fn()
const fetchAuthorStatus = vi.fn()
const registerAuthorApi = vi.fn()

vi.mock('@/ui/_api/publish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ui/_api/publish')>()),
  publishWorkToPlatform: (...args: unknown[]) => publishWorkToPlatform(...args),
}))

vi.mock('@/ui/_api/author', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ui/_api/author')>()),
  fetchAuthorStatus: (...args: unknown[]) => fetchAuthorStatus(...args),
  registerAuthor: (...args: unknown[]) => registerAuthorApi(...args),
}))

const getToken = async () => 'jwt'

function makeWork(platform?: Work['platform']): Work {
  return {
    id: 'w1',
    title: '銀河の詩',
    episodes: [
      { id: 'e1', title: '第一話', blocks: parseEpisodeBody('むかしむかし') },
      { id: 'e2', title: '第二話', blocks: parseEpisodeBody('あるところに') },
    ],
    ...(platform ? { platform } : {}),
  }
}

/** 誓約が揃っていて公開できる状態の作品 */
const publishable: Work['platform'] = {
  declaredAllAges: true,
  declaredOriginal: true,
  visibility: 'public',
}

function renderPage(work: Work, onPersist = vi.fn()) {
  render(<PublishPage work={work} getToken={getToken} isSignedIn onPersist={onPersist} />)
  return { onPersist }
}

beforeEach(() => {
  publishWorkToPlatform.mockReset().mockResolvedValue({
    ok: true,
    created: false,
    episodesUpserted: 2,
    episodesRemoved: 0,
    manageUrl: 'https://platform.example/dashboard',
    published: true,
    publishBlocked: null,
  })
  fetchAuthorStatus
    .mockReset()
    .mockResolvedValue({ ok: true, status: { isAuthor: true, suspended: false, penName: '結' } })
  registerAuthorApi.mockReset().mockResolvedValue({ ok: true, penName: '夜半' })
})

describe('話ごとの公開', () => {
  it('作品が下書きのあいだは切り替えられない', async () => {
    // 作品が非公開なら話の状態に意味が無い。触れると「公開したつもり」が生まれる
    renderPage(makeWork({ visibility: 'draft' }))

    for (const title of ['第一話', '第二話']) {
      expect(await screen.findByRole('switch', { name: `「${title}」を公開する` })).toBeDisabled()
    }
  })

  it('作品を公開に切り替えると操作でき、既定は全話公開になる', async () => {
    renderPage(makeWork(publishable))

    expect(await screen.findByText('2 / 2 話を公開')).toBeInTheDocument()

    expect(screen.getByRole('switch', { name: '「第二話」を公開する' })).toBeEnabled()
  })
})

describe('公開状態の更新', () => {
  it('確認ダイアログで OK するまで送らない', async () => {
    renderPage(makeWork(publishable))

    fireEvent.click(await screen.findByRole('button', { name: /公開状態を更新/ }))
    expect(publishWorkToPlatform).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: '公開する' }))
    await waitFor(() => expect(publishWorkToPlatform).toHaveBeenCalledOnce())
  })

  it('伏せた話は非公開のまま送る', async () => {
    const { onPersist } = renderPage(makeWork(publishable))

    // 第二話だけ伏せる
    fireEvent.click(await screen.findByRole('switch', { name: '「第二話」を公開する' }))
    expect(await screen.findByText('1 / 2 話を公開')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /公開状態を更新/ }))
    fireEvent.click(await screen.findByRole('button', { name: '公開する' }))

    await waitFor(() => expect(publishWorkToPlatform).toHaveBeenCalledOnce())
    const sent = publishWorkToPlatform.mock.calls[0]?.[1] as Work
    expect(sent.platform?.episodeVisibility).toEqual({ e2: 'draft' })
    // 反映できた内容は作品にも残す（次に開いたときと再送に引き継ぐ）
    await waitFor(() => expect(onPersist).toHaveBeenCalledOnce())
    const persisted = onPersist.mock.calls[0]?.[1] as { platform: NonNullable<Work['platform']> }
    expect(persisted.platform.episodeVisibility).toEqual({ e2: 'draft' })
  })

  it('誓約が欠けたまま公開は選べない（押せない理由をその場に出す）', async () => {
    renderPage(makeWork({ visibility: 'public' }))

    expect(await screen.findByRole('button', { name: /公開状態を更新/ })).toBeDisabled()
    expect(screen.getByText(/誓約2つにチェックが必要/)).toBeInTheDocument()
  })
})

describe('どの名前で公開されるか', () => {
  it('登録済みの作者名を、押す前に画面へ出す', async () => {
    renderPage(makeWork(publishable))

    expect(await screen.findByRole('heading', { name: '作者名' })).toBeInTheDocument()
    expect(screen.getByText('結')).toBeInTheDocument()
  })

  it('ペンネームとは別の設定であること・変えると公開済みの作品にも及ぶことを言う', async () => {
    // 利用者の不安は 2 つある。「どちらの名前で出るのか」と「片方を変えたらもう片方も
    // 変わるのか」。どちらも画面に書いていなければ確かめようがないので、文言を固定する。
    renderPage(makeWork(publishable))

    expect(
      await screen.findByText(
        /コトノハのペンネームとは別の設定なので、ペンネームを変えてもここは変わりません/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/変えると、これまでに公開した作品の作者名も一緒に変わります/),
    ).toBeInTheDocument()
  })

  it('公開の確認ダイアログにも作者名を出す（押す直前の最後の一言）', async () => {
    renderPage(makeWork(publishable))

    fireEvent.click(await screen.findByRole('button', { name: /公開状態を更新/ }))
    expect(await screen.findByText(/作者名「結」で公開します/)).toBeInTheDocument()
  })

  it('作者登録がまだなら作者名は出さない（登録カードが名前の話をしている）', async () => {
    fetchAuthorStatus.mockResolvedValue({
      ok: true,
      status: { isAuthor: false, suspended: false, penName: '結' },
    })
    renderPage(makeWork(publishable))

    await screen.findByRole('button', { name: '作者登録する' })
    expect(screen.queryByRole('heading', { name: '作者名' })).toBeNull()
  })
})

describe('作者登録', () => {
  it('未登録なら、公開サイトへ飛ばさずこの場で登録できる', async () => {
    fetchAuthorStatus.mockResolvedValue({
      ok: true,
      status: { isAuthor: false, suspended: false, penName: '結' },
    })
    renderPage(makeWork(publishable))

    const penName = await screen.findByLabelText(/作者名/)
    expect(penName).toHaveValue('結')
    fireEvent.change(penName, { target: { value: '夜半' } })

    // 同意しないと登録できない（公開サイトのモーダルと同じ条件）
    const register = screen.getByRole('button', { name: '作者登録する' })
    expect(register).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /投稿ガイドライン/ }))
    fireEvent.click(register)

    await waitFor(() => expect(registerAuthorApi).toHaveBeenCalledOnce())
    expect(registerAuthorApi.mock.calls[0]?.[1]).toMatchObject({ penName: '夜半' })
    // 登録できたらカードは消え、公開へ進める
    await waitFor(() => expect(screen.queryByRole('button', { name: '作者登録する' })).toBeNull())
  })
})

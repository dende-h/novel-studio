import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DELETED_BODY_TEXT, HIDDEN_BODY_TEXT } from '@/core/board/permission'
import type { BoardMeResponse, BoardPost, BoardThread, BoardThreadDetail } from '@/core/board/types'
import { AuthContext, type AuthState, GUEST_AUTH_STATE } from '@/ui/auth/auth-context'
import { ThreadView } from './thread-view'

const NOW = Date.UTC(2026, 7, 28, 12, 0, 0)

// ---------------------------------------------------------------------------
// 素材
// ---------------------------------------------------------------------------

const threadOf = (over: Partial<BoardThread> = {}): BoardThread => ({
  id: 't1',
  kind: 'request',
  title: '章ごとの文字数を出してほしい',
  author: { displayName: '青井', staff: false, retired: false },
  mine: false,
  status: '',
  statusNote: '',
  shippedVersion: '',
  pinned: false,
  locked: false,
  replyCount: 1,
  likeCount: 3,
  liked: false,
  hasPoll: false,
  excerpt: '',
  createdAt: NOW - 86_400_000,
  bumpedAt: NOW - 60_000,
  deleted: false,
  ...over,
})

const postOf = (over: Partial<BoardPost> = {}): BoardPost => ({
  id: 'p1',
  threadId: 't1',
  seq: 1,
  author: { displayName: '青井', staff: false, retired: false },
  mine: false,
  body: '話ごとではなく章ごとに知りたいです',
  replyTo: 0,
  deleted: false,
  hidden: false,
  createdAt: NOW - 86_400_000,
  likeCount: 0,
  liked: false,
  links: [],
  ...over,
})

const detailOf = (over: Partial<BoardThreadDetail> = {}): BoardThreadDetail => ({
  thread: threadOf(),
  posts: [postOf()],
  poll: null,
  canPost: false,
  ...over,
})

const meOf = (over: Partial<BoardMeResponse> = {}): BoardMeResponse => ({
  profile: {
    userId: 'u1',
    displayName: '青井',
    role: 'member',
    bannedUntil: 0,
    deletedAt: 0,
    createdAt: NOW - 100,
    updatedAt: NOW - 100,
  },
  banned: false,
  posts: [],
  ...over,
})

/**
 * サインイン済みの文脈。**`available` は false のままにする**＝ TopAppBar が Clerk の
 * `UserButton`（`<ClerkProvider>` の中でしか描けない）を出さない。掲示板が見ているのは
 * `isSignedIn` と `getToken` だけなので、この画面のテストには足りる。
 */
const signedInAuth: AuthState = {
  ...GUEST_AUTH_STATE,
  status: 'free',
  isSignedIn: true,
  userId: 'u1',
  getToken: async () => 'jwt',
}

// ---------------------------------------------------------------------------
// 配線
// ---------------------------------------------------------------------------

/** `fetch` の代わり。`src/ui/_api/board.ts` は `ok` / `status` / `json()` しか見ない。 */
const respond = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
})

/**
 * 掲示板の 2 本（詳細・自分）だけを返す fetch。**未ログインの経路も試したい**ので、
 * `me` を渡さなければ 401 を返す（クライアントはトークンが無ければ往復せずに落とすが、
 * 応答の形は本物と同じにしておく）。
 */
function stubFetch(detail: BoardThreadDetail, me?: BoardMeResponse) {
  const fn = vi.fn(async (path: string) => {
    if (path.startsWith('/api/board/thread')) return respond(detail)
    if (path.startsWith('/api/board/me')) {
      return me ? respond(me) : respond({ error: 'unauthorized' }, 401)
    }
    return respond({ error: 'not_found' }, 404)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

interface ViewProps {
  onBack?: () => void
  onNavigateBoard?: () => void
  onNavigateHelp?: () => void
}

function renderView(auth: AuthState = GUEST_AUTH_STATE, props: ViewProps = {}) {
  return render(
    <AuthContext.Provider value={auth}>
      <ThreadView
        threadId="t1"
        onBack={props.onBack ?? (() => {})}
        onNavigateCollection={() => {}}
        onNavigateBoard={props.onNavigateBoard}
        onNavigateHelp={props.onNavigateHelp}
        now={NOW}
      />
    </AuthContext.Provider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('ThreadView — 削除・非表示の本文（§7-6）', () => {
  it('削除された投稿の本文を DOM に出さない', async () => {
    stubFetch(
      detailOf({
        posts: [
          postOf(),
          // サーバは伏字に差し替えて返すが（visiblePost）、素の本文が来ても画面が出さないことを固定する。
          postOf({ id: 'p2', seq: 2, body: 'ひみつの本文', deleted: true }),
        ],
      }),
    )
    renderView()

    expect(await screen.findByText('話ごとではなく章ごとに知りたいです')).toBeInTheDocument()
    expect(screen.queryByText('ひみつの本文')).toBeNull()
    expect(screen.getByText(DELETED_BODY_TEXT)).toBeInTheDocument()
  })

  it('運営が非表示にした投稿の本文も出さない', async () => {
    stubFetch(
      detailOf({
        posts: [postOf(), postOf({ id: 'p2', seq: 2, body: '晒された連絡先', hidden: true })],
      }),
    )
    renderView()

    expect(await screen.findByText(HIDDEN_BODY_TEXT)).toBeInTheDocument()
    expect(screen.queryByText('晒された連絡先')).toBeNull()
  })
})

describe('ThreadView — 未ログイン（§2 読むのは自由・書くのはログイン）', () => {
  it('本文は読めて、返信フォームの代わりにサインインの導線が出る', async () => {
    stubFetch(detailOf({ canPost: false }))
    const openSignIn = vi.fn()
    renderView({ ...GUEST_AUTH_STATE, available: true, openSignIn })

    // 未ログインでも中身は読める
    expect(await screen.findByText('話ごとではなく章ごとに知りたいです')).toBeInTheDocument()
    // 書く側は閉じている
    expect(screen.queryByLabelText('返信を書く')).toBeNull()
    expect(screen.queryByRole('button', { name: '書き込む' })).toBeNull()

    const signIn = screen.getByRole('button', { name: 'ログイン' })
    fireEvent.click(signIn)
    expect(openSignIn).toHaveBeenCalledTimes(1)
  })

  it('ログイン済みで書けるスレには返信フォームが出る', async () => {
    stubFetch(detailOf({ canPost: true }), meOf())
    renderView(signedInAuth)

    expect(await screen.findByLabelText('返信を書く')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ログイン' })).toBeNull()
  })
})

describe('ThreadView — 自分のスレの削除（D-BOARD-DELETE）', () => {
  it('返信のあるスレでは「返信は残る」と先に伝える', async () => {
    stubFetch(
      detailOf({
        thread: threadOf({ mine: true }),
        posts: [
          postOf({ mine: true }),
          postOf({
            id: 'p2',
            seq: 2,
            author: { displayName: '緑川', staff: false, retired: false },
          }),
        ],
        canPost: true,
      }),
      meOf(),
    )
    renderView(signedInAuth)

    fireEvent.click(await screen.findByRole('button', { name: '削除' }))

    expect(screen.getByText('このスレッドを削除しますか？')).toBeInTheDocument()
    expect(screen.getByText(/本文だけが消え、返信は残ります/)).toBeInTheDocument()
  })

  it('返信が 1 件も無いスレでは「スレッドごと消える」と伝える', async () => {
    stubFetch(
      detailOf({
        thread: threadOf({ mine: true }),
        posts: [postOf({ mine: true })],
        canPost: true,
      }),
      meOf(),
    )
    renderView(signedInAuth)

    fireEvent.click(await screen.findByRole('button', { name: '削除' }))
    expect(screen.getByText(/スレッドごと消えます/)).toBeInTheDocument()
  })

  it('運営が伏せた返信しか無くても「返信は残る」側に倒す（行の有無で数える）', async () => {
    stubFetch(
      detailOf({
        thread: threadOf({ mine: true, replyCount: 0 }),
        posts: [postOf({ mine: true }), postOf({ id: 'p2', seq: 2, body: '', hidden: true })],
        canPost: true,
      }),
      meOf(),
    )
    renderView(signedInAuth)

    fireEvent.click(await screen.findByRole('button', { name: '削除' }))
    expect(screen.getByText(/本文だけが消え、返信は残ります/)).toBeInTheDocument()
  })
})

describe('ThreadView — 投稿者の見え方', () => {
  it('運営の投稿には運営バッジが出る', async () => {
    stubFetch(
      detailOf({
        posts: [postOf({ author: { displayName: 'コトノハ運営', staff: true, retired: false } })],
      }),
    )
    renderView()

    expect(await screen.findByText('コトノハ運営')).toBeInTheDocument()
    expect(screen.getByText('運営')).toBeInTheDocument()
  })

  it('運営でない投稿にはバッジを出さない', async () => {
    stubFetch(detailOf())
    renderView()

    expect(await screen.findByText('青井')).toBeInTheDocument()
    expect(screen.queryByText('運営')).toBeNull()
  })

  it('退会した人の投稿は残り、伏せ名で出る（D-BOARD-ACCOUNTDEL）', async () => {
    stubFetch(
      detailOf({
        posts: [
          postOf(),
          postOf({
            id: 'p2',
            seq: 2,
            body: '応援しています',
            author: { displayName: '退会したユーザー', staff: false, retired: true },
          }),
        ],
      }),
    )
    renderView()

    expect(await screen.findByText('退会したユーザー')).toBeInTheDocument()
    expect(screen.getByText('応援しています')).toBeInTheDocument()
  })
})

describe('ThreadView — 👍 は書き込みごと（0009）', () => {
  it('スレッドの見出しには置かず、書き込みカードの中だけに出す', async () => {
    stubFetch(
      detailOf({
        thread: threadOf({ kind: 'request', likeCount: 34 }),
        posts: [postOf({ likeCount: 34 }), postOf({ id: 'p2', seq: 2, body: '私も欲しい' })],
      }),
    )
    renderView(signedInAuth)

    expect(await screen.findByText('章ごとの文字数を出してほしい')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: /賛同/ })
    // 書き込みの数だけ在る＝見出しの 1 つ（スレ全体への賛同）は消えている。
    expect(buttons).toHaveLength(2)
    for (const button of buttons) expect(button.closest('article')).not.toBeNull()
    // 数は 0 のとき出さない（「賛同 0」は「誰にも賛同されていない」と読める）。
    expect(buttons[0]).toHaveTextContent('34')
    expect(buttons[1]?.textContent).toBe('賛同')
  })

  it('雑談スレの書き込みにも出す（種別では絞らない）', async () => {
    stubFetch(detailOf({ thread: threadOf({ kind: 'chat' }) }))
    renderView(signedInAuth)

    expect(await screen.findByRole('button', { name: /賛同/ })).toBeInTheDocument()
  })

  it('押した書き込みだけを描き直す（?post= に送り、他のカードは動かさない）', async () => {
    const fetchMock = stubFetch(
      detailOf({
        posts: [postOf({ likeCount: 3 }), postOf({ id: 'p2', seq: 2, body: '私も欲しい' })],
      }),
      meOf(),
    )
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/board/like')) {
        return respond({ liked: true, likeCount: 1, postId: 'p2' })
      }
      if (path.startsWith('/api/board/thread')) {
        return respond(
          detailOf({
            posts: [postOf({ likeCount: 3 }), postOf({ id: 'p2', seq: 2, body: '私も欲しい' })],
          }),
        )
      }
      return respond(meOf())
    })
    renderView(signedInAuth)

    const buttons = await screen.findAllByRole('button', { name: /賛同/ })
    const second = buttons[1]
    if (!second) throw new Error('2 件めの賛同ボタンが無い')
    fireEvent.click(second)

    await screen.findByText('私も欲しい')
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/board/like?post=p2')).toBe(true)
    const after = screen.getAllByRole('button', { name: /賛同/ })
    expect(after[1]).toHaveTextContent('1')
    // 1 件めは押していないので数が変わらない。
    expect(after[0]).toHaveTextContent('3')
  })
})

describe('ThreadView — 返信番号', () => {
  it('返信先が付いた投稿に >>N を出す', async () => {
    stubFetch(
      detailOf({
        posts: [postOf(), postOf({ id: 'p2', seq: 2, body: 'たしかに欲しいです', replyTo: 1 })],
      }),
    )
    renderView()

    expect(await screen.findByRole('button', { name: '>>1' })).toBeInTheDocument()
  })
})

describe('ThreadView — 👍 を押せる条件（canLike と揃える）', () => {
  /** 投稿禁止中の自分。期限は未来（`isBanned` は `bannedUntil > now`）。 */
  const bannedMe = (): BoardMeResponse =>
    meOf({
      banned: true,
      profile: {
        userId: 'u1',
        displayName: '青井',
        role: 'member',
        bannedUntil: NOW + 3_600_000,
        deletedAt: 0,
        createdAt: NOW - 100,
        updatedAt: NOW - 100,
      },
    })

  it('ロック中のスレでは押せない。理由を添えて残す', async () => {
    stubFetch(
      detailOf({
        thread: threadOf({ locked: true }),
        posts: [postOf({ likeCount: 3 })],
        canPost: false,
      }),
      meOf(),
    )
    renderView(signedInAuth)

    expect(await screen.findByRole('button', { name: /賛同/ })).toBeDisabled()
    // ボタンごと消さない＝賛同の数（締めた時点の根拠）は読めるまま
    expect(screen.getByRole('button', { name: /賛同/ })).toHaveTextContent('3')
    expect(
      screen.getByText(/書き込みを終了したスレッドには、賛同を付けられません/),
    ).toBeInTheDocument()
  })

  it('投稿禁止中も押せない', async () => {
    stubFetch(detailOf({ canPost: false }), bannedMe())
    renderView(signedInAuth)

    expect(await screen.findByRole('button', { name: /賛同/ })).toBeDisabled()
    expect(screen.getByText(/いまは賛同を付けられません/)).toBeInTheDocument()
  })

  it('削除されたスレでは押せない', async () => {
    stubFetch(detailOf({ thread: threadOf({ deleted: true }), canPost: false }), meOf())
    renderView(signedInAuth)

    expect(await screen.findByRole('button', { name: /賛同/ })).toBeDisabled()
    expect(screen.getByText(/削除されたスレッドには、賛同を付けられません/)).toBeInTheDocument()
  })

  it('生きているスレでは押せる。理由も出さない', async () => {
    stubFetch(detailOf({ canPost: true }), meOf())
    renderView(signedInAuth)

    expect(await screen.findByRole('button', { name: /賛同/ })).toBeEnabled()
    expect(screen.queryByText(/賛同を付けられません/)).toBeNull()
  })

  it('未ログインでは押せるままにする（押した先にログインの導線がある）', async () => {
    stubFetch(detailOf({ canPost: false }))
    renderView({ ...GUEST_AUTH_STATE, available: true, openSignIn: vi.fn() })

    expect(await screen.findByRole('button', { name: /賛同/ })).toBeEnabled()
  })
})

describe('ThreadView — 書けない理由の案内', () => {
  it('削除済みのスレでは、削除されたことと一覧への戻り道を出す', async () => {
    const onBack = vi.fn()
    stubFetch(
      detailOf({
        thread: threadOf({ deleted: true }),
        posts: [postOf({ body: '', deleted: true })],
        canPost: false,
      }),
      meOf(),
    )
    renderView(signedInAuth, { onBack })

    expect(await screen.findByText(/このスレッドは削除されました/)).toBeInTheDocument()
    // 「書き込めません」だけで終わらせない
    expect(screen.queryByText('このスレッドには書き込めません。')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('投稿禁止の案内には、期限と問い合わせ先の両方を出す', async () => {
    const onNavigateHelp = vi.fn()
    stubFetch(
      detailOf({ canPost: false }),
      meOf({
        banned: true,
        profile: {
          userId: 'u1',
          displayName: '青井',
          role: 'member',
          bannedUntil: NOW + 3_600_000,
          deletedAt: 0,
          createdAt: NOW - 100,
          updatedAt: NOW - 100,
        },
      }),
    )
    renderView(signedInAuth, { onNavigateHelp })

    expect(await screen.findByText(/いまは書き込みを止めています/)).toBeInTheDocument()
    expect(
      screen.getByText(/心当たりがなければ、ヘルプからお問い合わせください/),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ヘルプを開く' }))
    expect(onNavigateHelp).toHaveBeenCalledTimes(1)
  })
})

describe('ThreadView — サイドバーの掲示板', () => {
  it('onNavigateBoard を渡すと掲示板の行が出て、押すと呼ばれる', async () => {
    stubFetch(detailOf(), meOf())
    const onNavigateBoard = vi.fn()
    renderView(signedInAuth, { onNavigateBoard })

    await screen.findByText('章ごとの文字数を出してほしい')
    // 本文上部の「掲示板」（戻る）とサイドバーの行の 2 つ。サイドバーは DOM 上で先。
    const rows = screen.getAllByRole('button', { name: '掲示板' })
    expect(rows.length).toBe(2)

    const sideRow = rows[0]
    if (!sideRow) throw new Error('サイドバーの掲示板行が無い')
    fireEvent.click(sideRow)
    expect(onNavigateBoard).toHaveBeenCalledTimes(1)
  })

  it('渡さなければ掲示板の行を出さない', async () => {
    stubFetch(detailOf(), meOf())
    renderView(signedInAuth)

    await screen.findByText('章ごとの文字数を出してほしい')
    expect(screen.getAllByRole('button', { name: '掲示板' }).length).toBe(1)
  })
})

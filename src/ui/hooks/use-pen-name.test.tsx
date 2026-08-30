import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState, GUEST_AUTH_STATE } from '@/ui/auth/auth-context'
import type { EditorStore } from '@/ui/store/editorStore'
import { useAccountPenNameSync, useSaveProfile } from './use-pen-name'

/**
 * ペンネームをアカウント 1 つにつき 1 つへ揃える配線のテスト。
 *
 * いちばん効かせたいのは**アカウントを切り替えたら前の人の名前が残らない**こと
 * （記名式の掲示板でいちばん高くつく事故）。判定そのものは
 * `src/core/profile/account.ts` に固定してあるので、ここでは**判定の結果が
 * store と通信のどちらに届くか**を見る。
 */

// ---------------------------------------------------------------------------
// 素材
// ---------------------------------------------------------------------------

type StoreCalls = {
  adopt: [string, string | null][]
  update: { penName: string; avatar: string; accountId?: string | null }[]
}

/** `EditorStore` のうち、この配線が触る 3 つだけを持つ最小の代役。 */
function fakeStore(profile: { penName?: string; accountId?: string }): {
  store: EditorStore
  calls: StoreCalls
} {
  const calls: StoreCalls = { adopt: [], update: [] }
  const store = {
    getSnapshot: () => ({ profile }),
    adoptPenName: async (penName: string, accountId: string | null) => {
      calls.adopt.push([penName, accountId])
    },
    updateProfile: async (input: {
      penName: string
      avatar: string
      accountId?: string | null
    }) => {
      calls.update.push(input)
    },
  } as unknown as EditorStore
  return { store, calls }
}

const signedIn = (userId: string): AuthState => ({
  ...GUEST_AUTH_STATE,
  status: 'free',
  isSignedIn: true,
  userId,
  getToken: async () => 'jwt',
})

/** `/api/board/me` だけ返す fetch（board.ts は ok / status / json しか見ない）。 */
function stubMe(displayName: string | null) {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      profile:
        displayName === null
          ? null
          : {
              userId: 'u',
              displayName,
              role: 'member',
              bannedUntil: 0,
              deletedAt: 0,
              createdAt: 1,
              updatedAt: 1,
            },
      banned: false,
      posts: [],
    }),
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// サインイン時の突き合わせ
// ---------------------------------------------------------------------------

function renderSync(auth: AuthState, store: EditorStore) {
  function Probe() {
    useAccountPenNameSync(store)
    return null
  }
  return render(
    <AuthContext.Provider value={auth}>
      <Probe />
    </AuthContext.Provider>,
  )
}

describe('useAccountPenNameSync', () => {
  it('サーバの表示名をローカルのペンネームへ写す', async () => {
    stubMe('夜半')
    const { store, calls } = fakeStore({ penName: '古い名', accountId: 'user_1' })
    renderSync(signedIn('user_1'), store)

    await waitFor(() => expect(calls.adopt).toEqual([['夜半', 'user_1']]))
  })

  it('別アカウントの名前は伏せる（前の利用者の名前で書き込ませない）', async () => {
    stubMe(null)
    const { store, calls } = fakeStore({ penName: '前の人', accountId: 'user_1' })
    renderSync(signedIn('user_2'), store)

    await waitFor(() => expect(calls.adopt).toEqual([['', null]]))
  })

  it('未サインインでは問い合わせない（ローカルだけで書く人の名前を触らない）', () => {
    const fetchMock = stubMe('夜半')
    const { store, calls } = fakeStore({ penName: '仮の名' })
    renderSync(GUEST_AUTH_STATE, store)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.adopt).toEqual([])
  })

  it('同じ名前なら書き込まない（起動のたびに LWW を揺らさない）', async () => {
    const fetchMock = stubMe('夜半')
    const { store, calls } = fakeStore({ penName: '夜半', accountId: 'user_1' })
    renderSync(signedIn('user_1'), store)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(calls.adopt).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------

function renderSave(auth: AuthState, store: EditorStore) {
  const result: { save?: (input: { penName: string; avatar: string }) => Promise<unknown> } = {}
  function Probe() {
    result.save = useSaveProfile(store)
    return <span>ready</span>
  }
  render(
    <AuthContext.Provider value={auth}>
      <Probe />
    </AuthContext.Provider>,
  )
  return result as { save: (input: { penName: string; avatar: string }) => Promise<unknown> }
}

describe('useSaveProfile', () => {
  it('サインイン中はサーバの表示名にも同じ名前を送り、通ってからローカルへ書く', async () => {
    const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        profile: {
          userId: 'u',
          displayName: '夜半',
          role: 'member',
          bannedUntil: 0,
          deletedAt: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        banned: false,
        posts: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { store, calls } = fakeStore({})
    const { save } = renderSave(signedIn('user_1'), store)
    await screen.findByText('ready')

    expect(await save({ penName: ' 夜半 ', avatar: '' })).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/board/me')
    // サーバが正規化した名前で保存する＝掲示板と画面で字面がずれない。
    expect(calls.update).toEqual([{ penName: '夜半', avatar: '', accountId: 'user_1' }])
  })

  it('サーバに弾かれたらローカルにも書かない（掲示板と画面で違う名前を作らない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'duplicate' }) })),
    )
    const { store, calls } = fakeStore({})
    const { save } = renderSave(signedIn('user_1'), store)
    await screen.findByText('ready')

    expect(await save({ penName: '夜半', avatar: '' })).toEqual({
      ok: false,
      message: 'この表示名は、すでに使われています。ほかの名前でお試しください',
    })
    expect(calls.update).toEqual([])
  })

  it('未サインインならローカルだけに保存する（アカウントの印は付けない）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { store, calls } = fakeStore({})
    const { save } = renderSave(GUEST_AUTH_STATE, store)
    await screen.findByText('ready')

    expect(await save({ penName: '仮の名', avatar: '' })).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.update).toEqual([{ penName: '仮の名', avatar: '', accountId: null }])
  })

  it('名前を空にしたときはサーバへ送らない（過去の書き込みから名前を消さない）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { store, calls } = fakeStore({ penName: '夜半', accountId: 'user_1' })
    const { save } = renderSave(signedIn('user_1'), store)
    await screen.findByText('ready')

    expect(await save({ penName: '   ', avatar: '' })).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.update).toEqual([{ penName: '   ', avatar: '', accountId: null }])
  })
})

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState } from '@/ui/auth/auth-context'
import { publishSyncStatus, resetSyncStatus } from '@/ui/sync/sync-status'
import { TopAppBar } from './top-app-bar'

// 会員の UserButton は lazy で Clerk を読み込むのでスタブ化（描画されることだけ観測する）。
vi.mock('@/ui/auth/clerk-user-button', () => ({
  default: () => <div data-testid="user-button" />,
}))

describe('TopAppBar（トップバー）', () => {
  it('onToggleHistory 指定時は履歴トグルを表示し、クリックで発火する', () => {
    const onToggleHistory = vi.fn()
    render(<TopAppBar onToggleHistory={onToggleHistory} historyOpen={false} />)
    const btn = screen.getByRole('button', { name: '履歴' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)
    expect(onToggleHistory).toHaveBeenCalledTimes(1)
  })

  it('historyOpen=true のとき aria-pressed=true', () => {
    render(<TopAppBar onToggleHistory={() => {}} historyOpen />)
    expect(screen.getByRole('button', { name: '履歴' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('onToggleHistory 未指定なら履歴トグルを出さない', () => {
    render(<TopAppBar />)
    expect(screen.queryByRole('button', { name: '履歴' })).toBeNull()
  })
})

/** 既定（available なゲスト）に上書きを重ねた AuthState を作る。 */
function authState(overrides: Partial<AuthState>): AuthState {
  return {
    available: true,
    status: 'guest',
    isSignedIn: false,
    userId: null,
    graceUntil: null,
    canRestore: false,
    displayName: null,
    openSignIn: vi.fn(),
    openSignUp: vi.fn(),
    signOut: vi.fn(),
    getToken: async () => null,
    ...overrides,
  }
}

function renderWithAuth(value: AuthState) {
  return render(
    <AuthContext.Provider value={value}>
      <TopAppBar />
    </AuthContext.Provider>,
  )
}

describe('TopAppBar / AccountControl（同期アカウント表示）', () => {
  it('Clerk 未構成（available=false）ではアカウント表示を出さない', () => {
    renderWithAuth(authState({ available: false }))
    expect(screen.queryByText('ログインでクラウドバックアップ')).toBeNull()
  })

  it('未ログインのゲストは「ログインでクラウドバックアップ」を出し、クリックで openSignIn', () => {
    const openSignIn = vi.fn()
    renderWithAuth(authState({ status: 'guest', isSignedIn: false, openSignIn }))
    const btn = screen.getByRole('button', { name: /ログインでクラウドバックアップ/ })
    fireEvent.click(btn)
    expect(openSignIn).toHaveBeenCalledTimes(1)
  })

  it('会員（member）は Clerk UserButton（解約/サインアウト内包）を出す', async () => {
    renderWithAuth(authState({ status: 'member', isSignedIn: true, displayName: '紫式部' }))
    // lazy 解決後に UserButton が出る（解約・グレース中の再開・サインアウトは Clerk 側のメニュー）。
    expect(await screen.findByTestId('user-button')).toBeInTheDocument()
  })

  it('判定中（loading）は何も出さない（ちらつき防止）', () => {
    renderWithAuth(authState({ status: 'loading' }))
    expect(screen.queryByText('ログインでクラウドバックアップ')).toBeNull()
  })
})

describe('TopAppBar / SyncIndicator（同期中の表示）', () => {
  afterEach(() => resetSyncStatus())

  it('同期中は小さく「同期中…」を出す（トーストで知らせない）', async () => {
    render(<TopAppBar />)
    act(() => publishSyncStatus({ enabled: true, syncing: true }))
    expect(await screen.findByText('同期中…')).toBeInTheDocument()
  })

  it('同期していないときは何も出さない（常設の警告を置かない）', () => {
    render(<TopAppBar />)
    act(() => publishSyncStatus({ enabled: true, syncing: false, lastSyncedAt: 1 }))
    expect(screen.queryByText('同期中…')).toBeNull()
  })

  it('非会員（同期が無効）では出さない', () => {
    render(<TopAppBar />)
    act(() => publishSyncStatus({ enabled: false, syncing: true }))
    expect(screen.queryByText('同期中…')).toBeNull()
  })
})

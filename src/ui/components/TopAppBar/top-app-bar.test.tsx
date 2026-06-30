import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState } from '@/ui/auth/auth-context'
import { TopAppBar } from './top-app-bar'

// アップグレードダイアログは lazy で Clerk 料金表を読み込むので、トップバーのテストでは
// 軽量スタブに差し替え（開閉だけ観測する）。
vi.mock('@/ui/components/UpgradeDialog/upgrade-dialog', () => ({
  UpgradeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="upgrade-dialog" /> : null,
}))

// 会員の UserButton も lazy で Clerk を読み込むのでスタブ化（描画されることだけ観測する）。
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
    expect(screen.queryByText('同期オフ（ログインで同期）')).toBeNull()
    expect(screen.queryByText('アップグレードで同期')).toBeNull()
  })

  it('未ログインのゲストは「同期オフ（ログインで同期）」を出し、クリックで openSignIn', () => {
    const openSignIn = vi.fn()
    renderWithAuth(authState({ status: 'guest', isSignedIn: false, openSignIn }))
    const btn = screen.getByRole('button', { name: /同期オフ（ログインで同期）/ })
    fireEvent.click(btn)
    expect(openSignIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('アップグレードで同期')).toBeNull()
  })

  it('サインイン済みだが未課金（guest かつ isSignedIn）は「アップグレードで同期」を出す', () => {
    renderWithAuth(authState({ status: 'guest', isSignedIn: true }))
    expect(screen.getByRole('button', { name: /アップグレードで同期/ })).toBeInTheDocument()
    // 未ログイン用の「ログインで同期」は出さない（既にサインイン済みのため）。
    expect(screen.queryByText('同期オフ（ログインで同期）')).toBeNull()
  })

  it('「アップグレードで同期」クリックで課金ダイアログを開く', () => {
    renderWithAuth(authState({ status: 'guest', isSignedIn: true }))
    expect(screen.queryByTestId('upgrade-dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /アップグレードで同期/ }))
    expect(screen.getByTestId('upgrade-dialog')).toBeInTheDocument()
  })

  it('未課金サインイン済みでもサインアウトでき、signOut が呼ばれる', () => {
    const signOut = vi.fn()
    renderWithAuth(authState({ status: 'guest', isSignedIn: true, signOut }))
    fireEvent.click(screen.getByRole('button', { name: 'サインアウト' }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('会員（member）は Clerk UserButton（解約/サインアウト内包）を出し、アップグレード導線は出さない', async () => {
    renderWithAuth(authState({ status: 'member', isSignedIn: true, displayName: '紫式部' }))
    // lazy 解決後に UserButton が出る（解約・グレース中の再開・サインアウトは Clerk 側のメニュー）。
    expect(await screen.findByTestId('user-button')).toBeInTheDocument()
    expect(screen.queryByText('アップグレードで同期')).toBeNull()
  })

  it('判定中（loading）は何も出さない（ちらつき防止）', () => {
    renderWithAuth(authState({ status: 'loading' }))
    expect(screen.queryByText('アップグレードで同期')).toBeNull()
    expect(screen.queryByText('同期オフ（ログインで同期）')).toBeNull()
  })
})

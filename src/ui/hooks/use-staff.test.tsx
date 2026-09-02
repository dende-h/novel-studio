import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState, GUEST_AUTH_STATE } from '@/ui/auth/auth-context'
import { useIsStaff } from './use-staff'

const board = vi.hoisted(() => ({ fetchMe: vi.fn() }))
vi.mock('@/ui/_api/board', () => board)

function Probe({ enabled }: { enabled: boolean }) {
  const staff = useIsStaff(enabled)
  return <p>{staff === null ? 'unknown' : staff ? 'staff' : 'member'}</p>
}

const signedIn: AuthState = {
  ...GUEST_AUTH_STATE,
  status: 'free',
  isSignedIn: true,
  getToken: async () => 'jwt',
}

beforeEach(() => {
  board.fetchMe.mockReset()
})

describe('useIsStaff', () => {
  it('enabled でなければ問い合わせず false', () => {
    render(
      <AuthContext.Provider value={signedIn}>
        <Probe enabled={false} />
      </AuthContext.Provider>,
    )
    expect(screen.getByText('member')).toBeInTheDocument()
    expect(board.fetchMe).not.toHaveBeenCalled()
  })

  it('未サインインは問い合わせず false', () => {
    render(
      <AuthContext.Provider value={GUEST_AUTH_STATE}>
        <Probe enabled />
      </AuthContext.Provider>,
    )
    expect(screen.getByText('member')).toBeInTheDocument()
    expect(board.fetchMe).not.toHaveBeenCalled()
  })

  it('サインイン済みなら /api/board/me の role で決める', async () => {
    board.fetchMe.mockResolvedValue({
      ok: true,
      data: { profile: { role: 'staff' }, banned: false, posts: [] },
    })
    render(
      <AuthContext.Provider value={signedIn}>
        <Probe enabled />
      </AuthContext.Provider>,
    )
    expect(screen.getByText('unknown')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('staff')).toBeInTheDocument())
  })

  it('取れない・member なら false', async () => {
    board.fetchMe.mockResolvedValue({ ok: false, code: 'network', message: '', status: 0 })
    render(
      <AuthContext.Provider value={signedIn}>
        <Probe enabled />
      </AuthContext.Provider>,
    )
    await waitFor(() => expect(screen.getByText('member')).toBeInTheDocument())
  })
})

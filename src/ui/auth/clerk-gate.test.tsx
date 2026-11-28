import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useAuth } from './auth-context'
import ClerkGate from './clerk-gate'

const sdk = vi.hoisted(() => ({ openSignUp: vi.fn(), openSignIn: vi.fn() }))
vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: async () => null }),
  useUser: () => ({ user: null }),
  useClerk: () => sdk,
}))

function Actions() {
  const auth = useAuth()
  return (
    <>
      <button type="button" onClick={auth.openSignUp}>
        登録
      </button>
      <button type="button" onClick={auth.openSignIn}>
        ログイン
      </button>
    </>
  )
}

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.clearAllMocks()
})

it('掲示板の認証を切り替えても、ハッシュとクエリを含む同一オリジンへ戻る', () => {
  window.history.replaceState({}, '', '/#/board/event-1?action=reply&post=7')
  render(
    <ClerkGate publishableKey="stub">
      <Actions />
    </ClerkGate>,
  )
  const url = window.location.origin + '/#/board/event-1?action=reply&post=7'
  fireEvent.click(screen.getByRole('button', { name: '登録' }))
  expect(sdk.openSignUp).toHaveBeenCalledWith({
    fallbackRedirectUrl: url,
    signInFallbackRedirectUrl: url,
  })
  fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))
  expect(sdk.openSignIn).toHaveBeenCalledWith({
    fallbackRedirectUrl: url,
    signUpFallbackRedirectUrl: url,
  })
  window.history.replaceState({}, '', '/#/settings')
  fireEvent.click(screen.getByRole('button', { name: '登録' }))
  expect(sdk.openSignUp).toHaveBeenLastCalledWith()
})

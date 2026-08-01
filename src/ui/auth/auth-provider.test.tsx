import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from './auth-context'

/**
 * Clerk 一式は別チャンクなので、本番の初回表示（LP からの cold load）では
 * 「取得できないことがある」を前提にしないといけない。ここで例外を通すと
 * アプリ全体が消えて白い画面になるため、ゲストとして先へ進めることを守る。
 */

// 取得失敗を再現する（再試行も同じく失敗する）。
vi.mock('./clerk-gate', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

function Probe() {
  const auth = useAuth()
  return <p>{`available=${auth.available} status=${auth.status}`}</p>
}

beforeEach(() => {
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('AuthProvider（Clerk チャンクの取得に失敗したとき）', () => {
  it('本文を描き続け、ゲストとして扱う（白い画面にしない）', async () => {
    const { AuthProvider } = await import('./auth-provider')
    render(
      <AuthProvider>
        <p>本文エディタ</p>
        <Probe />
      </AuthProvider>,
    )

    // 再試行（700ms 後）も失敗したあと、ゲストへ倒れる。
    expect(
      await screen.findByText('本文エディタ', undefined, { timeout: 5000 }),
    ).toBeInTheDocument()
    // available=false ＝ 認証 UI 自体を出さない（押しても何も起きないボタンを残さない）
    expect(screen.getByText('available=false status=guest')).toBeInTheDocument()
  })
})

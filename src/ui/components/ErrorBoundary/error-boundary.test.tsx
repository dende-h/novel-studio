import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './error-boundary'

/** 境界の検証には本物の例外が要る。React が出すエラーログは黙らせる。 */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

function Boom({ shouldThrow }: { shouldThrow: boolean }): React.ReactNode {
  if (shouldThrow) throw new Error('チャンクを取得できませんでした')
  return <p>本文</p>
}

describe('ErrorBoundary', () => {
  it('例外が無ければ children をそのまま描く', () => {
    render(
      <ErrorBoundary fallback={() => <p>代替</p>}>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('本文')).toBeInTheDocument()
  })

  it('例外を捕まえて fallback を描く（白い画面にしない）', () => {
    render(
      <ErrorBoundary fallback={(_, error) => <p>代替: {error.message}</p>}>
        <Boom shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/チャンクを取得できませんでした/)).toBeInTheDocument()
  })

  it('onError に捕捉したエラーを渡す', () => {
    const onError = vi.fn()
    render(
      <ErrorBoundary fallback={() => <p>代替</p>} onError={onError}>
        <Boom shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }))
  })

  it('retry で children を張り直せる（一過性の失敗から戻れる）', () => {
    function Harness() {
      const [broken, setBroken] = useState(true)
      return (
        <ErrorBoundary
          fallback={(retry) => (
            <button
              type="button"
              onClick={() => {
                setBroken(false)
                retry()
              }}
            >
              もう一度試す
            </button>
          )}
        >
          <Boom shouldThrow={broken} />
        </ErrorBoundary>
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
    expect(screen.getByText('本文')).toBeInTheDocument()
  })
})

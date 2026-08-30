import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { Work } from '@/core/schema'
import type { ExportFile } from '@/ui/_utils/exporters'
import { AuthContext, type AuthState } from '@/ui/auth/auth-context'
import { ExportDialog } from './export-dialog'

// ダウンロード発火とフォント取得はブラウザ API 依存なのでスタブ化する
vi.mock('@/ui/_utils/download', () => ({ triggerDownload: vi.fn(), readFileText: vi.fn() }))
vi.mock('@/ui/_utils/game-font', () => ({ loadGameFont: async () => undefined }))

import { triggerDownload } from '@/ui/_utils/download'

const writeText = vi.fn()

beforeEach(() => {
  vi.mocked(triggerDownload).mockClear()
  writeText.mockReset().mockResolvedValue(undefined)
  // happy-dom には clipboard が無いので差し込む
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

function makeWork(): Work {
  return {
    id: 'w1',
    title: '銀河の詩',
    episodes: [{ id: 'e1', title: '第一話', blocks: parseEpisodeBody('むかしむかし') }],
  }
}

function makeWorkWithGlossary(): Work {
  return {
    ...makeWork(),
    glossary: [
      {
        id: 'g1',
        name: 'アリス',
        aliases: [],
        summary: '勇敢な少女。',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  }
}

describe('ExportDialog（AI に渡す）', () => {
  it('AI 形式を選ぶとコピー操作になり、本文をクリップボードへ書いて完了表示を出す', async () => {
    render(<ExportDialog open onOpenChange={() => {}} work={makeWork()} />)
    fireEvent.click(screen.getByText('AI に渡す'))
    fireEvent.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# 銀河の詩'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('むかしむかし'))
    expect(await screen.findByText(/コピーしました/)).toBeInTheDocument()
  })

  it('「用語集も一緒にコピー」を ON にすると本文の後ろに用語集が付く', async () => {
    render(<ExportDialog open onOpenChange={() => {}} work={makeWorkWithGlossary()} />)
    fireEvent.click(screen.getByText('AI に渡す'))
    fireEvent.click(screen.getByRole('switch', { name: /用語集も一緒に渡す/ }))
    fireEvent.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0]?.[0] as string
    expect(text).toContain('むかしむかし')
    expect(text).toContain('# 用語集')
    expect(text).toContain('## アリス')
    expect(text).toContain('勇敢な少女。')
  })

  it('用語集トグルが OFF（既定）なら本文だけコピーする', async () => {
    render(<ExportDialog open onOpenChange={() => {}} work={makeWorkWithGlossary()} />)
    fireEvent.click(screen.getByText('AI に渡す'))
    fireEvent.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]?.[0] as string).not.toContain('# 用語集')
  })

  it('コピー失敗時はエラー表示を出す', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    render(<ExportDialog open onOpenChange={() => {}} work={makeWork()} />)
    fireEvent.click(screen.getByText('AI に渡す'))
    fireEvent.click(screen.getByRole('button', { name: 'コピー' }))
    expect(await screen.findByText(/コピーに失敗しました/)).toBeInTheDocument()
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

function renderWithAuth(value: AuthState, props: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  return render(
    <AuthContext.Provider value={value}>
      <ExportDialog open onOpenChange={() => {}} work={makeWork()} {...props} />
    </AuthContext.Provider>,
  )
}

describe('ExportDialog（サウンドノベル）', () => {
  it('ゲストにはサインイン案内を出し、書き出しは無効（無料枠でもアカウント必須）', () => {
    const openSignIn = vi.fn()
    renderWithAuth(authState({ status: 'guest', openSignIn }))
    fireEvent.click(screen.getByText('サウンドノベル'))
    expect(screen.getByText(/無料のアカウント登録が必要です/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '書き出し' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'サインイン' }))
    expect(openSignIn).toHaveBeenCalledTimes(1)
  })

  it('判定中（loading）は確認中の表示で、誤って解禁しない', () => {
    renderWithAuth(authState({ status: 'loading' }))
    fireEvent.click(screen.getByText('サウンドノベル'))
    expect(screen.getByText(/確認しています/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '書き出し' })).toBeDisabled()
  })

  it('無料アカウント（free）なら話と背景を選んで zip を書き出せる', async () => {
    renderWithAuth(authState({ status: 'free', isSignedIn: true }))
    fireEvent.click(screen.getByText('サウンドノベル'))
    expect(screen.getByLabelText('話を選択')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('背景'), { target: { value: 'preset:bg/room-night' } })
    fireEvent.click(screen.getByRole('button', { name: '書き出し' }))
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledTimes(1))
    const file = vi.mocked(triggerDownload).mock.calls[0]?.[0] as ExportFile
    expect(file.filename).toBe('銀河の詩_第一話_novelgame.zip')
    expect(file.mime).toBe('application/zip')
    // PK ヘッダ＝実際に zip が組まれている
    expect((file.data as Uint8Array)[0]).toBe(0x50)
    expect((file.data as Uint8Array)[1]).toBe(0x4b)
  })
})

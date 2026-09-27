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
vi.mock('@/ui/_api/game-templates', () => ({
  fetchTemplateManifest: async () => null,
  fetchTemplateBytes: async () => null,
}))

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

  it('狭い画面では案内を出し、書き出しは無効（作る作業は PC 限定＝D-GAME-PC）', () => {
    // happy-dom はビューポート幅で matchMedia を実評価する（use-narrow.test.ts と同じ手法）
    const { happyDOM } = window as unknown as {
      happyDOM: { setViewport: (v: { width: number }) => void }
    }
    happyDOM.setViewport({ width: 390 })
    try {
      renderWithAuth(authState({ status: 'member', isSignedIn: true }))
      fireEvent.click(screen.getByText('サウンドノベル'))
      expect(screen.getByText(/PC などの広い画面での機能です/)).toBeInTheDocument()
      expect(screen.getByText(/スマートフォンでも遊べます/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '書き出し' })).toBeDisabled()
      // サインイン済みでも作成側の UI（話・背景の選択）は出さない
      expect(screen.queryByLabelText('話を選択')).not.toBeInTheDocument()
    } finally {
      happyDOM.setViewport({ width: 1280 })
    }
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

describe('ExportDialog（脚本・提出用）', () => {
  function makeScriptWork(): Work {
    return {
      ...makeWork(),
      author: '著者',
      description: '読者向け',
      synopsis: '結末まで書いた梗概。',
      format: 'script',
      glossary: [
        {
          id: 'g1',
          name: 'ユイ',
          aliases: [],
          category: '人物',
          summary: '主人公',
          createdAt: 0,
          updatedAt: 0,
        },
        { id: 'g2', name: '公園', aliases: [], category: '場所', createdAt: 0, updatedAt: 0 },
      ],
      episodes: [
        { id: 'e1', title: '第一話', blocks: parseEpisodeBody('○公園\n風が吹く\nユイ「はい」') },
      ],
    }
  }
  it('脚本では「脚本（提出用）」が先頭に出て EPUB・Web投稿形式は出ない。小説では逆', () => {
    const { unmount } = render(
      <ExportDialog open onOpenChange={() => {}} work={makeScriptWork()} />,
    )
    expect(screen.getByText('脚本（提出用）')).toBeInTheDocument()
    expect(screen.queryByText('EPUB / 電子書籍')).toBeNull()
    expect(screen.queryByText('Web投稿形式')).toBeNull()
    expect(screen.getByRole('button', { name: '書き出し' })).toBeEnabled()
    expect(screen.getByText('本文 1 枚（20字×20行換算）')).toBeInTheDocument()
    expect(screen.getByText('用語集の「人物」1 件（名前と説明）を載せます')).toBeInTheDocument()
    expect(screen.getByText(/作品情報の梗概 10 字を載せます/)).toBeInTheDocument()
    unmount()
    render(<ExportDialog open onOpenChange={() => {}} work={makeWork()} />)
    expect(screen.queryByText('脚本（提出用）')).toBeNull()
    expect(screen.getByText('EPUB / 電子書籍')).toBeInTheDocument()
  })
  it('既定は Word A4。「書き出し」で .docx をダウンロードし、B5 に切り替えられる', () => {
    const onOpenChange = vi.fn()
    render(<ExportDialog open onOpenChange={onOpenChange} work={makeScriptWork()} />)
    expect(screen.getByRole('button', { name: 'Word A4・14pt' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: '書き出し' }))
    expect(vi.mocked(triggerDownload)).toHaveBeenCalledTimes(1)
    const a4 = vi.mocked(triggerDownload).mock.calls[0]?.[0] as ExportFile
    expect(a4.filename).toBe('銀河の詩_脚本_A4.docx')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    vi.mocked(triggerDownload).mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Word B5・12pt' }))
    fireEvent.click(screen.getByRole('button', { name: '書き出し' }))
    expect((vi.mocked(triggerDownload).mock.calls[0]?.[0] as ExportFile).filename).toBe(
      '銀河の詩_脚本_B5.docx',
    )
  })
  it('テキストを選ぶと前付け付きの .txt をダウンロードし、前付けを外すと本文だけになる', () => {
    const onOpenChange = vi.fn()
    const { unmount } = render(
      <ExportDialog open onOpenChange={onOpenChange} work={makeScriptWork()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'テキスト（.txt）' }))
    fireEvent.click(screen.getByRole('button', { name: '書き出し' }))
    expect(vi.mocked(triggerDownload)).toHaveBeenCalledTimes(1)
    const full = vi.mocked(triggerDownload).mock.calls[0]?.[0] as ExportFile
    expect(full.filename).toBe('銀河の詩_脚本.txt')
    expect(full.data as string).toContain('登場人物表\n\nユイ　主人公')
    expect(full.data as string).toContain('梗概\n\n　結末まで書いた梗概。')
    expect(full.data as string).toContain('○公園\n　　　風が吹く\nユイ「はい」')
    expect(full.data as string).not.toContain('読者向け')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    unmount()
    vi.mocked(triggerDownload).mockClear()
    render(<ExportDialog open onOpenChange={() => {}} work={makeScriptWork()} />)
    fireEvent.click(screen.getByRole('button', { name: 'テキスト（.txt）' }))
    fireEvent.click(screen.getByRole('switch', { name: /表紙/ }))
    fireEvent.click(screen.getByRole('switch', { name: /登場人物表/ }))
    fireEvent.click(screen.getByRole('switch', { name: /梗概/ }))
    fireEvent.click(screen.getByRole('button', { name: '書き出し' }))
    const bodyOnly = vi.mocked(triggerDownload).mock.calls[0]?.[0] as ExportFile
    expect(bodyOnly.data).toBe('第一話\n\n○公園\n　　　風が吹く\nユイ「はい」\n')
  })
})

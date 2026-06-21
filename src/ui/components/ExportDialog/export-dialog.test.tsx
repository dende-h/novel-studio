import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { Work } from '@/core/schema'
import { ExportDialog } from './export-dialog'

const writeText = vi.fn()

beforeEach(() => {
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

describe('ExportDialog（AI へコピー）', () => {
  it('AI 形式を選ぶとコピー操作になり、本文をクリップボードへ書いて完了表示を出す', async () => {
    render(
      <ExportDialog open onOpenChange={() => {}} work={makeWork()} getAllWorks={async () => []} />,
    )
    fireEvent.click(screen.getByText('AI へコピー'))
    fireEvent.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# 銀河の詩'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('むかしむかし'))
    expect(await screen.findByText(/コピーしました/)).toBeInTheDocument()
  })

  it('「図鑑も一緒にコピー」を ON にすると本文の後ろに図鑑が付く', async () => {
    render(
      <ExportDialog
        open
        onOpenChange={() => {}}
        work={makeWorkWithGlossary()}
        getAllWorks={async () => []}
      />,
    )
    fireEvent.click(screen.getByText('AI へコピー'))
    fireEvent.click(screen.getByRole('switch', { name: /図鑑も一緒にコピー/ }))
    fireEvent.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0]?.[0] as string
    expect(text).toContain('むかしむかし')
    expect(text).toContain('# 図鑑')
    expect(text).toContain('## アリス')
    expect(text).toContain('勇敢な少女。')
  })

  it('図鑑トグルが OFF（既定）なら本文だけコピーする', async () => {
    render(
      <ExportDialog
        open
        onOpenChange={() => {}}
        work={makeWorkWithGlossary()}
        getAllWorks={async () => []}
      />,
    )
    fireEvent.click(screen.getByText('AI へコピー'))
    fireEvent.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]?.[0] as string).not.toContain('# 図鑑')
  })

  it('コピー失敗時はエラー表示を出す', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    render(
      <ExportDialog open onOpenChange={() => {}} work={makeWork()} getAllWorks={async () => []} />,
    )
    fireEvent.click(screen.getByText('AI へコピー'))
    fireEvent.click(screen.getByRole('button', { name: 'コピー' }))
    expect(await screen.findByText(/コピーに失敗しました/)).toBeInTheDocument()
  })
})

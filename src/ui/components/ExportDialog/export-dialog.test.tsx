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

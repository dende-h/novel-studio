import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { serializeBackup } from '@/core/backup'
import { exportBundle } from '@/core/bundle'
import type { Work } from '@/core/schema'
import { ImportDialog } from './import-dialog'

function makeWork(id: string, title: string): Work {
  return { id, title, episodes: [], updatedAt: 1 }
}

/** 隠しファイル入力に JSON を流し込む（ボタン経由のピックを模す）。 */
function pick(json: string, name = 'backup.json') {
  const input = screen.getByLabelText('バックアップ JSON ファイル')
  const file = new File([json], name, { type: 'application/json' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('ImportDialog（バックアップ取り込み）', () => {
  it('正常なバンドルを選ぶと確認相に進み件数と作品名を出す', async () => {
    render(<ImportDialog open onOpenChange={() => {}} onImport={vi.fn()} />)
    pick(exportBundle([makeWork('a', '銀河の終わり'), makeWork('b', '夜明けの塔')]))
    await screen.findByText('2作品', { exact: false })
    expect(screen.getByText('銀河の終わり')).toBeInTheDocument()
    expect(screen.getByText('夜明けの塔')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取り込む' })).toBeEnabled()
  })

  it('「取り込む」で onImport に作品配列を渡し完了相を出す', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined)
    render(<ImportDialog open onOpenChange={() => {}} onImport={onImport} />)
    pick(exportBundle([makeWork('a', '銀河の終わり')]))
    fireEvent.click(await screen.findByRole('button', { name: '取り込む' }))
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'a', title: '銀河の終わり' }),
      ]),
    )
    expect(await screen.findByText('1作品を取り込みました。')).toBeInTheDocument()
  })

  it('壊れた JSON はエラーを出し確認相へ進まない', async () => {
    render(<ImportDialog open onOpenChange={() => {}} onImport={vi.fn()} />)
    pick('{ これは JSON ではない')
    expect(await screen.findByText(/取り込めませんでした/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取り込む' })).toBeNull()
  })

  it('「別のファイル」で確認相から選択相へ戻す', async () => {
    render(<ImportDialog open onOpenChange={() => {}} onImport={vi.fn()} />)
    pick(exportBundle([makeWork('a', '銀河の終わり')]))
    fireEvent.click(await screen.findByRole('button', { name: '別のファイル' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'JSON ファイルを選択' })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: '取り込む' })).toBeNull()
  })

  it('全体バックアップ（createdAt あり）は全置換フローに進み onRestoreAll を呼ぶ', async () => {
    const onRestoreAll = vi.fn().mockResolvedValue(undefined)
    render(
      <ImportDialog open onOpenChange={() => {}} onImport={vi.fn()} onRestoreAll={onRestoreAll} />,
    )
    const json = serializeBackup(
      {
        works: [makeWork('a', '銀河')],
        trash: [],
        profile: {},
        activity: [],
        ideas: [],
        structures: [],
        plots: [],
        stagings: [],
        proofreads: [],
        nameDismissals: [],
        gameAssets: [],
      },
      Date.parse('2026-07-19T00:00:00Z'),
    )
    pick(json)
    fireEvent.click(await screen.findByRole('button', { name: 'すべて置き換えて復元' }))
    await waitFor(() => expect(onRestoreAll).toHaveBeenCalledWith(json))
    expect(await screen.findByText(/全体を復元しました/)).toBeInTheDocument()
  })

  it('全体バックアップの内訳に推敲の判断の話数を出し、置き換えの警告にも推敲の判断を含める', async () => {
    render(<ImportDialog open onOpenChange={() => {}} onImport={vi.fn()} onRestoreAll={vi.fn()} />)
    const decision = {
      blockId: 'b1',
      code: 'variant',
      text: '出来る',
      nth: 0,
      anchor: 'contains',
      verdict: 'fix',
      decidedAt: 1,
    }
    const json = serializeBackup(
      {
        works: [makeWork('a', '銀河')],
        trash: [],
        profile: {},
        activity: [],
        ideas: [],
        structures: [],
        plots: [],
        stagings: [],
        proofreads: [
          { workId: 'a', episodeId: 'e1', decisions: [decision], updatedAt: 1 },
          { workId: 'a', episodeId: 'e2', decisions: [decision], updatedAt: 1 },
        ],
        nameDismissals: [],
        gameAssets: [],
      },
      Date.parse('2026-07-19T00:00:00Z'),
    )
    pick(json)
    expect(await screen.findByText('推敲の判断：2話')).toBeInTheDocument()
    expect(screen.getByText(/ネタ帳・推敲の判断・推敲で外した語・執筆記録/)).toBeInTheDocument()
  })

  it('推敲の判断の無い旧い全体バックアップでも内訳は 0話 で出る', async () => {
    render(<ImportDialog open onOpenChange={() => {}} onImport={vi.fn()} onRestoreAll={vi.fn()} />)
    pick(
      JSON.stringify({
        version: 1,
        createdAt: Date.parse('2026-07-19T00:00:00Z'),
        works: [makeWork('a', '銀河')],
        trash: [],
        profile: {},
      }),
    )
    expect(await screen.findByText('推敲の判断：0話')).toBeInTheDocument()
    expect(screen.getByText('推敲で外した語：0作品')).toBeInTheDocument()
  })

  it('全体バックアップの内訳に推敲で外した語の作品数を出す（壊れた記録は数えない）', async () => {
    render(<ImportDialog open onOpenChange={() => {}} onImport={vi.fn()} onRestoreAll={vi.fn()} />)
    pick(
      JSON.stringify({
        version: 1,
        createdAt: Date.parse('2026-07-19T00:00:00Z'),
        works: [makeWork('a', '銀河')],
        trash: [],
        profile: {},
        nameDismissals: [
          { workId: 'a', words: [{ text: 'アカリ', at: 1 }], updatedAt: 1 },
          { workId: 'b', words: [], updatedAt: 2 },
          { workId: 'c', words: 'broken', updatedAt: 3 },
        ],
      }),
    )
    expect(await screen.findByText('推敲で外した語：2作品')).toBeInTheDocument()
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
})

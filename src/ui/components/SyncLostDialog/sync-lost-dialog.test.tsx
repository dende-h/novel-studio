import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryStore } from '@/core/storage/memoryStore'
import { SyncLostRepository } from '@/core/sync/syncLostRepository'
import { SyncLostDialog } from './sync-lost-dialog'

describe('SyncLostDialog（同期で退避した版）', () => {
  it('退避が無ければその旨だけを出す', async () => {
    const repo = new SyncLostRepository(new MemoryStore())
    render(<SyncLostDialog open onOpenChange={() => {}} repo={repo} />)
    expect(await screen.findByText('退避された版はありません。')).toBeInTheDocument()
  })

  it('構造の退避は書き出せる（内容が端末内に残っていることが分かる）', async () => {
    const repo = new SyncLostRepository(new MemoryStore())
    await repo.save({
      syncId: 'structure:s1',
      at: 1_700_000_000_000,
      kind: 'structure',
      reason: 'conflict',
      title: '相関図メモ',
      json: '{"id":"s1"}',
    })
    render(<SyncLostDialog open onOpenChange={() => {}} repo={repo} />)
    expect(await screen.findByText('相関図メモ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '書き出し' })).toBeInTheDocument()
  })

  it('作品の退避は履歴に残していることを案内する（書き出しボタンは出さない）', async () => {
    const repo = new SyncLostRepository(new MemoryStore())
    await repo.save({
      syncId: 'w1',
      at: 1_700_000_000_000,
      kind: 'work',
      reason: 'conflict',
      title: '銀の魚',
    })
    render(<SyncLostDialog open onOpenChange={() => {}} repo={repo} />)
    expect(await screen.findByText('銀の魚')).toBeInTheDocument()
    expect(
      screen.getByText('この作品の内容は執筆画面の「履歴」に残しています。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '書き出し' })).toBeNull()
  })
})

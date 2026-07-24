import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IdeaRepository } from '@/core/storage/ideaRepository'
import type { KeyValueStore } from '@/core/storage/types'
import { IdeaboxPage } from './idea-box-page'

/** メモリ実装の KeyValueStore。 */
function memStore(): KeyValueStore {
  const m = new Map<string, unknown>()
  return {
    get: async <T,>(k: string) => m.get(k) as T | undefined,
    set: async (k, v) => {
      m.set(k, v)
    },
    delete: async (k) => {
      m.delete(k)
    },
    keys: async (prefix?: string) =>
      [...m.keys()].filter((k) => (prefix ? k.startsWith(prefix) : true)),
  }
}

const makeRepo = () => {
  let n = 0
  let clock = 1000
  return new IdeaRepository(
    memStore(),
    () => `id-${++n}`,
    () => (clock += 1000),
  )
}

describe('IdeaboxPage（ネタ帳）', () => {
  it('入力して追加すると一覧に表示される', async () => {
    render(<IdeaboxPage repo={makeRepo()} onNavigateCollection={() => {}} />)
    fireEvent.change(screen.getByLabelText('新しいネタ'), {
      target: { value: '魔法体系のメモ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(await screen.findByText('魔法体系のメモ')).toBeInTheDocument()
  })

  it('空入力では追加ボタンが無効', () => {
    render(<IdeaboxPage repo={makeRepo()} onNavigateCollection={() => {}} />)
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
  })

  it('削除するとメモが消える', async () => {
    const repo = makeRepo()
    await repo.add('消すネタ')
    render(<IdeaboxPage repo={repo} onNavigateCollection={() => {}} />)
    expect(await screen.findByText('消すネタ')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'このネタを削除' }))
    await waitFor(() => expect(screen.queryByText('消すネタ')).not.toBeInTheDocument())
  })
})

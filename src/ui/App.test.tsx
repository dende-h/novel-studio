import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '../core/storage/memoryStore'
import { WorkRepository } from '../core/storage/workRepository'
import { App } from './App'
import { createEditorStore, type EditorStore } from './store/editorStore'

const makeStore = (repo = new WorkRepository(new MemoryStore())): EditorStore => {
  let n = 0
  return createEditorStore({ repo, genId: () => `id${++n}` })
}

const promptMock = vi.fn<(msg?: string, def?: string) => string | null>()
beforeEach(() => {
  promptMock.mockReset()
  window.prompt = promptMock
})

const newWorkAndEpisode = async (workTitle: string, epTitle: string) => {
  promptMock.mockReturnValueOnce(workTitle).mockReturnValueOnce(epTitle)
  fireEvent.click(screen.getByRole('button', { name: '新規作品' }))
  fireEvent.click(await screen.findByRole('button', { name: '新規話' }))
}

describe('App（結合：作品/話管理・ライブプレビュー・自動保存）', () => {
  it('話が無い時はプレースホルダを表示', () => {
    render(<App store={makeStore()} />)
    expect(screen.getByText(/から始める/)).toBeInTheDocument()
  })

  it('新規作品→新規話→本文入力でライブプレビューが追従', async () => {
    render(<App store={makeStore()} />)
    await newWorkAndEpisode('作品ワン', '第一話')

    const textarea = await screen.findByRole('textbox', { name: '本文' })
    fireEvent.change(textarea, { target: { value: '漢字《かんじ》\n《《重要》》' } })

    await waitFor(() => {
      expect(document.querySelector('.preview ruby rt')?.textContent).toBe('かんじ')
      expect(document.querySelector('.preview em.dots')?.textContent).toBe('重要')
    })
  })

  it('自動保存で永続化され、再読込相当で本文を復元できる', async () => {
    const repo = new WorkRepository(new MemoryStore())
    const { unmount } = render(<App store={makeStore(repo)} />)
    await newWorkAndEpisode('作品ワン', '第一話')

    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: '保存される本文' },
    })
    await waitFor(() => expect(screen.getByText('保存済み')).toBeInTheDocument(), { timeout: 2000 })
    unmount()

    // 同じ repo の別ストア = 再読込
    render(<App store={makeStore(repo)} />)
    fireEvent.click(await screen.findByRole('button', { name: '作品ワン' }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '本文' })).toHaveValue('保存される本文'),
    )
  })
})

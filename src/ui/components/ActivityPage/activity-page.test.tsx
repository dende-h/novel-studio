import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DailyActivity } from '@/core/activity'
import type { ActivityRepository } from '@/core/storage/activityRepository'
import { ActivityPage } from './activity-page'

const day = (date: string, net: number): DailyActivity => ({
  date,
  added: Math.max(0, net),
  removed: Math.max(0, -net),
  net,
  saves: 1,
  updatedAt: 0,
})

/** list() だけ差し替えた最小 repo。 */
const fakeRepo = (days: DailyActivity[]) =>
  ({ list: async () => days }) as unknown as ActivityRepository

describe('ActivityPage', () => {
  it('記録が無ければ空メッセージと連続 0 を出す', async () => {
    render(<ActivityPage repo={fakeRepo([])} onNavigateCollection={() => {}} />)
    expect(await screen.findByText(/ここに草が生えます/)).toBeInTheDocument()
    expect(screen.getByText('連続執筆日数').parentElement?.parentElement).toHaveTextContent('0')
  })

  it('日別データからサマリ（活動日数・通算）を表示する', async () => {
    const repo = fakeRepo([day('2026-07-10', 300), day('2026-07-11', 500)])
    render(<ActivityPage repo={repo} onNavigateCollection={() => {}} />)
    await waitFor(() =>
      expect(screen.getByText('活動した日数').parentElement?.parentElement).toHaveTextContent('2'),
    )
    // 通算の増減 800 字
    expect(screen.getByText('通算の増減').parentElement?.parentElement).toHaveTextContent('800')
  })

  it('左サイドバーの「コレクション」でライブラリへ戻る', async () => {
    const onNavigateCollection = vi.fn()
    render(<ActivityPage repo={fakeRepo([])} onNavigateCollection={onNavigateCollection} />)
    fireEvent.click(await screen.findByText('コレクション'))
    expect(onNavigateCollection).toHaveBeenCalled()
  })

  it('左サイドバーに「執筆の記録」があり、現在地としてハイライトされる', async () => {
    render(<ActivityPage repo={fakeRepo([])} onNavigateCollection={() => {}} />)
    const row = await screen.findByRole('button', { name: '執筆の記録' })
    expect(row).toHaveAttribute('aria-current', 'page')
  })
})

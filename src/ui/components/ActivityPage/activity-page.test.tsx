import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('左サイドバーの「マイライブラリ」でライブラリへ戻る', async () => {
    const onNavigateCollection = vi.fn()
    render(<ActivityPage repo={fakeRepo([])} onNavigateCollection={onNavigateCollection} />)
    fireEvent.click(await screen.findByText('マイライブラリ'))
    expect(onNavigateCollection).toHaveBeenCalled()
  })

  it('左サイドバーに「執筆の記録」があり、現在地としてハイライトされる', async () => {
    render(<ActivityPage repo={fakeRepo([])} onNavigateCollection={() => {}} />)
    const row = await screen.findByRole('button', { name: '執筆の記録' })
    expect(row).toHaveAttribute('aria-current', 'page')
  })

  it('「画像で共有」ボタンがある（記録カードの共有導線）', async () => {
    render(<ActivityPage repo={fakeRepo([])} onNavigateCollection={() => {}} />)
    expect(await screen.findByRole('button', { name: /画像で共有/ })).toBeInTheDocument()
  })
})

describe('ActivityPage の年カレンダーの横スクロール', () => {
  // happy-dom にはレイアウトが無いので、はみ出している状態（表示幅 600px・中身 892px＝54 列）を与える。
  // 計算そのものは heatmap-scroll.test.ts で固定し、ここは「いつ・どの週で」入れるかの結線を見る。
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 25, 12)) // 2026-09-25（2026 年のグリッドの第 38 週）
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 600,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 892,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
  })

  const scroller = () => screen.getByRole('region', { name: '年間の執筆カレンダー' })

  it('今年を開くと、読み込み完了時に今日の週が見える位置まで横にずれる', async () => {
    render(<ActivityPage repo={fakeRepo([])} onNavigateCollection={() => {}} />)
    await screen.findByRole('region', { name: '年間の執筆カレンダー' })
    // 32 + 38*16 + 12 + 2 列ぶんの余白 32 − 600 = 84
    expect(scroller().scrollLeft).toBe(84)
    expect(scroller().querySelector('[aria-current="date"]')).not.toBeNull()
  })

  it('過去の年へ切り替えると左端に戻り、今年へ戻すと今日の週へ合わせ直す', async () => {
    const repo = fakeRepo([day('2025-03-01', 300)])
    render(<ActivityPage repo={repo} onNavigateCollection={() => {}} />)
    await screen.findByRole('region', { name: '年間の執筆カレンダー' })
    expect(scroller().scrollLeft).toBe(84)

    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    expect(scroller().scrollLeft).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '2026' }))
    expect(scroller().scrollLeft).toBe(84)
  })
})

describe('ActivityPage の掲示板導線', () => {
  it('onNavigateBoard を渡すとサイドバーに「掲示板」が出て、押すと呼ばれる', async () => {
    const onNavigateBoard = vi.fn()
    render(
      <ActivityPage
        repo={fakeRepo([])}
        onNavigateCollection={() => {}}
        onNavigateBoard={onNavigateBoard}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: '掲示板' }))
    expect(onNavigateBoard).toHaveBeenCalled()
  })

  it('onNavigateBoard を渡さなければ行を出さない（行き先の無い行を作らない）', async () => {
    render(<ActivityPage repo={fakeRepo([])} onNavigateCollection={() => {}} />)
    await screen.findByRole('button', { name: '執筆の記録' })
    expect(screen.queryByRole('button', { name: '掲示板' })).toBeNull()
  })
})

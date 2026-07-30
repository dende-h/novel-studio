import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SyncOnboarding } from './sync-onboarding'

// 料金カードは別チャンク（lazy）。テストでは実装を読み込まずスタブに差し替える。
vi.mock('@/ui/auth/cloud-pricing', () => ({
  default: () => <div data-testid="cloud-pricing">料金カード</div>,
}))

describe('SyncOnboarding（クラウド同期の案内）', () => {
  it('見出しと（lazy な）料金表を描画する', async () => {
    render(<SyncOnboarding onDismiss={() => {}} />)
    expect(screen.getByRole('heading', { name: 'クラウド同期を始める' })).toBeInTheDocument()
    expect(await screen.findByTestId('cloud-pricing')).toBeInTheDocument()
  })

  it('「いまはしない」で onDismiss を呼ぶ（サインアウトはしない）', () => {
    const onDismiss = vi.fn()
    render(<SyncOnboarding onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'いまはしない' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('無料でできることを明示する（閉じ込められないと伝える）', () => {
    render(<SyncOnboarding onDismiss={() => {}} />)
    expect(screen.getByText(/公開する・ローカル保存はこれまでどおり無料/)).toBeInTheDocument()
  })
})

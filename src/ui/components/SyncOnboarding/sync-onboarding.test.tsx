import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SyncOnboarding } from './sync-onboarding'

// 料金カードは別チャンク（lazy）。テストでは実装を読み込まずスタブに差し替える。
vi.mock('@/ui/auth/cloud-pricing', () => ({
  default: () => <div data-testid="cloud-pricing">料金カード</div>,
}))

describe('SyncOnboarding（未課金オンボーディング）', () => {
  it('見出しと（lazy な）料金表を描画する', async () => {
    render(<SyncOnboarding onUseLocal={() => {}} />)
    expect(screen.getByRole('heading', { name: 'クラウド同期を始める' })).toBeInTheDocument()
    expect(await screen.findByTestId('cloud-pricing')).toBeInTheDocument()
  })

  it('「ローカルのまま使う」で onUseLocal（＝サインアウト）を呼ぶ', () => {
    const onUseLocal = vi.fn()
    render(<SyncOnboarding onUseLocal={onUseLocal} />)
    fireEvent.click(screen.getByRole('button', { name: 'ローカルのまま使う（今はしない）' }))
    expect(onUseLocal).toHaveBeenCalledTimes(1)
  })
})

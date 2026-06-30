import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UpgradeDialog } from './upgrade-dialog'

// 料金表（@clerk/clerk-react）は別チャンク。テストでは実 Clerk を読み込まずスタブで差し替える。
vi.mock('@/ui/auth/clerk-pricing', () => ({
  default: () => <div data-testid="clerk-pricing">料金表</div>,
}))

describe('UpgradeDialog（アップグレード課金導線）', () => {
  it('open=false では何も描画しない', () => {
    render(<UpgradeDialog open={false} onOpenChange={() => {}} />)
    expect(screen.queryByText('アップグレードで同期')).toBeNull()
  })

  it('open=true でタイトルと（lazy な）料金表を描画する', async () => {
    render(<UpgradeDialog open onOpenChange={() => {}} />)
    expect(screen.getByText('アップグレードで同期')).toBeInTheDocument()
    // Suspense 解決後に lazy 読み込みの料金表が出る。
    expect(await screen.findByTestId('clerk-pricing')).toBeInTheDocument()
  })
})

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SmallScreenNotice } from './small-screen-notice'

describe('SmallScreenNotice（スマホ非対応案内）', () => {
  it('非対応の見出しと案内文を表示する', () => {
    const { getByText } = render(<SmallScreenNotice />)
    expect(getByText('スマートフォンには対応していません')).not.toBeNull()
    expect(getByText(/iPad mini 程度の幅）以上でご利用/)).not.toBeNull()
  })

  it('全面オーバーレイで、lg 以上では非表示（lg:hidden）になる', () => {
    const { container } = render(<SmallScreenNotice />)
    const root = container.firstElementChild as HTMLElement
    // 画面全体を覆う固定オーバーレイ
    expect(root.className).toContain('fixed')
    expect(root.className).toContain('inset-0')
    // lg（=iPad mini 横画面相当=1024px）以上では表示しない
    expect(root.className).toContain('lg:hidden')
  })
})

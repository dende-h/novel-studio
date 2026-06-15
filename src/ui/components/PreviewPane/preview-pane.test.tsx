import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PreviewPane } from './preview-pane'

describe('PreviewPane（Presentational）', () => {
  it('渡された HTML をそのまま描画（ruby/傍点）', () => {
    const { container } = render(
      <PreviewPane html="<p><ruby>漢字<rt>かんじ</rt></ruby></p><p><em class=&quot;dots&quot;>重要</em></p>" />,
    )
    expect(container.querySelector('ruby rt')?.textContent).toBe('かんじ')
    expect(container.querySelector('em.dots')?.textContent).toBe('重要')
  })

  it('空 HTML でも落ちない', () => {
    const { container } = render(<PreviewPane html="" />)
    expect(container.querySelector('.preview')).not.toBeNull()
  })

  it('既定は縦書きが選択され、選択中だけが濃い塗り（横書きは淡色）', () => {
    const { getByRole } = render(<PreviewPane html="" />)
    const vertical = getByRole('button', { name: '縦書き' })
    const horizontal = getByRole('button', { name: '横書き' })

    expect(vertical.getAttribute('aria-pressed')).toBe('true')
    expect(horizontal.getAttribute('aria-pressed')).toBe('false')
    // 選択中＝濃い塗りつぶし（淡色 /10 ではない）、非選択＝塗りなし
    expect(vertical.className).toContain('bg-primary')
    expect(vertical.className).not.toContain('bg-primary/10')
    expect(vertical.className).toContain('text-primary-foreground')
    expect(horizontal.className).not.toContain('bg-primary')
  })

  it('横書きをクリックすると選択（濃い塗り）が横書きへ移る', () => {
    const { getByRole } = render(<PreviewPane html="" />)
    const horizontal = getByRole('button', { name: '横書き' })
    fireEvent.click(horizontal)

    expect(horizontal.getAttribute('aria-pressed')).toBe('true')
    expect(horizontal.className).toContain('bg-primary')
    expect(getByRole('button', { name: '縦書き' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('組み方向の切替はグループとしてラベル付けされている', () => {
    const { getByRole } = render(<PreviewPane html="" />)
    expect(getByRole('group', { name: '本文の組み方向' })).not.toBeNull()
  })
})

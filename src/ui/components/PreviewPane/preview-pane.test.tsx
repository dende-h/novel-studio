import { render } from '@testing-library/react'
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
})

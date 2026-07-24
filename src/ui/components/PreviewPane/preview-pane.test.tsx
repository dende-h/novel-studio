import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('既定は縦書き（writing-mode: vertical-rl）、orientation=horizontal で横書きになる', () => {
    const { container, rerender } = render(<PreviewPane html="" />)
    expect(container.querySelector('.preview')?.className).toContain('[writing-mode:vertical-rl]')
    rerender(<PreviewPane html="" orientation="horizontal" />)
    expect(container.querySelector('.preview')?.className).not.toContain(
      '[writing-mode:vertical-rl]',
    )
  })
})

const refHtml =
  '<p><span class="ref" data-ref-name="アリス">アリス</span>と<span class="ref ref--unresolved" data-ref-name="謎">謎</span></p>'

describe('PreviewPane（@参照リンクの操作）', () => {
  it('onRefClick 指定時、.ref はフォーカス可能なリンクになる', () => {
    const { container } = render(<PreviewPane html={refHtml} onRefClick={() => {}} />)
    const ref = container.querySelector('[data-ref-name="アリス"]')
    expect(ref?.getAttribute('role')).toBe('link')
    expect(ref?.getAttribute('tabindex')).toBe('0')
  })

  it('解決/未解決どちらの ref クリックでも名前を通知する', () => {
    const onRefClick = vi.fn()
    render(<PreviewPane html={refHtml} onRefClick={onRefClick} />)
    // 装飾後は role=link になる（解決/未解決とも）。
    fireEvent.click(screen.getByRole('link', { name: 'アリス' }))
    expect(onRefClick).toHaveBeenLastCalledWith('アリス')
    fireEvent.click(screen.getByRole('link', { name: '謎' }))
    expect(onRefClick).toHaveBeenLastCalledWith('謎')
  })

  it('Enter キーで ref を起動できる（キーボード a11y）', () => {
    const onRefClick = vi.fn()
    render(<PreviewPane html={refHtml} onRefClick={onRefClick} />)
    fireEvent.keyDown(screen.getByRole('link', { name: 'アリス' }), { key: 'Enter' })
    expect(onRefClick).toHaveBeenCalledWith('アリス')
  })

  it('onRefClick 未指定なら .ref はリンク化しない', () => {
    const { container } = render(<PreviewPane html={refHtml} />)
    expect(container.querySelector('[data-ref-name="アリス"]')?.getAttribute('tabindex')).toBeNull()
  })
})

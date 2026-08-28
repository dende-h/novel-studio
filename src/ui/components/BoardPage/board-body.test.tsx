import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DELETED_BODY_TEXT, HIDDEN_BODY_TEXT } from '@/core/board/permission'
import { BoardBody } from './board-body'

describe('BoardBody — 伏字（設計 §7-6）', () => {
  it('削除済みなら本文を DOM に出さず、削除の伏字だけを出す', () => {
    const { container } = render(<BoardBody body="ここに秘密が書いてある" deleted />)
    expect(container.textContent).not.toContain('ここに秘密が書いてある')
    expect(screen.getByText(DELETED_BODY_TEXT)).toBeInTheDocument()
  })

  it('運営が非表示にしたら本文を DOM に出さず、非表示の伏字だけを出す', () => {
    const { container } = render(<BoardBody body="通報された本文" hidden />)
    expect(container.textContent).not.toContain('通報された本文')
    expect(screen.getByText(HIDDEN_BODY_TEXT)).toBeInTheDocument()
  })

  it('削除と非表示が重なったら削除の伏字を出す（permission.ts と同じ優先順）', () => {
    render(<BoardBody body="本文" deleted hidden />)
    expect(screen.getByText(DELETED_BODY_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(HIDDEN_BODY_TEXT)).not.toBeInTheDocument()
  })

  it('サーバが伏字を返し損ねても、deleted なら本文は描かない（画面側の二重の守り）', () => {
    // body に生の本文が残ったまま deleted が立っている状態を作る。
    const { container } = render(<BoardBody body="**漏れてはいけない**" deleted />)
    expect(container.querySelector('strong')).toBeNull()
    expect(container.textContent).not.toContain('漏れてはいけない')
  })
})

describe('BoardBody — 描画', () => {
  it('スクリプトを含む本文は実行されない形（エスケープされた文字）で出る', () => {
    const body = '<script>alert(1)</script><img src=x onerror=alert(1)>'
    const { container } = render(<BoardBody body={body} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  it('裸の URL は rel と target 付きのリンクになる', () => {
    const { container } = render(<BoardBody body="詳しくは https://example.com/a です" />)
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href')).toBe('https://example.com/a')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toBe('nofollow ugc noopener noreferrer')
  })

  it('見出し・箇条書き・引用・表がブロック要素として出る', () => {
    const body = ['# 見出し', '- 一つめ', '> 引用', '| a | b |', '| --- | --- |', '| 1 | 2 |'].join(
      '\n',
    )
    const { container } = render(<BoardBody body={body} />)
    expect(container.querySelector('h1')?.textContent).toBe('見出し')
    expect(container.querySelector('ul li')?.textContent).toBe('一つめ')
    expect(container.querySelector('blockquote')?.textContent).toContain('引用')
    expect(container.querySelector('table th')?.textContent).toBe('a')
    expect(container.querySelector('table td')?.textContent).toBe('1')
  })

  it('空行は空段落として残る（ガイドラインのネタバレ配慮が前提にしている挙動）', () => {
    const { container } = render(<BoardBody body={'ここまでが導入\n\nここから結末の話'} />)
    expect(container.querySelector('p.blank')).not.toBeNull()
  })

  it('className は本文の器に足される（呼び出し側で余白を調整できる）', () => {
    const { container } = render(<BoardBody body="本文" className="mt-4" />)
    expect(container.firstElementChild).toHaveClass('mt-4')
  })
})

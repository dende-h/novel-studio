import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import { proofreadNovel } from '@/core/proofread'
import { decide, openFixes, withNth } from '@/core/proofread/decisions'
import { FixListButton } from './fix-list-button'

const setup = (
  draft = '「待って。」\n　光がが揺れた。',
  extra: Partial<Parameters<typeof FixListButton>[0]> = {},
) => {
  const blocks = parseEpisodeBody(draft)
  const rec = decide(
    undefined,
    { workId: 'w', episodeId: 'e' },
    withNth(proofreadNovel(blocks)),
    'fix',
    1,
    blocks,
  )
  const fixes = openFixes(rec, blocks)
  const onJump = vi.fn()
  const onRemove = vi.fn()
  const view = render(
    <FixListButton fixes={fixes} blocks={blocks} onJump={onJump} onRemove={onRemove} {...extra} />,
  )
  return { ...view, onJump, onRemove, fixes, blocks }
}

describe('FixListButton（直す箇所・COT-40）', () => {
  it('件数を出し、0 件ならボタンごと出さない', () => {
    setup()
    expect(screen.getByRole('button', { name: '直すと決めた箇所 2件' })).toBeInTheDocument()
    const { container } = render(
      <FixListButton fixes={[]} blocks={[]} onJump={() => {}} onRemove={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('押すと一覧が開き、項目名・該当文字列・説明が出る。選ぶと閉じて onJump', () => {
    const { onJump, fixes } = setup()
    fireEvent.click(screen.getByRole('button', { name: '直すと決めた箇所 2件' }))
    expect(screen.getByRole('dialog', { name: '直すと決めた箇所' })).toBeInTheDocument()
    expect(screen.getByText('閉じ括弧の前の句読点')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'その箇所へ移る：同じ語の連続「がが」' }))
    expect(onJump).toHaveBeenCalledWith(fixes[1])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('外すで判断を渡す', () => {
    const { onRemove, fixes } = setup()
    fireEvent.click(screen.getByRole('button', { name: '直すと決めた箇所 2件' }))
    fireEvent.click(screen.getByRole('button', { name: '外す：閉じ括弧の前の句読点「。」」' }))
    expect(onRemove).toHaveBeenCalledWith(fixes[0]?.decision)
  })

  it('Esc で閉じてボタンへフォーカスが戻る。外側を押しても閉じる', () => {
    setup()
    const button = screen.getByRole('button', { name: '直すと決めた箇所 2件' })
    fireEvent.click(button)
    screen.getByRole('button', { name: /^その箇所へ移る：閉じ括弧/ }).focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(button).toHaveFocus()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: '一覧を閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('「その箇所へ移る」と「外す」はどちらも Tab で届くボタン（幕だけはフォーカス対象外）', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '直すと決めた箇所 2件' }))
    for (const name of [/^その箇所へ移る：閉じ括弧/, /^外す：閉じ括弧/]) {
      const b = screen.getByRole('button', { name })
      expect(b.tagName).toBe('BUTTON')
      expect(b).not.toHaveAttribute('tabindex', '-1')
    }
    expect(screen.getByRole('button', { name: '一覧を閉じる' })).toHaveAttribute('tabindex', '-1')
  })

  it('「推敲画面を開く」は渡したときだけ出て、押すと呼ばれる', () => {
    const onOpenProofread = vi.fn()
    const { unmount } = setup(undefined, { onOpenProofread })
    fireEvent.click(screen.getByRole('button', { name: '直すと決めた箇所 2件' }))
    fireEvent.click(screen.getByRole('button', { name: /推敲画面を開く/ }))
    expect(onOpenProofread).toHaveBeenCalled()
    unmount()
    setup()
    fireEvent.click(screen.getByRole('button', { name: '直すと決めた箇所 2件' }))
    expect(screen.queryByRole('button', { name: /推敲画面を開く/ })).toBeNull()
  })
})

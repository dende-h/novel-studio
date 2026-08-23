import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emptyPlot, type Plot, setWorldNote, WORLD_SLOTS } from '@/core/plot'
import { WorldView } from './world-view'

/**
 * 世界観設定タブ。ここでの関心は「整理が苦手な人でも埋められるか」なので、
 * 空でも枠と案内文が常に出ること・書いた内容が確定すること・公開されないと明示されることを固定する。
 */

const plotWith = (...entries: { slot: string; title?: string; body: string }[]): Plot => {
  let p = emptyPlot('p1', 'w1', 1)
  entries.forEach((e, i) => {
    p = setWorldNote(p, e, `n${i}`, 10 + i)
  })
  return p
}

function setup(plot: Plot = emptyPlot('p1', 'w1', 1)) {
  const onApply = vi.fn()
  render(<WorldView plot={plot} onApply={onApply} />)
  // onApply は純関数を受け取る形なので、テストからは「適用後のプロット」を取り出して確かめる。
  const applied = () => {
    const fn = onApply.mock.calls.at(-1)?.[0] as ((p: Plot) => Plot) | undefined
    return fn ? fn(plot) : null
  }
  return { onApply, applied }
}

describe('WorldView（世界観設定）', () => {
  it('空でも全部の枠と案内文を並べる（何を書けばいいか分かる）', () => {
    setup()
    for (const slot of WORLD_SLOTS) {
      expect(screen.getByText(slot.label)).toBeInTheDocument()
      expect(screen.getByText(slot.guide)).toBeInTheDocument()
    }
    expect(screen.getByText(`0 / ${WORLD_SLOTS.length} の枠に記入済み`)).toBeInTheDocument()
  })

  it('公開されない場所であることを明示する', () => {
    setup()
    expect(screen.getAllByText('公開されません').length).toBeGreaterThan(0)
    expect(screen.getByText(/読者が読む人物や用語の説明は「用語集」へ/)).toBeInTheDocument()
  })

  it('枠を押すと入力欄になり、離れると保存される', () => {
    const { onApply, applied } = setup()
    fireEvent.click(screen.getByText(WORLD_SLOTS[0]?.placeholder ?? ''))
    const area = screen.getByLabelText(WORLD_SLOTS[0]?.label ?? '')
    fireEvent.change(area, { target: { value: '死者は生き返らない' } })
    fireEvent.blur(area)
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(applied()?.world[0]).toMatchObject({
      slot: WORLD_SLOTS[0]?.key,
      body: '死者は生き返らない',
    })
  })

  it('中身を変えずに離れても保存しない（無駄な更新を打たない）', () => {
    const { onApply } = setup(plotWith({ slot: 'rules', body: 'ルール' }))
    fireEvent.click(screen.getByText('ルール'))
    fireEvent.blur(screen.getByLabelText('世界のルール'))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('Esc は書きかけを捨てて閉じる', () => {
    const { onApply } = setup(plotWith({ slot: 'rules', body: 'ルール' }))
    fireEvent.click(screen.getByText('ルール'))
    const area = screen.getByLabelText('世界のルール')
    fireEvent.change(area, { target: { value: '書きかけ' } })
    fireEvent.keyDown(area, { key: 'Escape' })
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByText('ルール')).toBeInTheDocument()
  })

  it('記入済みの数を数える', () => {
    setup(plotWith({ slot: 'rules', body: 'a' }, { slot: 'style', body: 'b' }))
    expect(screen.getByText(`2 / ${WORLD_SLOTS.length} の枠に記入済み`)).toBeInTheDocument()
  })

  it('自由枠は見出しを付けて足せる', () => {
    const { applied } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'メモを足す' }))
    expect(applied()?.world[0]).toMatchObject({ slot: 'custom', title: '新しいメモ' })
  })

  it('自由枠だけ見出しを編集でき、削除できる', () => {
    const { applied } = setup(plotWith({ slot: 'custom', title: '食べ物', body: '麦' }))
    const heading = screen.getByLabelText('メモの見出し') as HTMLInputElement
    expect(heading.value).toBe('食べ物')
    fireEvent.change(heading, { target: { value: '食べ物と酒' } })
    fireEvent.blur(heading)
    expect(applied()?.world[0]?.title).toBe('食べ物と酒')

    fireEvent.click(screen.getByRole('button', { name: '食べ物を削除' }))
    expect(applied()?.world).toEqual([])
  })

  it('定型枠には削除ボタンを出さない（枠そのものは消えない）', () => {
    setup(plotWith({ slot: 'rules', body: 'ルール' }))
    expect(screen.queryByRole('button', { name: '世界のルールを削除' })).toBeNull()
  })
})

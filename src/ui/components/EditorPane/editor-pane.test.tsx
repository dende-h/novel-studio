import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GlossaryEntry } from '@/core/schema'
import { EditorPane } from './editor-pane'

describe('EditorPane（Presentational）', () => {
  it('value を textarea に表示', () => {
    render(<EditorPane value="本文テスト" onChange={() => {}} />)
    expect(screen.getByRole('textbox', { name: '本文' })).toHaveValue('本文テスト')
  })

  it('入力で onChange に新しい値を渡す', () => {
    const onChange = vi.fn()
    render(<EditorPane value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: '本文' }), { target: { value: 'あ' } })
    expect(onChange).toHaveBeenCalledWith('あ')
  })
})

// --- @ サジェスト（辞書参照の補完挿入） -------------------------------------

const g = (name: string, reading?: string): GlossaryEntry => ({
  id: name,
  name,
  aliases: [],
  createdAt: 0,
  updatedAt: 0,
  ...(reading ? { reading } : {}),
})

/** 制御コンポーネントの value を内部 state で保持する結合テスト用ハーネス。 */
function Harness({
  glossary = [],
  onCreateEntry,
  initial = '',
}: {
  glossary?: GlossaryEntry[]
  onCreateEntry?: (name: string) => GlossaryEntry
  initial?: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <EditorPane
      value={value}
      onChange={setValue}
      glossary={glossary}
      onCreateEntry={onCreateEntry}
    />
  )
}

/** キャレットを末尾に置いて value を入力する（textarea の selectionStart も合わせる）。 */
const type = (ta: HTMLElement, value: string) =>
  fireEvent.change(ta, {
    target: { value, selectionStart: value.length, selectionEnd: value.length },
  })

describe('EditorPane（@ サジェスト）', () => {
  it('@ の直後で前方一致候補を listbox に出す', () => {
    render(<Harness glossary={[g('アリス', 'ありす'), g('アラン', 'あらん'), g('ボブ', 'ぼぶ')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@ア')

    const list = screen.getByRole('listbox')
    expect(within(list).getByRole('option', { name: /アリス/ })).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: /アラン/ })).toBeInTheDocument()
    expect(within(list).queryByRole('option', { name: /ボブ/ })).toBeNull()
  })

  it('直前が英数字なら @ では発火しない（メールアドレス等の逃げ道）', () => {
    render(<Harness glossary={[g('アリス', 'ありす')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, 'foo@')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('候補をクリックすると @クエリ を [[名前]] に置換して挿入する', () => {
    render(<Harness glossary={[g('アリス', 'ありす')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@アリ')
    fireEvent.click(screen.getByRole('option', { name: /アリス/ }))
    expect(ta).toHaveValue('[[アリス]]')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('ArrowDown→Enter で 2 番目の候補を挿入する', () => {
    // 読み「あ」<「い」で並びを固定（アリス→アラン）。@ のみで全件を読み順に列挙。
    render(<Harness glossary={[g('アリス', 'あ'), g('アラン', 'い')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@')
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(ta).toHaveValue('[[アラン]]')
  })

  it('クイック作成行で onCreateEntry を呼び [[クエリ]] を挿入する', () => {
    const onCreateEntry = vi.fn((name: string) => g(name))
    render(<Harness glossary={[]} onCreateEntry={onCreateEntry} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@新キャラ')
    fireEvent.click(screen.getByRole('option', { name: /新規作成/ }))
    expect(onCreateEntry).toHaveBeenCalledWith('新キャラ')
    expect(ta).toHaveValue('[[新キャラ]]')
  })

  it('onCreateEntry 未指定かつ候補なしなら listbox を出さない', () => {
    render(<Harness glossary={[]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@新')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('IME 変換中は発火せず、確定後に評価する', () => {
    render(<Harness glossary={[g('あい', 'あい')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    fireEvent.compositionStart(ta)
    fireEvent.change(ta, { target: { value: '@あ', selectionStart: 2, selectionEnd: 2 } })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.compositionEnd(ta, { target: { value: '@あ', selectionStart: 2, selectionEnd: 2 } })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('Escape で候補を閉じる', () => {
    render(<Harness glossary={[g('アリス', 'ありす')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@ア')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(ta, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

// --- [[ 補助トリガ（正本記法そのものを直打ち補完） ---------------------------

describe('EditorPane（[[ 補助トリガ）', () => {
  it('[[ の直後で前方一致候補を listbox に出す', () => {
    render(<Harness glossary={[g('アリス', 'ありす'), g('アラン', 'あらん'), g('ボブ', 'ぼぶ')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '[[ア')

    const list = screen.getByRole('listbox')
    expect(within(list).getByRole('option', { name: /アリス/ })).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: /アラン/ })).toBeInTheDocument()
    expect(within(list).queryByRole('option', { name: /ボブ/ })).toBeNull()
  })

  it('候補確定で打ちかけ [[ を消して [[名前]] を挿入する（二重括弧にしない）', () => {
    render(<Harness glossary={[g('アリス', 'ありす')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '[[アリ')
    fireEvent.click(screen.getByRole('option', { name: /アリス/ }))
    expect(ta).toHaveValue('[[アリス]]')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('[[ のクイック作成で [[クエリ]] を挿入する', () => {
    const onCreateEntry = vi.fn((name: string) => g(name))
    render(<Harness glossary={[]} onCreateEntry={onCreateEntry} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '[[新キャラ')
    fireEvent.click(screen.getByRole('option', { name: /新規作成/ }))
    expect(onCreateEntry).toHaveBeenCalledWith('新キャラ')
    expect(ta).toHaveValue('[[新キャラ]]')
  })

  it('閉じた [[名前]] を打ち切った直後は再発火しない', () => {
    render(<Harness glossary={[g('アリス', 'ありす')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '[[アリス]]')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

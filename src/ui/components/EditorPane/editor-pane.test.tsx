import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('別名候補を選ぶと、本文はその別名表記で挿入される（世界樹→[[世界樹]]）', () => {
    const yggd: GlossaryEntry = {
      id: 'y',
      name: 'ユグドラシル',
      aliases: ['世界樹'],
      reading: 'ゆぐどらしる',
      createdAt: 0,
      updatedAt: 0,
    }
    render(<Harness glossary={[yggd]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@世')
    // 別名「世界樹」が独立候補として出る（正式名ユグドラシルは「世」に一致しない）。
    fireEvent.click(screen.getByRole('option', { name: /世界樹/ }))
    expect(ta).toHaveValue('[[世界樹]]')
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

/**
 * 狭幅では @ サジェストの形態が変わる（D-EDIT-5）。
 * キャレット追従ポップアップは画面端クランプ・上下反転・visualViewport 追従を
 * すべて正しく実装しないとキーボードの裏に隠れるため、座標計算を捨てて
 * 画面下端に固定したバーへ差し替えている。表示だけでなく Enter の意味も変わる。
 */
describe('EditorPane（@ サジェスト・狭幅＝キーボード直上のバー）', () => {
  const setWidth = (width: number) => {
    const { happyDOM } = window as unknown as {
      happyDOM: { setViewport: (v: { width: number }) => void }
    }
    act(() => {
      happyDOM.setViewport({ width })
    })
  }

  afterEach(() => setWidth(1280))

  it('狭幅でも候補を listbox に出し、タップで挿入できる', () => {
    setWidth(390)
    render(<Harness glossary={[g('アリス', 'ありす')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@アリ')

    expect(screen.getByRole('listbox', { name: '参照候補' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /アリス/ }))
    expect(ta).toHaveValue('[[アリス]]')
  })

  it('狭幅では Enter を横取りしない（改行として使えることを保証）', () => {
    setWidth(390)
    render(<Harness glossary={[g('アリス', 'ありす')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@アリ')
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    // preventDefault されなければ既定動作（改行）が生きる＝ソフトキーボードで改行できる。
    const notPrevented = fireEvent.keyDown(ta, { key: 'Enter' })
    expect(notPrevented).toBe(true)
    // 確定もされない（本文は @ のまま）
    expect(ta).toHaveValue('@アリ')
  })

  it('狭幅ではハイライトを持たないので aria-activedescendant を付けない', () => {
    setWidth(390)
    render(<Harness glossary={[g('アリス', 'ありす')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@アリ')
    expect(ta).not.toHaveAttribute('aria-activedescendant')
  })

  it('広い画面では従来どおり Enter で確定する（非回帰）', () => {
    setWidth(1280)
    render(<Harness glossary={[g('アリス', 'ありす')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' })
    type(ta, '@アリ')
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(ta).toHaveValue('[[アリス]]')
  })
})

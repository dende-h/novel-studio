import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlossaryEntry } from '@/core/schema'
import { EditorPane, type EditorPaneHandle } from './editor-pane'

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

  /**
   * 記法ボタン（PC ツールバー／スマホ記法バー）で空枠 [[]] を置いてから書く導線。
   * 確定時に閉じ `]]` を置換範囲へ含めないと [[名前]]]] になり、ref が壊れて
   * プレビューでリンクにならない。ボタン→入力→確定を通しで踏む。
   */
  describe('空枠 [[]] から書き始めた確定（閉じ括弧を二重にしない）', () => {
    function FrameHarness({
      glossary = [],
      onCreateEntry,
    }: {
      glossary?: GlossaryEntry[]
      onCreateEntry?: (name: string) => GlossaryEntry
    }) {
      const [value, setValue] = useState('')
      const ref = useRef<EditorPaneHandle>(null)
      return (
        <>
          <button type="button" onClick={() => ref.current?.applyNotation('ref')}>
            用語集
          </button>
          <EditorPane
            ref={ref}
            value={value}
            onChange={setValue}
            glossary={glossary}
            onCreateEntry={onCreateEntry}
          />
        </>
      )
    }

    /** 空枠の中に文字を打った状態を作る（キャレットは閉じ ]] の手前）。 */
    const typeInFrame = (ta: HTMLElement, query: string) =>
      fireEvent.change(ta, {
        target: {
          value: `[[${query}]]`,
          selectionStart: 2 + query.length,
          selectionEnd: 2 + query.length,
        },
      })

    it('候補を選んでも [[名前]]]] にならない', () => {
      render(<FrameHarness glossary={[g('ユグドラシル', 'ゆぐどらしる')]} />)
      const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
      fireEvent.click(screen.getByRole('button', { name: '用語集' }))
      expect(ta).toHaveValue('[[]]')

      typeInFrame(ta, 'ユグ')
      fireEvent.click(screen.getByRole('option', { name: /ユグドラシル/ }))
      expect(ta).toHaveValue('[[ユグドラシル]]')
      // キャレットは ref の外＝続きをそのまま書ける
      expect(ta.selectionStart).toBe('[[ユグドラシル]]'.length)
    })

    it('新規作成で確定しても [[名前]]]] にならない', () => {
      const onCreateEntry = vi.fn((name: string) => g(name))
      render(<FrameHarness onCreateEntry={onCreateEntry} />)
      const ta = screen.getByRole('textbox', { name: '本文' })
      fireEvent.click(screen.getByRole('button', { name: '用語集' }))

      typeInFrame(ta, '新キャラ')
      fireEvent.click(screen.getByRole('option', { name: /新規作成/ }))
      expect(onCreateEntry).toHaveBeenCalledWith('新キャラ')
      expect(ta).toHaveValue('[[新キャラ]]')
    })

    it('空枠の中で @ から呼び出しても括弧が二重にならない', () => {
      render(<FrameHarness glossary={[g('ユグドラシル', 'ゆぐどらしる')]} />)
      const ta = screen.getByRole('textbox', { name: '本文' })
      fireEvent.click(screen.getByRole('button', { name: '用語集' }))

      typeInFrame(ta, '@ユグ')
      fireEvent.click(screen.getByRole('option', { name: /ユグドラシル/ }))
      expect(ta).toHaveValue('[[ユグドラシル]]')
    })

    it('枠の外に既にある ]] は巻き込まない', () => {
      render(<FrameHarness glossary={[g('アリス', 'ありす')]} />)
      const ta = screen.getByRole('textbox', { name: '本文' })
      // 空枠ではなく素の @ 入力（直後に閉じ括弧が無い）
      fireEvent.change(ta, {
        target: { value: '@アリ、', selectionStart: 3, selectionEnd: 3 },
      })
      fireEvent.click(screen.getByRole('option', { name: /アリス/ }))
      expect(ta).toHaveValue('[[アリス]]、')
    })
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

// --- 記法の挿入（ツールバー／ショートカット） ---------------------------------

/** ref ハンドルを露出し、記法挿入をテストから呼べるようにしたハーネス。 */
function NotationHarness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<EditorPaneHandle>(null)
  return (
    <>
      <button type="button" onClick={() => ref.current?.applyNotation('ruby')}>
        ルビ
      </button>
      <button type="button" onClick={() => ref.current?.applyNotation('dots')}>
        傍点
      </button>
      <button type="button" onClick={() => ref.current?.applyNotation('ref')}>
        用語集
      </button>
      <button type="button" onClick={() => ref.current?.applyNotation('slug')}>
        柱
      </button>
      <button type="button" onClick={() => ref.current?.applyNotation('dialogue')}>
        セリフ
      </button>
      <button type="button" onClick={() => ref.current?.applyNotation('ellipsis')}>
        三点リーダー
      </button>
      <button type="button" onClick={() => ref.current?.applyNotation('dash')}>
        ダッシュ
      </button>
      <EditorPane ref={ref} value={value} onChange={setValue} />
    </>
  )
}

/** textarea に選択範囲を設定する（fireEvent.select で onSelect も走らせる）。 */
const select = (ta: HTMLTextAreaElement, start: number, end: number) => {
  ta.setSelectionRange(start, end)
  fireEvent.select(ta)
}

describe('EditorPane（記法の挿入）', () => {
  it('選択した漢字にルビ枠を付ける（漢字だけなのでパイプ無し）', () => {
    render(<NotationHarness initial="黄昏の街" />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    select(ta, 0, 2)
    fireEvent.click(screen.getByRole('button', { name: 'ルビ' }))
    expect(ta).toHaveValue('黄昏《》の街')
    // 読みを打てるよう 《》 の中にキャレットが来る
    expect(ta.selectionStart).toBe('黄昏《'.length)
  })

  it('かな混じりの親文字にはパイプを付ける', () => {
    render(<NotationHarness initial="お嬢さんが来た" />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    select(ta, 0, 4)
    fireEvent.click(screen.getByRole('button', { name: 'ルビ' }))
    expect(ta).toHaveValue('｜お嬢さん《》が来た')
  })

  it('選択なしのルビは空の型を置き、親文字の位置にキャレットを移す', () => {
    render(<NotationHarness />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    fireEvent.click(screen.getByRole('button', { name: 'ルビ' }))
    expect(ta).toHaveValue('｜《》')
    expect(ta.selectionStart).toBe(1)
  })

  it('選択を傍点で囲む', () => {
    render(<NotationHarness initial="これは重要な場面" />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    select(ta, 3, 5)
    fireEvent.click(screen.getByRole('button', { name: '傍点' }))
    expect(ta).toHaveValue('これは《《重要》》な場面')
  })

  it('選択なしの傍点は括弧の中にキャレットを置く', () => {
    render(<NotationHarness />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    fireEvent.click(screen.getByRole('button', { name: '傍点' }))
    expect(ta).toHaveValue('《《》》')
    expect(ta.selectionStart).toBe(2)
  })

  it('選択を用語集参照で囲む', () => {
    render(<NotationHarness initial="アリスが笑った" />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    select(ta, 0, 3)
    fireEvent.click(screen.getByRole('button', { name: '用語集' }))
    expect(ta).toHaveValue('[[アリス]]が笑った')
  })

  it('選択なしの用語集参照は [[ の直後にキャレットを置く（次の打鍵でサジェストが開く）', () => {
    render(<NotationHarness />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    fireEvent.click(screen.getByRole('button', { name: '用語集' }))
    expect(ta).toHaveValue('[[]]')
    expect(ta.selectionStart).toBe(2)
  })
})

describe('EditorPane（記法のショートカット）', () => {
  const shortcut = (ta: HTMLElement, key: string) => fireEvent.keyDown(ta, { key, metaKey: true })

  it('Cmd+B で傍点、Cmd+I でルビ、Cmd+K で用語集参照', () => {
    render(<NotationHarness initial="重要" />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement

    select(ta, 0, 2)
    shortcut(ta, 'b')
    expect(ta).toHaveValue('《《重要》》')

    select(ta, 0, 0)
    shortcut(ta, 'i')
    expect(ta.value.startsWith('｜《》')).toBe(true)

    select(ta, 0, 0)
    shortcut(ta, 'k')
    expect(ta.value.startsWith('[[]]')).toBe(true)
  })

  it('Ctrl でも効く（Windows/Linux）', () => {
    render(<NotationHarness initial="重要" />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    select(ta, 0, 2)
    fireEvent.keyDown(ta, { key: 'b', ctrlKey: true })
    expect(ta).toHaveValue('《《重要》》')
  })

  // 変換確定の Enter や候補選択を奪わないための最重要ガード。
  it('IME 変換中は挿入しない', () => {
    render(<NotationHarness initial="重要" />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    select(ta, 0, 2)
    fireEvent.compositionStart(ta)
    fireEvent.keyDown(ta, { key: 'b', metaKey: true, isComposing: true })
    expect(ta).toHaveValue('重要')
  })

  it('修飾キー無しの b は普通の入力として素通しする', () => {
    render(<NotationHarness initial="重要" />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    select(ta, 0, 2)
    const notPrevented = fireEvent.keyDown(ta, { key: 'b' })
    expect(notPrevented).toBe(true)
    expect(ta).toHaveValue('重要')
  })

  it('サジェストが開いていてもショートカットは効く', () => {
    render(<Harness glossary={[g('アリス', 'ありす')]} />)
    const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    type(ta, '@アリ')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(ta, { key: 'b', metaKey: true })
    expect(ta.value).toContain('《《》》')
  })
})

it.each([
  { kind: '柱', initial: '前行\n公園', start: 5, end: 5, expected: '前行\n○公園', caret: 4 },
  { kind: '柱', initial: '公園', start: 0, end: 2, expected: '○公園', caret: 3 },
  { kind: 'セリフ', initial: 'ユイ', start: 2, end: 2, expected: 'ユイ「」', caret: 3 },
  {
    kind: 'セリフ',
    initial: 'ユイこんにちは',
    start: 2,
    end: 7,
    expected: 'ユイ「こんにちは」',
    caret: 9,
  },
])('$kind の挿入とキャレット: $initial', ({ kind, initial, start, end, expected, caret }) => {
  render(<NotationHarness initial={initial} />)
  const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  select(ta, start, end)
  fireEvent.click(screen.getByRole('button', { name: kind }))
  expect(ta).toHaveValue(expected)
  expect(ta.selectionStart).toBe(caret)
})

it('小説でも Ctrl+Alt+D で選択範囲を「」で囲む', () => {
  render(<NotationHarness initial="本文" />)
  const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  select(ta, 0, 2)
  fireEvent.keyDown(ta, { key: 'd', code: 'KeyD', ctrlKey: true, altKey: true })
  expect(ta).toHaveValue('「本文」')
  expect(ta.selectionStart).toBe(4)
})
it('空のセリフは内側にキャレットを置き、IME中は挿入しない', () => {
  render(<NotationHarness />)
  const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  fireEvent.keyDown(ta, { key: 'd', code: 'KeyD', ctrlKey: true, altKey: true })
  expect(ta).toHaveValue('「」')
  expect(ta.selectionStart).toBe(1)
  fireEvent.compositionStart(ta)
  fireEvent.keyDown(ta, { key: 'd', code: 'KeyD', ctrlKey: true, altKey: true })
  expect(ta).toHaveValue('「」')
})
it.each([
  ['e', 'KeyE', '……', '三点リーダー'],
  ['m', 'KeyM', '――', 'ダッシュ'],
])('Ctrl+Alt+%s で %s を2マス分入れ、選択があれば置き換える（小説でも使える）', (key, code, mark, label) => {
  render(<NotationHarness initial="前後" />)
  const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  select(ta, 1, 1)
  fireEvent.keyDown(ta, { key, code, ctrlKey: true, altKey: true })
  expect(ta).toHaveValue(`前${mark}後`)
  expect(ta.selectionStart).toBe(3)
  select(ta, 0, 1)
  fireEvent.click(screen.getByRole('button', { name: label }))
  expect(ta).toHaveValue(`${mark}${mark}後`)
})
it('脚本ではプレイスホルダーでト書きの自動字下げを案内する', () => {
  const { rerender } = render(<EditorPane value="" onChange={() => {}} />)
  expect(screen.getByPlaceholderText(/ここから書き始めましょう/)).toBeInTheDocument()
  rerender(<EditorPane scriptMode value="" onChange={() => {}} />)
  expect(
    screen.getByPlaceholderText(/それ以外の行はト書きとして.*3字下がります/),
  ).toBeInTheDocument()
})
it('場面転換・丸括弧・隅付き括弧のキーは小説では効かない', () => {
  render(<NotationHarness initial="本文" />)
  const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  select(ta, 0, 2)
  for (const [key, code] of [
    ['s', 'KeyS'],
    ['p', 'KeyP'],
    ['b', 'KeyB'],
  ]) {
    expect(fireEvent.keyDown(ta, { key, code, ctrlKey: true, altKey: true })).toBe(true)
  }
  expect(ta).toHaveValue('本文')
  expect(screen.queryByRole('button', { name: '場面転換' })).toBeNull()
})
it('Ctrl+Shift+I と Alt を含むキーは既存ショートカットと誤認しない', () => {
  render(<NotationHarness />)
  const ta = screen.getByRole('textbox', { name: '本文' })
  expect(fireEvent.keyDown(ta, { key: 'I', ctrlKey: true, shiftKey: true })).toBe(true)
  expect(fireEvent.keyDown(ta, { key: 'i', ctrlKey: true, altKey: true })).toBe(true)
  expect(ta).toHaveValue('')
})
it('柱のショートカットは脚本のみ、校正候補から本文の該当行を選べる', () => {
  const onChange = vi.fn()
  const { rerender } = render(<EditorPane value={'○公園\n「はい」'} onChange={onChange} />)
  const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  expect(fireEvent.keyDown(ta, { key: 'h', code: 'KeyH', ctrlKey: true, altKey: true })).toBe(true)
  expect(screen.queryByText(/脚本の書式チェック/)).toBeNull()
  rerender(<EditorPane scriptMode value={'○公園\n「はい」'} onChange={onChange} />)
  fireEvent.click(screen.getByText(/脚本の書式チェック/))
  fireEvent.click(screen.getByRole('button', { name: /2行：話者名のないセリフ/ }))
  expect(ta.selectionStart).toBe(4)
  expect(ta.selectionEnd).toBe(8)
  expect(onChange).not.toHaveBeenCalled()
  select(ta, 4, 4)
  fireEvent.keyDown(ta, { key: 'h', code: 'KeyH', ctrlKey: true, altKey: true })
  expect(onChange).toHaveBeenCalledWith('○公園\n○「はい」')
})

it.each([
  ['', 0, 0, '　　　'],
  ['本文', 1, 1, '　　　本文'],
  ['　本文', 2, 2, '　　　本文'],
  ['　　　　本文', 5, 5, '　　　本文'],
  ['前\n　動く\n歩く\n次', 2, 8, '前\n　　　動く\n　　　歩く\n次'],
] as const)('ト書きの字下げを3字に揃える: %s', (initial, start, end, expected) => {
  function ScriptHarness() {
    const [value, setValue] = useState(initial as string)
    return <EditorPane scriptMode value={value} onChange={setValue} />
  }
  render(<ScriptHarness />)
  const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  select(ta, start, end)
  fireEvent.keyDown(ta, { key: 'Tab', code: 'Tab' })
  expect(ta).toHaveValue(expected)
  fireEvent.keyDown(ta, { key: 'Tab', code: 'Tab' })
  expect(ta).toHaveValue(expected)
})

function ScriptHarness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <EditorPane scriptMode value={value} onChange={setValue} />
}

it('Shift+Tab とスマホの「ト書き解除」で行頭の字下げを外す', () => {
  render(<ScriptHarness initial={'　　　動く\n　　　歩く\n次'} />)
  const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  select(ta, 5, 5)
  fireEvent.keyDown(ta, { key: 'Tab', code: 'Tab', shiftKey: true })
  expect(ta).toHaveValue('動く\n　　　歩く\n次')
  expect(ta.selectionStart).toBe(2)
  select(ta, 0, 4)
  fireEvent.keyDown(ta, { key: 'Tab', code: 'Tab', shiftKey: true })
  expect(ta).toHaveValue('動く\n歩く\n次')
})

it('字下げした行の Enter は次の行も字下げ（Tab 直後の空白だけの行でも継続）', () => {
  render(<ScriptHarness initial={'　　　風が吹く'} />)
  const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  select(ta, 7, 7)
  fireEvent.keyDown(ta, { key: 'Enter', code: 'Enter' })
  expect(ta).toHaveValue('　　　風が吹く\n　　　')
  expect(ta.selectionStart).toBe(11)
  fireEvent.keyDown(ta, { key: 'Enter', code: 'Enter' })
  expect(ta).toHaveValue('　　　風が吹く\n　　　\n　　　')
  expect(ta.selectionStart).toBe(15)
  // 抜けるのは Shift+Tab。字下げの無い行の Enter は横取りしない（標準の改行に任せる）。
  fireEvent.keyDown(ta, { key: 'Tab', code: 'Tab', shiftKey: true })
  expect(ta).toHaveValue('　　　風が吹く\n　　　\n')
  expect(fireEvent.keyDown(ta, { key: 'Enter', code: 'Enter' })).toBe(true)
  expect(ta).toHaveValue('　　　風が吹く\n　　　\n')
})

it('Tab の字下げは脚本だけ。IME 中と Esc 直後の Tab は素通しする', () => {
  const { unmount } = render(<NotationHarness initial="本文" />)
  let ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  expect(fireEvent.keyDown(ta, { key: 'Tab', code: 'Tab' })).toBe(true)
  expect(ta).toHaveValue('本文')
  unmount()
  render(<ScriptHarness initial="本文" />)
  ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  fireEvent.compositionStart(ta)
  expect(fireEvent.keyDown(ta, { key: 'Tab', code: 'Tab' })).toBe(true)
  fireEvent.compositionEnd(ta)
  expect(ta).toHaveValue('本文')
  fireEvent.keyDown(ta, { key: 'Escape', code: 'Escape' })
  expect(fireEvent.keyDown(ta, { key: 'Tab', code: 'Tab' })).toBe(true)
  expect(ta).toHaveValue('本文')
  expect(fireEvent.keyDown(ta, { key: 'Tab', code: 'Tab' })).toBe(false)
  expect(ta).toHaveValue('　　　本文')
})
it('場面転換は脚本で、選択した本文を消さず現在行の前に *** 行を置く', () => {
  function ScriptHarness() {
    const [value, setValue] = useState('前\n次の場面')
    return <EditorPane scriptMode value={value} onChange={setValue} />
  }
  render(<ScriptHarness />)
  const ta = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
  select(ta, 3, 6)
  fireEvent.keyDown(ta, { key: 's', code: 'KeyS', ctrlKey: true, altKey: true })
  expect(ta).toHaveValue('前\n***\n次の場面')
  expect(ta.selectionStart).toBe(6)
})

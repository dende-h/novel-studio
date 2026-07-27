import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { resolveRef, shouldTriggerSuggest, suggestRefs } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
import { getCaretCoordinates } from '@/ui/_utils/caretCoordinates'
import { useKeyboardInset } from '@/ui/hooks/use-keyboard-inset'
import { useIsNarrow } from '@/ui/hooks/use-narrow'
import { RefSuggest } from './ref-suggest'
import { RefSuggestBar } from './ref-suggest-bar'

interface EditorPaneProps {
  value: string
  onChange: (value: string) => void
  /** @ サジェストの候補となる辞書。省略時はサジェスト無効。 */
  glossary?: GlossaryEntry[]
  /** クイック作成（name のみで即作成→挿入）。省略時は作成行を出さない。 */
  onCreateEntry?: (name: string) => Promise<GlossaryEntry> | GlossaryEntry
}

interface SuggestState {
  /** value 内のトリガ開始インデックス（@/＠ なら @ の位置、[[ なら最初の [ の位置）。 */
  at: number
  /** トリガ文字列の長さ（@/＠=1、[[=2）。確定時の置換範囲とクエリ開始の算出に使う。 */
  triggerLen: number
  /** トリガ直後〜キャレットまでの絞り込み文字列。 */
  query: string
  /** ポップアップを重ねるキャレット直下の座標（要素内 px）。 */
  top: number
  left: number
}

const isTrigger = (ch: string) => ch === '@' || ch === '＠'

/** 本文エディタ（素の textarea＋自前パーサ方式 A1）。WYSIWYG は IME 問題ゆえ不採用。 */
export function EditorPane({ value, onChange, glossary = [], onCreateEntry }: EditorPaneProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  // IME 変換中はサジェストを抑止する（純関数は判定できないので UI 層で握る）。
  const composingRef = useRef(false)
  // 挿入後に復元したいキャレット位置（useLayoutEffect で適用）。
  const pendingCaretRef = useRef<number | null>(null)
  const [suggest, setSuggest] = useState<SuggestState | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // 狭幅ではキャレット追従ポップアップではなくキーボード直上のバーを使う（D-EDIT-5）。
  // 表示位置だけでなく Enter の意味も変わる（改行に返す）ため、CSS ではなく JS で分岐する。
  const narrow = useIsNarrow()
  // バーを画面下端に固定するため、iOS のキーボード高を CSS 変数へ実測して流す。
  useKeyboardInset()

  const uid = useId()
  const listId = `${uid}-ref-list`
  const optionId = useCallback((i: number) => `${uid}-ref-opt-${i}`, [uid])

  const candidates = useMemo(
    () => (suggest ? suggestRefs(suggest.query, glossary) : []),
    [suggest, glossary],
  )
  const showCreate = useMemo(() => {
    if (!suggest || !onCreateEntry) return false
    const q = suggest.query.trim()
    if (q === '') return false
    // 既存 entry と完全一致するクエリは作成不要（候補側に出る）。
    return resolveRef(q, glossary) === undefined
  }, [suggest, glossary, onCreateEntry])
  const total = candidates.length + (showCreate ? 1 : 0)
  const open = suggest !== null && total > 0

  // キャレット直前を走査して @ サジェストの開閉・絞り込みを更新する。
  const refresh = useCallback(
    (el: HTMLTextAreaElement) => {
      // 補完源（辞書 or クイック作成）が無ければ何もしない。
      if (glossary.length === 0 && !onCreateEntry) {
        setSuggest(null)
        return
      }
      const caret = el.selectionStart ?? 0
      const text = el.value
      // キャレットから後方へ走査し、空白/閉じ括弧を跨がない直近のトリガを探す。
      // 主トリガ＝@/＠（1文字）、補助トリガ＝[[（2文字・正本記法そのもの）。
      let at = -1
      let triggerLen = 0
      for (let i = caret - 1; i >= 0; i--) {
        const ch = text[i] ?? ''
        if (isTrigger(ch)) {
          at = i
          triggerLen = 1
          break
        }
        // [[ 検出: 現在文字が [ かつ直前も [（先頭 [ を at に）。
        if (ch === '[' && (text[i - 1] ?? '') === '[') {
          at = i - 1
          triggerLen = 2
          break
        }
        // 区切り（空白・改行・] ＝ ref 閉じ）か 32 文字超で打ち切り。
        if (/\s/u.test(ch) || ch === ']' || caret - i > 32) break
      }
      // @ はメール逃げ道ヒューリスティック判定、[[ は記法そのものなので常に発火。
      if (at < 0 || (triggerLen === 1 && !shouldTriggerSuggest(text.slice(0, at + 1)))) {
        setSuggest(null)
        return
      }
      // getCaretCoordinates は textarea 自身のボーダーボックス基準。ポップアップは
      // relative な親（ツールバー＋本文を含む root div）基準で absolute 配置されるため、
      // textarea のコンテナ内オフセット（ツールバー高さぶん下／左端ぶん）を足して座標系を合わせる。
      // これを省くとポップアップがツールバー高さぶん上にずれ、入力中の行に被ってしまう。
      // 狭幅ではキャレット追従をやめて画面下端のバーに出すため、座標は要らない。
      // getCaretCoordinates はミラー div の生成/破棄と getComputedStyle を毎打鍵で行うので、
      // 使わないなら呼ばないこと自体がローエンド端末の体感改善になる。
      const c = narrow ? null : getCaretCoordinates(el, at)
      setSuggest({
        at,
        triggerLen,
        query: text.slice(at + triggerLen, caret),
        top: c ? el.offsetTop + c.top + c.height : 0,
        left: c ? el.offsetLeft + c.left : 0,
      })
      setActiveIndex(0)
    },
    [glossary.length, onCreateEntry, narrow],
  )

  // value 内 [at, caret) の @クエリ を [[名前]] に置換して挿入する。
  const insertRef = (at: number, caret: number, name: string) => {
    const inserted = `[[${name}]]`
    pendingCaretRef.current = at + inserted.length
    onChange(value.slice(0, at) + inserted + value.slice(caret))
    setSuggest(null)
  }

  const commit = (index: number) => {
    if (!suggest) return
    const caret = suggest.at + suggest.triggerLen + suggest.query.length
    if (showCreate && index === candidates.length) {
      const name = suggest.query.trim()
      if (name === '') return
      // 作成は非同期でも構わない（name は確定済みなので即挿入できる）。
      // 失敗時は ref が未解決リンクになるだけなので握りつぶす。
      void Promise.resolve(onCreateEntry?.(name)).catch(() => {})
      insertRef(suggest.at, caret, name)
      return
    }
    const item = candidates[index]
    if (item) insertRef(suggest.at, caret, item.name)
  }

  // 挿入後にキャレットを [[名前]] の直後へ戻す。
  useLayoutEffect(() => {
    const pos = pendingCaretRef.current
    if (pos == null) return
    pendingCaretRef.current = null
    const el = taRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(pos, pos)
    }
  })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || composingRef.current || e.nativeEvent.isComposing) return
    if (narrow) {
      // スマホ：確定はバーのタップのみ。ソフトキーボードに Tab は無く、Enter は
      // 改行として使いたいので横取りしない（サジェスト表示中に改行できないのは致命的）。
      if (e.key === 'Escape') {
        e.preventDefault()
        setSuggest(null)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % total)
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + total) % total)
        break
      case 'Enter':
      case 'Tab':
        e.preventDefault()
        commit(activeIndex)
        break
      case 'Escape':
        e.preventDefault()
        setSuggest(null)
        break
    }
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-surface-container-lowest">
      {/* 本文（行数・文字数はエディタ画面下部のステータスバーが表示する） */}
      <textarea
        ref={taRef}
        aria-label="本文"
        aria-controls={open ? listId : undefined}
        // 狭幅のバーはハイライトの概念を持たない（確定はタップのみ）ので付けない。
        aria-activedescendant={open && !narrow ? optionId(activeIndex) : undefined}
        className="editor min-h-0 flex-1 resize-none border-none bg-transparent px-9 py-7 text-on-surface leading-[2.1] outline-none placeholder:text-on-surface-variant/40"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          if (!composingRef.current) refresh(e.currentTarget)
        }}
        onSelect={(e) => {
          if (!composingRef.current) refresh(e.currentTarget)
        }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          refresh(e.currentTarget)
        }}
        placeholder="ここから書き始めましょう。[[用語]] で図鑑にリンク、@ で図鑑から呼び出せます。"
        spellCheck={false}
      />

      {open && suggest ? (
        narrow ? (
          <RefSuggestBar
            candidates={candidates}
            query={suggest.query}
            showCreate={showCreate}
            listId={listId}
            optionId={optionId}
            onCommit={commit}
          />
        ) : (
          <RefSuggest
            candidates={candidates}
            query={suggest.query}
            showCreate={showCreate}
            activeIndex={activeIndex}
            top={suggest.top}
            left={suggest.left}
            listId={listId}
            optionId={optionId}
            onCommit={commit}
            onHover={setActiveIndex}
          />
        )
      ) : null}
    </div>
  )
}

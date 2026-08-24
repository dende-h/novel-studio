import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { resolveRef, shouldTriggerSuggest, suggestRefs } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
import { cn } from '@/lib/utils'
import { getCaretCoordinates } from '@/ui/_utils/caretCoordinates'
import { RefSuggest } from '@/ui/components/EditorPane/ref-suggest'

/**
 * blur で確定するテキストエリア。@／＠／[[ で用語集サジェストを出し、候補に無い語は
 * その場で用語集へ登録して [[名前]] を挿入する（本文エディタと同じ挙動）。
 *
 * プロットのビート（要約・メモ）と世界観設定が共有する。サジェストの発火判定・候補・
 * 挿入の作法は本文エディタと 1 つに保ちたいので、画面ごとに書き写さない。
 */
/** @／＠ が用語集サジェストのトリガ（本文エディタと同じ）。 */
const isSuggestTrigger = (ch: string) => ch === '@' || ch === '＠'

export function CommitTextarea({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  id,
  glossary,
  onCreateEntry,
  grow = true,
  className,
  wrapperClassName,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  ariaLabel: string
  /** ラベル要素と結びつけるための id（省略可）。 */
  id?: string
  /** 用語集（@ / [[ のサジェスト候補）。省略・空ならサジェストしない。 */
  glossary?: GlossaryEntry[]
  /** 候補に無い語をその場で用語集に登録する（作成した名前を返す。失敗は null）。 */
  onCreateEntry?: (name: string) => Promise<string | null>
  /**
   * true（既定）は内容に合わせて縦に伸びる＝プロットの要約・メモのように、
   * 親側がスクロールを持つ場所向け。false は高さを CSS に委ね、溢れたら欄の中で
   * スクロールする＝世界観設定のように、欄が画面の高さを占める場所向け。
   */
  grow?: boolean
  className?: string
  wrapperClassName?: string
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  // 用語集サジェスト（本文エディタと同じ挙動）。at＝トリガ位置、triggerLen＝@:1 / [[:2。
  const [suggest, setSuggest] = useState<{
    at: number
    triggerLen: number
    query: string
    top: number
    left: number
  } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // IME 変換中は候補を出さない（確定前の文字で絞り込むと候補が暴れる）。
  const composing = useRef(false)
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`
  const entries = glossary ?? []
  const candidates = useMemo(
    () => (suggest ? suggestRefs(suggest.query, entries) : []),
    [suggest, entries],
  )
  // 用語集に無い語を打っているときは「＋ 用語集に登録」を末尾に出す（本文エディタと同じ規則）。
  const showCreate = useMemo(() => {
    if (!suggest || !onCreateEntry) return false
    const q = suggest.query.trim()
    if (q === '') return false
    return resolveRef(q, entries) === undefined
  }, [suggest, entries, onCreateEntry])
  const total = candidates.length + (showCreate ? 1 : 0)
  const open = suggest !== null && total > 0

  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  // 内容の増減に高さを追従させる（scrollHeight を測るため一度 0 にする）。
  // パネル自体が専用スクロールを持つので、内側スクロールは作らない（重複スクロールの排除）。
  // 最後に送った内容。保存は非同期なので value の更新を待たずに二重送信しないための控え。
  const sent = useRef(value)
  useEffect(() => {
    if (!focused.current) sent.current = value
  }, [value])
  const commit = (next: string) => {
    if (next === sent.current) return
    sent.current = next
    onCommit(next)
  }

  const resizeToContent = (el: HTMLTextAreaElement) => {
    if (!grow) return
    el.style.height = '0'
    el.style.height = `${el.scrollHeight}px`
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft の変化で高さを測り直す（resizeToContent は毎レンダー同一の純関数）
  useLayoutEffect(() => {
    const el = ref.current
    if (el) resizeToContent(el)
  }, [draft])

  /** キャレット直前を走査してサジェストの開閉・絞り込みを更新する（本文エディタと同じ規則）。 */
  const refresh = (el: HTMLTextAreaElement) => {
    if (entries.length === 0 || composing.current) {
      setSuggest(null)
      return
    }
    const caret = el.selectionStart ?? 0
    const text = el.value
    let at = -1
    let triggerLen = 0
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i] ?? ''
      if (isSuggestTrigger(ch)) {
        at = i
        triggerLen = 1
        break
      }
      // [[ 検出（記法そのもの）。先頭の [ をトリガ位置にする。
      if (ch === '[' && (text[i - 1] ?? '') === '[') {
        at = i - 1
        triggerLen = 2
        break
      }
      // 区切り（空白・改行・] ＝ ref 閉じ）か 32 文字超で打ち切り。
      if (/\s/u.test(ch) || ch === ']' || caret - i > 32) break
    }
    // @ はメールアドレス等と紛れるので core のヒューリスティックで判定。[[ は常に発火。
    if (at < 0 || (triggerLen === 1 && !shouldTriggerSuggest(text.slice(0, at + 1)))) {
      setSuggest(null)
      return
    }
    const c = getCaretCoordinates(el, at)
    setSuggest({
      at,
      triggerLen,
      query: text.slice(at + triggerLen, caret),
      top: el.offsetTop + c.top + c.height,
      left: el.offsetLeft + c.left,
    })
    setActiveIndex(0)
  }

  /**
   * 候補（または「＋ 用語集に登録」）を [[名前]] として挿入する。
   * 作成行のときは用語集へ登録してからその名前を入れる＝用語集を正本に保つ。
   */
  const commitSuggestion = async (index: number) => {
    const el = ref.current
    if (!el || !suggest) return
    const isCreate = showCreate && index === candidates.length
    const name = isCreate ? suggest.query.trim() : candidates[index]?.name
    if (!name) return
    if (isCreate && onCreateEntry) {
      const created = await onCreateEntry(name)
      if (!created) return
    }
    const caret = el.selectionStart ?? 0
    // 記法ボタン等で置いた空枠 [[]] の閉じ括弧を二重にしない。
    const hasCloser = draft.startsWith(']]', caret)
    const end = hasCloser ? caret + 2 : caret
    const start =
      suggest.triggerLen === 1 &&
      hasCloser &&
      suggest.at >= 2 &&
      draft.startsWith('[[', suggest.at - 2)
        ? suggest.at - 2
        : suggest.at
    const inserted = `[[${name}]]`
    const next = draft.slice(0, start) + inserted + draft.slice(end)
    setDraft(next)
    setSuggest(null)
    // 挿入直後のキャレットを閉じ括弧の後ろへ置く（続けて書ける）。
    requestAnimationFrame(() => {
      const pos = start + inserted.length
      el.setSelectionRange(pos, pos)
      el.focus()
      resizeToContent(el)
    })
  }

  // 選択の切り替え・画面離脱で欄が外れるとき、blur を待たずに書きかけを確定する。
  const latest = useRef({ draft, commit })
  latest.current = { draft, commit }
  useEffect(() => {
    return () => {
      latest.current.commit(latest.current.draft)
    }
  }, [])

  return (
    <div className={cn('relative', wrapperClassName)}>
      <textarea
        ref={ref}
        id={id}
        rows={2}
        value={draft}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          resizeToContent(e.target)
          refresh(e.target)
        }}
        onClick={(e) => refresh(e.currentTarget)}
        onCompositionStart={() => {
          composing.current = true
          setSuggest(null)
        }}
        onCompositionEnd={(e) => {
          composing.current = false
          refresh(e.currentTarget)
        }}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
          setSuggest(null)
          commit(draft)
        }}
        onKeyDown={(e) => {
          if (open) {
            // 候補が出ている間の矢印・Enter・Tab はサジェスト操作に使う（改行させない）。
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveIndex((i) => (i + 1) % total)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex((i) => (i - 1 + total) % total)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              void commitSuggestion(activeIndex)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setSuggest(null)
              return
            }
          }
          if (e.key === 'Escape') {
            setDraft(value)
            sent.current = value
          }
        }}
        onKeyUp={(e) => {
          // 矢印・Home/End 等でキャレットだけ動いた場合の追従（入力は onChange で拾う）。
          if (!open && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) {
            refresh(e.currentTarget)
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          'w-full resize-none rounded-md border border-outline-variant/30 bg-surface px-2.5 py-1.5 text-[13px] text-on-surface leading-relaxed outline-none placeholder:text-on-surface-variant/45 focus:border-primary/50',
          grow ? 'overflow-hidden' : 'overflow-y-auto [scrollbar-gutter:stable]',
          className,
        )}
      />
      {open && suggest ? (
        <RefSuggest
          candidates={candidates}
          query={suggest.query}
          showCreate={showCreate}
          activeIndex={activeIndex}
          top={suggest.top}
          left={suggest.left}
          listId={listId}
          optionId={optionId}
          onCommit={(i) => void commitSuggestion(i)}
          onHover={setActiveIndex}
        />
      ) : null}
    </div>
  )
}

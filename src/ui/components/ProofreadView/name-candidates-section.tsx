import { useEffect, useId, useRef, useState } from 'react'
import type { NameCandidate } from '@/core/proofread'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/ui/button'

interface NameCandidatesSectionProps {
  /** いまの用語集と外した語で絞った候補。null＝前回の結果がまだ無い（準備中）、'error'＝使えない。 */
  candidates: ReadonlyArray<NameCandidate> | null | 'error'
  /** 外した語（外した順）。 */
  dismissed: ReadonlyArray<string>
  /** 本文にマーカーを引いている語（よく使う言葉と共用）。 */
  selected: string | null
  /** その名前がいま開いている話に出てくるか。 */
  inThisEpisode: (name: string) => boolean
  onSelect: (name: string | null) => void
  /** 登録フォームを開き、閉じたら「作成したか」を返す。 */
  onRegister: (candidate: NameCandidate) => Promise<'created' | 'cancelled'>
  onDismiss: (name: string) => void
  onRestore: (name: string) => void
}

/** 行が消えたあとのフォーカスの行き先（消えた行の位置）。 */
type PendingFocus = { name: string; index: number; restore: 'select' | 'register' | null }

/**
 * 推敲画面の「分析」の「用語集に無い名前」（COT-59 FR-3〜5）。
 * 行が消えたら（外す・登録）、次の行の名前のボタンへフォーカスを移す（無ければ前の行、どちらも無ければ見出し）。
 * 登録はダイアログ（App 側）を閉じたあとで移す（開いている間はダイアログがフォーカスを閉じ込めるため）。
 */
export function NameCandidatesSection({
  candidates,
  dismissed,
  selected,
  inThisEpisode,
  onSelect,
  onRegister,
  onDismiss,
  onRestore,
}: NameCandidatesSectionProps) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const selectRefs = useRef(new Map<string, HTMLButtonElement>())
  const registerRefs = useRef(new Map<string, HTMLButtonElement>())
  const [pending, setPending] = useState<PendingFocus | null>(null)
  const list = Array.isArray(candidates) ? candidates : null

  useEffect(() => {
    if (!pending || !list) return
    const stillThere = list.some((c) => c.name === pending.name)
    if (stillThere) {
      // 名前を直して作成した（行が残った）・キャンセルした
      if (pending.restore === 'register') registerRefs.current.get(pending.name)?.focus()
      else if (pending.restore === 'select') selectRefs.current.get(pending.name)?.focus()
      else return // 外した行がまだ消えていない（保存待ち）
      setPending(null)
      return
    }
    const next = list[pending.index] ?? list[pending.index - 1]
    if (next) selectRefs.current.get(next.name)?.focus()
    else headingRef.current?.focus()
    setPending(null)
  }, [pending, list])

  const dismiss = (c: NameCandidate, index: number) => {
    setPending({ name: c.name, index, restore: null })
    onDismiss(c.name)
  }
  const register = async (c: NameCandidate, index: number) => {
    const result = await onRegister(c)
    setPending({ name: c.name, index, restore: result === 'created' ? 'select' : 'register' })
  }

  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-1 font-medium text-on-surface text-xs outline-none"
      >
        用語集に無い名前（作品全体）
      </h3>
      <p className="mb-1.5 text-[11px] text-on-surface-variant">
        用語集に無い名前の候補です。2回以上出てくる語と、ルビや [[ ]] を付けた語を挙げます。
      </p>
      {candidates === 'error' ? (
        <p className="py-3 text-on-surface-variant text-xs">くわしい確認は、いまは使えません。</p>
      ) : candidates === null ? (
        <p className="py-3 text-on-surface-variant text-xs">
          くわしい確認の準備ができると表示します。
        </p>
      ) : candidates.length === 0 ? (
        <p className="py-3 text-on-surface-variant text-xs">
          用語集に無い名前は見つかりませんでした。
        </p>
      ) : (
        <>
          <ul className="space-y-0.5">
            {candidates.map((c, i) => {
              const on = selected === c.name
              const meta = [c.category, `${c.count}回`, `${c.episodes}話`]
                .filter(Boolean)
                .join('・')
              return (
                <li
                  key={c.name}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-2 py-1',
                    on ? 'bg-primary-container' : 'hover:bg-surface-container-low',
                  )}
                >
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) selectRefs.current.set(c.name, el)
                      else selectRefs.current.delete(c.name)
                    }}
                    aria-pressed={on}
                    onClick={() => onSelect(on ? null : c.name)}
                    className="min-w-0 rounded-sm text-left"
                  >
                    <span
                      className={cn(
                        'block break-words text-xs',
                        on ? 'font-medium text-on-primary-container' : 'text-on-surface',
                      )}
                    >
                      {c.name}
                    </span>
                    <span className="block text-[11px] text-on-surface-variant tabular-nums">
                      {meta}
                    </span>
                  </button>
                  <span className="flex gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      ref={(el) => {
                        if (el) registerRefs.current.set(c.name, el)
                        else registerRefs.current.delete(c.name)
                      }}
                      aria-label={`${c.name}を用語集に登録`}
                      onClick={() => void register(c, i)}
                    >
                      用語集に登録
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      aria-label={`${c.name}を外す`}
                      onClick={() => dismiss(c, i)}
                    >
                      外す
                    </Button>
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-1.5 text-[11px] text-on-surface-variant">
            {selected && candidates.some((c) => c.name === selected) && !inThisEpisode(selected)
              ? 'この話には出てきません。'
              : '名前を押すと、この話の本文にマーカーが引かれます。'}
          </p>
        </>
      )}
      {dismissed.length > 0 ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-on-surface-variant">
            外した語（{dismissed.length}）
          </summary>
          <ul className="mt-1 space-y-0.5">
            {dismissed.map((name) => (
              <li key={name} className="flex items-center justify-between gap-2 px-2">
                <span className="min-w-0 break-words text-on-surface">{name}</span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label={`${name}を戻す`}
                  onClick={() => onRestore(name)}
                >
                  戻す
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

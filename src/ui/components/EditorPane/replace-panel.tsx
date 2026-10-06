import { useId, useMemo, useState } from 'react'
import { planReplacement, type SearchMatch, searchWork } from '@/core/search/workSearch'
import { Button } from '@/ui/components/ui/button'

interface ReplacePanelProps {
  /** 置換対象（現在の話の本文）。 */
  embedded?: boolean
  disabled?: boolean
  value: string
  /** 置換後の本文と件数を通知する。個別置換は keepOpen=true でパネルを保持する。 */
  onApply: (next: string, count: number, keepOpen?: boolean) => void
  onClose: () => void
}

/**
 * 一括置換（現在の話の本文だけを対象）。検索語・置換語ともリテラル一致で、
 * 結果ごとの1件置換と「すべて置換」を提供する。エディタ列の右上に浮かぶカード。
 */
export function ReplacePanel({
  value,
  onApply,
  onClose,
  embedded = false,
  disabled = false,
}: ReplacePanelProps) {
  const [findQ, setFindQ] = useState('')
  const [replQ, setReplQ] = useState('')
  const [visible, setVisible] = useState(100)
  const titleId = useId()
  const sources = useMemo(() => [{ episodeId: 'current', title: '', text: value }], [value])
  const matches = useMemo(() => searchWork(sources, findQ), [sources, findQ])
  const count = matches.filter((match) => !match.isReference).length
  const protectedCount = matches.length - count

  const canReplace =
    !disabled && findQ !== '' && count > 0 && findQ !== replQ && !/[\r\n]/.test(replQ)
  const apply = (target: SearchMatch | 'all') => {
    if (disabled || findQ === '' || count === 0) return
    const plan = planReplacement(sources, findQ, replQ, target)[0]
    if (plan) {
      if (target === 'all') onApply(plan.after, plan.count)
      else onApply(plan.after, plan.count, true)
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      // 狭幅は固定幅の浮きカードだと本文をほぼ覆うため、上端の全幅シートにする。
      className={
        embedded
          ? 'flex min-h-0 flex-col gap-2.5'
          : 'absolute top-2.5 right-3.5 z-20 flex max-h-[min(85dvh,calc(100%_-_20px))] w-[360px] flex-col gap-2.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3.5 font-sans shadow-lg max-lg:inset-x-2 max-lg:w-auto'
      }
    >
      <h3 id={titleId} className="font-medium text-[13px] text-on-surface">
        この話の検索・置換
      </h3>
      <input
        type="text"
        aria-label="検索する語"
        placeholder="検索する語"
        value={findQ}
        disabled={disabled}
        onChange={(e) => {
          setFindQ(e.target.value)
          setVisible(100)
        }}
        className="h-11 shrink-0 rounded-md border border-outline-variant/40 bg-surface-container-lowest px-3 text-base text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/50 focus:border-primary md:h-[34px] md:text-[13px]"
      />
      <input
        type="text"
        aria-label="置換後の語"
        placeholder="置換後の語"
        value={replQ}
        disabled={disabled}
        onChange={(e) => setReplQ(e.target.value)}
        className="h-11 shrink-0 rounded-md border border-outline-variant/40 bg-surface-container-lowest px-3 text-base text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/50 focus:border-primary md:h-[34px] md:text-[13px]"
      />
      <p className="text-[11px] text-on-surface-variant">
        {findQ !== '' ? `${count}件を置換できます` : 'この話の本文だけを対象に置換します'}
      </p>
      <p className="text-[11px] text-on-surface-variant">
        用語集の参照は置換しません
        {protectedCount > 0 ? `（${protectedCount}件を除外）` : ''}
      </p>
      <div className="min-h-0 overflow-y-auto">
        {matches.slice(0, visible).map((match) => (
          <div key={match.start} className="border-outline-variant/30 border-b py-2">
            <p className="text-xs">
              <span className="block font-medium">{match.line}行目</span>
              <span className="block break-all">
                {match.excerpt.slice(0, match.excerptMatchStart)}
                <mark>{match.excerpt.slice(match.excerptMatchStart, match.excerptMatchEnd)}</mark>
                {match.excerpt.slice(match.excerptMatchEnd)}
              </span>
            </p>
            <Button
              variant="outline"
              className="mt-1 min-h-11"
              disabled={!canReplace || match.isReference}
              onClick={() => apply(match)}
            >
              この1件を置換
            </Button>
            {match.isReference ? (
              <p className="text-xs text-on-surface-variant">用語集の参照・置換対象外</p>
            ) : null}
          </div>
        ))}
        {matches.length > visible ? (
          <Button variant="ghost" className="min-h-11" onClick={() => setVisible((n) => n + 100)}>
            さらに表示
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        {embedded ? null : (
          <Button variant="outline" size="sm" onClick={onClose}>
            閉じる
          </Button>
        )}
        <Button size="sm" onClick={() => apply('all')} disabled={!canReplace}>
          すべて置換
        </Button>
      </div>
    </section>
  )
}

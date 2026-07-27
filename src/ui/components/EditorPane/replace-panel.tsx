import { useId, useMemo, useState } from 'react'
import { Button } from '@/ui/components/ui/button'

interface ReplacePanelProps {
  /** 置換対象（現在の話の本文）。 */
  value: string
  /** 置換後の本文と件数を通知する（適用は呼び出し側＝draft 更新）。 */
  onApply: (next: string, count: number) => void
  onClose: () => void
}

/** 文字列内の出現回数（リテラル一致・正規表現は使わない）。 */
const countOccurrences = (text: string, find: string): number =>
  find === '' ? 0 : text.split(find).length - 1

/**
 * 一括置換（現在の話の本文だけを対象）。検索語・置換語ともリテラル一致で、
 * 「すべて置換」で一括適用する。エディタ列の右上に浮かぶカード。
 */
export function ReplacePanel({ value, onApply, onClose }: ReplacePanelProps) {
  const [findQ, setFindQ] = useState('')
  const [replQ, setReplQ] = useState('')
  const titleId = useId()
  const count = useMemo(() => countOccurrences(value, findQ), [value, findQ])

  const apply = () => {
    if (findQ === '' || count === 0) return
    onApply(value.split(findQ).join(replQ), count)
  }

  return (
    <section
      aria-labelledby={titleId}
      // 狭幅は 280px の浮きカードだと本文をほぼ覆うため、上端の全幅シートにする。
      className="absolute top-2.5 right-3.5 z-20 flex w-[280px] flex-col gap-2.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3.5 font-sans shadow-lg max-lg:inset-x-2 max-lg:w-auto"
    >
      <h3 id={titleId} className="font-medium text-[13px] text-on-surface">
        一括置換
      </h3>
      <input
        type="text"
        aria-label="検索する語"
        placeholder="検索する語"
        value={findQ}
        onChange={(e) => setFindQ(e.target.value)}
        className="h-[34px] rounded-md border border-outline-variant/40 bg-surface-container-lowest px-3 text-base text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/50 focus:border-primary md:text-[13px]"
      />
      <input
        type="text"
        aria-label="置換後の語"
        placeholder="置換後の語"
        value={replQ}
        onChange={(e) => setReplQ(e.target.value)}
        className="h-[34px] rounded-md border border-outline-variant/40 bg-surface-container-lowest px-3 text-base text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/50 focus:border-primary md:text-[13px]"
      />
      <p className="text-[11px] text-on-surface-variant">
        {findQ !== '' ? `${count}件 見つかりました` : 'この話の本文だけを対象に置換します'}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          閉じる
        </Button>
        <Button size="sm" onClick={apply} disabled={findQ === '' || count === 0}>
          すべて置換
        </Button>
      </div>
    </section>
  )
}

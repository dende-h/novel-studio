import { Pencil, Plus, Tag, X } from 'lucide-react'
import { useMemo } from 'react'
import { type Appearances, resolveRef } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
import { cn } from '@/lib/utils'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'

interface GlossaryPeekProps {
  /** 図鑑の全 entry（用語チップの解決に使う）。 */
  entries: GlossaryEntry[]
  /** 現在の話の本文（[[用語]] を抽出して「この話に登場」を出す）。 */
  draft: string
  /** 選択中 entry（null なら未選択＝チップだけ表示）。 */
  entry: GlossaryEntry | null
  appearances: Appearances | null
  /** チップから entry を選択する。 */
  onSelect: (id: string) => void
  /** 未登録の名前からクイック作成を開く。 */
  onQuickCreate: (name: string) => void
  /** パネルを閉じる。 */
  onClose: () => void
  /** 図鑑画面で編集する（詳細編集はパネルでは行わず図鑑へ誘導）。 */
  onEdit: () => void
  /** 新しい entry の登録フォームを開く。 */
  onNewEntry: () => void
}

/** 本文中の [[用語]] を出現順・重複なしで抜き出す。 */
function termsInDraft(draft: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\[\[([^\]]+)\]\]/g
  let m = re.exec(draft)
  while (m !== null) {
    const name = (m[1] ?? '').trim()
    if (name !== '' && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
    m = re.exec(draft)
  }
  return out
}

/**
 * 図鑑パネル（エディタ右の aside）。「この話に登場」する用語チップと、選択中 entry の
 * チラ見（読み取り専用・編集は図鑑画面へ誘導）をまとめる。プレビューの @参照クリックでも開く。
 */
export function GlossaryPeek({
  entries,
  draft,
  entry,
  appearances,
  onSelect,
  onQuickCreate,
  onClose,
  onEdit,
  onNewEntry,
}: GlossaryPeekProps) {
  const terms = useMemo(() => {
    return termsInDraft(draft).map((raw) => {
      const resolved = resolveRef(raw, entries)
      return { raw, resolved }
    })
  }, [draft, entries])
  const used = (appearances?.refCount ?? 0) > 0

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-outline-variant/30 border-l bg-surface-container-lowest font-sans">
      <div className="flex items-center justify-between border-outline-variant/30 border-b px-4 py-3">
        <span className="font-medium text-[12px] text-on-surface tracking-widest">図鑑パネル</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="図鑑パネルを閉じる"
          className="-mr-1.5 size-7 text-on-surface-variant hover:text-on-surface"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* この話に登場する用語チップ */}
        <div className="flex flex-col gap-2 px-4 py-3.5">
          <span className="text-[10px] text-on-surface-variant/60 tracking-widest">
            この話に登場
          </span>
          {terms.length === 0 ? (
            <p className="text-[12px] text-on-surface-variant/70 leading-relaxed">
              本文に [[用語]] を書くと、ここに表示されます。
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {terms.map(({ raw, resolved }) => (
                <button
                  key={raw}
                  type="button"
                  aria-pressed={resolved !== undefined && resolved.id === entry?.id}
                  onClick={() => (resolved ? onSelect(resolved.id) : onQuickCreate(raw))}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                    resolved && resolved.id === entry?.id
                      ? 'border-primary bg-primary text-white'
                      : resolved
                        ? 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-low'
                        : 'border-wheat-500/50 border-dashed text-wheat-700 hover:bg-secondary',
                  )}
                >
                  {resolved ? resolved.name : `${raw}（未登録）`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 選択中 entry のチラ見 */}
        {entry ? (
          <div className="flex flex-col gap-2.5 border-outline-variant/30 border-t px-4 py-4">
            <div className="flex items-start gap-3">
              {entry.thumbnail ? (
                <ZoomableImage
                  src={entry.thumbnail}
                  alt={entry.name}
                  className="size-14 rounded-md border border-outline-variant/30 object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <h3 className="break-words font-semibold font-serif text-[17px] text-on-surface">
                  {entry.name}
                </h3>
                {entry.reading ? (
                  <p className="mt-0.5 text-[11px] text-on-surface-variant/70">{entry.reading}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {entry.category ? (
                <Badge
                  variant="secondary"
                  className="gap-1 bg-primary-container text-on-primary-container"
                >
                  <Tag className="size-3" />
                  {entry.category}
                </Badge>
              ) : null}
              <span className="text-[11px] text-on-surface-variant/70">
                {used && appearances
                  ? `${appearances.episodeIds.length}話・${appearances.refCount}回 登場`
                  : '未使用'}
              </span>
            </div>
            {entry.aliases.length > 0 ? (
              <p className="text-[12px] text-on-surface-variant">
                <span className="text-on-surface-variant/60">別名: </span>
                {entry.aliases.join('、')}
              </p>
            ) : null}
            {entry.summary ? (
              <p className="whitespace-pre-wrap text-[13px] text-on-surface leading-relaxed">
                {entry.summary}
              </p>
            ) : (
              <p className="text-[13px] text-on-surface-variant/60">説明はまだありません。</p>
            )}
            <Button variant="outline" size="sm" onClick={onEdit} className="w-full gap-2">
              <Pencil className="size-3.5" aria-hidden />
              図鑑で編集
            </Button>
          </div>
        ) : null}
      </ScrollArea>

      <div className="border-outline-variant/30 border-t px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewEntry}
          className="w-full gap-1.5 text-on-surface-variant hover:text-primary"
        >
          <Plus className="size-4" aria-hidden />
          新しく登録
        </Button>
      </div>
    </aside>
  )
}

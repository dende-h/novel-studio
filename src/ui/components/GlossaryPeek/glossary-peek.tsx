import { Pencil, Tag, X } from 'lucide-react'
import type { Appearances } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'

interface GlossaryPeekProps {
  entry: GlossaryEntry
  appearances: Appearances
  /** ピークを閉じる。 */
  onClose: () => void
  /** 辞書画面で編集する（詳細編集はピークでは行わず辞書へ誘導）。 */
  onEdit: () => void
}

/**
 * プレビューの解決済みグレーリンクをクリックしたときに右 aside に出す用語のチラ見表示
 * （履歴ドロワーと同じ枠を流用＝F-GLOS-LINK-003）。読み取り専用で、編集は辞書画面へ誘導する。
 */
export function GlossaryPeek({ entry, appearances, onClose, onEdit }: GlossaryPeekProps) {
  const used = appearances.refCount > 0
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-outline-variant/20 border-l bg-surface-container-low font-sans shadow-[-4px_0_24px_rgba(0,0,0,0.02)]">
      <div className="border-outline-variant/20 border-b bg-surface-bright p-6">
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            {entry.thumbnail ? (
              <img
                src={entry.thumbnail}
                alt=""
                className="size-16 shrink-0 rounded-md border border-outline-variant/20 object-cover"
              />
            ) : null}
            <div className="min-w-0">
              <h3 className="break-words font-serif text-lg text-on-surface">{entry.name}</h3>
              {entry.reading ? (
                <p className="mt-0.5 text-on-surface-variant/70 text-xs">{entry.reading}</p>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="ピークを閉じる"
            className="-mr-2 size-8 shrink-0 text-on-surface-variant hover:text-on-surface"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        {entry.category ? (
          <Badge variant="secondary" className="mt-1 gap-1">
            <Tag className="size-3" />
            {entry.category}
          </Badge>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-6">
          {entry.aliases.length > 0 ? (
            <p className="text-on-surface-variant text-sm">
              <span className="text-on-surface-variant/60">別名: </span>
              {entry.aliases.join('、')}
            </p>
          ) : null}
          {entry.summary ? (
            <p className="text-on-surface text-sm leading-relaxed">{entry.summary}</p>
          ) : null}
          {entry.body ? (
            <p className="whitespace-pre-wrap text-on-surface-variant text-sm leading-relaxed">
              {entry.body}
            </p>
          ) : null}
          {!entry.summary && !entry.body ? (
            <p className="text-on-surface-variant/60 text-sm">説明はまだありません。</p>
          ) : null}
          <p className="text-on-surface-variant/70 text-xs">
            {used ? `${appearances.episodeIds.length}話・${appearances.refCount}回 登場` : '未使用'}
          </p>
        </div>
      </ScrollArea>

      <div className="border-outline-variant/20 border-t p-4">
        <Button variant="outline" onClick={onEdit} className="w-full gap-2 text-primary">
          <Pencil className="size-4" aria-hidden />
          図鑑で編集
        </Button>
      </div>
    </aside>
  )
}

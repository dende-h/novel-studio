import { History, X } from 'lucide-react'
import type { Snapshot } from '@/core/snapshot'
import { formatRelative } from '@/ui/_utils/format'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'

interface HistoryPanelProps {
  snapshots: Snapshot[]
  currentEpisodeId: string | null
  onRestore: (snapshotId: string) => void
  /** ドロワーを閉じる（任意・指定時のみ閉じるボタンを表示） */
  onClose?: () => void
  /** 相対時刻の基準（テスト用に注入可） */
  now?: number
}

/** スナップショットから現在話の先頭段落を抜粋。 */
export function snapshotExcerpt(snap: Snapshot, episodeId: string | null): string {
  const ep = snap.work.episodes.find((e) => e.id === episodeId) ?? snap.work.episodes[0]
  if (!ep) return ''
  const para = ep.blocks.find((b) => b.type === 'paragraph')
  if (para?.type !== 'paragraph') return ''
  const text = para.inlines
    .map((i) => (i.type === 'ruby' ? i.base : i.type === 'ref' ? i.name : i.text))
    .join('')
  return text.slice(0, 60)
}

/** 履歴とバックアップ（ローカル・セーフティネット）。 */
export function HistoryPanel({
  snapshots,
  currentEpisodeId,
  onRestore,
  onClose,
  now,
}: HistoryPanelProps) {
  const base = now ?? Date.now()
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-outline-variant/30 border-l bg-surface-container-lowest font-sans">
      <div className="flex items-center justify-between border-outline-variant/30 border-b px-4 py-3">
        <h3 className="font-medium text-[12px] text-on-surface tracking-widest">
          ローカル・セーフティネット
        </h3>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="履歴を閉じる"
            className="-mr-1.5 size-7 text-on-surface-variant hover:text-on-surface"
          >
            <X className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-outline-variant/30 border-b px-4 py-3.5">
        <Badge variant="secondary" className="w-fit bg-primary-container text-on-primary-container">
          IndexedDB に保護されています
        </Badge>
        <p className="text-[11px] text-on-surface-variant leading-relaxed">
          保存のたびに端末内へ履歴を記録します。任意の版をいつでも本文へ復元できます。
        </p>
      </div>

      {/* Radix ScrollArea は子を display:table でラップしコンテンツ幅に伸びるため、
          長い無改行文字列でカードが横へはみ出す。内側ラッパを block に固定して折返しを効かせる。 */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="space-y-2 p-3">
          {snapshots.length === 0 ? (
            <p className="px-2 py-8 text-center text-[13px] text-on-surface-variant/60">
              まだ履歴はありません。
              <br />
              保存すると版が記録されます。
            </p>
          ) : (
            snapshots.map((snap, i) => {
              const current = i === 0
              return (
                <div
                  key={snap.id}
                  className={
                    current
                      ? 'flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border border-forest-400 bg-accent px-3 py-2.5'
                      : 'group flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 transition-colors hover:border-outline-variant/50'
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[12px] text-on-surface">
                      {current ? '現在の版' : '自動保存'}
                    </span>
                    <span className="text-[11px] text-on-surface-variant/70">
                      {formatRelative(snap.at, base)}
                    </span>
                  </div>
                  <p className="line-clamp-2 [overflow-wrap:anywhere] break-words border-outline-variant/40 border-l-2 pl-2 font-serif text-[11px] text-on-surface-variant leading-snug">
                    {snapshotExcerpt(snap, currentEpisodeId) || '（本文なし）'}
                  </p>
                  {current ? null : (
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRestore(snap.id)}
                        className="h-7 gap-1 px-2 text-on-surface-variant text-xs opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <History className="size-3" />
                        この版を復元
                      </Button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

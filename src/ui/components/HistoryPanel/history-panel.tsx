import { Database, RotateCcw, X } from 'lucide-react'
import type { Snapshot } from '@/core/snapshot'
import { formatRelative } from '@/ui/_utils/format'
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
    <aside className="flex w-[340px] shrink-0 flex-col border-outline-variant/20 border-l bg-surface-container-low font-sans shadow-[-4px_0_24px_rgba(0,0,0,0.02)]">
      <div className="border-outline-variant/20 border-b bg-surface-bright p-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-serif text-base text-on-surface">ローカル・セーフティネット</h3>
          {onClose ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="履歴を閉じる"
              className="-mr-2 size-8 text-on-surface-variant hover:text-on-surface"
            >
              <X className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded border border-outline-variant/30 bg-surface-container-lowest px-2 py-1 text-on-surface-variant text-xs">
          <Database className="size-3.5 text-primary" />
          IndexedDB に保護されています
        </p>
        <p className="mt-3 text-on-surface-variant/80 text-xs leading-relaxed">
          保存のたびに端末内へ履歴を記録します。任意の版を現在の本文へ復元できます。
        </p>
      </div>

      {/* Radix ScrollArea は子を display:table でラップしコンテンツ幅に伸びるため、
          長い無改行文字列でカードが横へはみ出す。内側ラッパを block に固定して折返しを効かせる。 */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="space-y-3 p-4">
          {snapshots.length === 0 ? (
            <p className="px-2 py-8 text-center text-on-surface-variant/60 text-sm">
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
                      ? 'relative min-w-0 overflow-hidden rounded-xl border border-primary/30 bg-surface-bright p-4'
                      : 'group relative min-w-0 overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 transition-colors hover:border-outline-variant/40 hover:bg-surface-bright'
                  }
                >
                  {current ? (
                    <span className="-left-px absolute top-4 bottom-4 w-[3px] rounded-r bg-primary" />
                  ) : null}
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block font-semibold text-on-surface text-sm">
                        {current ? '現在の版' : '自動保存'}
                      </span>
                      <span
                        className={
                          current ? 'text-primary text-xs' : 'text-on-surface-variant text-xs'
                        }
                      >
                        {formatRelative(snap.at, base)}
                      </span>
                    </div>
                    {current ? null : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRestore(snap.id)}
                        className="h-7 shrink-0 gap-1 border-primary/30 px-2 text-primary text-xs opacity-0 transition-opacity hover:bg-primary/5 hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <RotateCcw className="size-3" />
                        復元
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 [overflow-wrap:anywhere] break-words border-outline-variant/30 border-l-2 pl-2 font-serif text-[13px] text-on-surface-variant/80 italic leading-snug">
                    {snapshotExcerpt(snap, currentEpisodeId) || '（本文なし）'}
                  </p>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

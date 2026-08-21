import { History, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { collapseUnchanged, type DiffRow, diffLines } from '@/core/diff'
import { blocksToNotation } from '@/core/exporter/blocksToNotation'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { Snapshot } from '@/core/snapshot'
import { countEpisodeChars } from '@/core/stats'
import { formatRelative } from '@/ui/_utils/format'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { ScrollArea } from '@/ui/components/ui/scroll-area'

interface HistoryPanelProps {
  snapshots: Snapshot[]
  currentEpisodeId: string | null
  /** 現在エディタに載っている本文（記法テキスト）。復元前の差分表示に使う。 */
  currentText: string
  onRestore: (snapshotId: string) => void
  /** ドロワーを閉じる（任意・指定時のみ閉じるボタンを表示） */
  onClose?: () => void
  /** 相対時刻の基準（テスト用に注入可） */
  now?: number
}

/** スナップショットから復元対象の話（現在話を優先、無ければ先頭話）を取り出す。 */
function snapshotEpisode(snap: Snapshot, episodeId: string | null) {
  return snap.work.episodes.find((e) => e.id === episodeId) ?? snap.work.episodes[0]
}

/** スナップショットから現在話の先頭段落を抜粋。 */
export function snapshotExcerpt(snap: Snapshot, episodeId: string | null): string {
  const ep = snapshotEpisode(snap, episodeId)
  if (!ep) return ''
  const para = ep.blocks.find((b) => b.type === 'paragraph')
  if (para?.type !== 'paragraph') return ''
  const text = para.inlines
    .map((i) => (i.type === 'ruby' ? i.base : i.type === 'ref' ? i.name : i.text))
    .join('')
  return text.slice(0, 60)
}

/** スナップショット内の該当話の文字数（ライブラリ表示と同じ数え方）。 */
export function snapshotChars(snap: Snapshot, episodeId: string | null): number {
  const ep = snapshotEpisode(snap, episodeId)
  return ep ? countEpisodeChars(ep) : 0
}

const charsLabel = (n: number) => `${n.toLocaleString('ja-JP')}字`

/** 復元前の確認ダイアログ。現在の版との行差分を見せ、復元/キャンセルを選ばせる。 */
function RestoreConfirmDialog({
  snap,
  currentEpisodeId,
  currentText,
  base,
  onConfirm,
  onCancel,
}: {
  snap: Snapshot
  currentEpisodeId: string | null
  currentText: string
  base: number
  onConfirm: () => void
  onCancel: () => void
}) {
  const { rows, changed, snapCharCount, currentCharCount } = useMemo(() => {
    const ep = snapshotEpisode(snap, currentEpisodeId)
    const snapText = ep ? blocksToNotation(ep.blocks) : ''
    const lines = diffLines(currentText, snapText)
    return {
      rows: collapseUnchanged(lines, 2),
      changed: lines.some((l) => l.kind !== 'same'),
      snapCharCount: ep ? countEpisodeChars(ep) : 0,
      currentCharCount: countEpisodeChars({
        id: '',
        title: '',
        blocks: parseEpisodeBody(currentText),
      }),
    }
  }, [snap, currentEpisodeId, currentText])

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">この版を復元しますか？</DialogTitle>
          <DialogDescription className="text-[13px]">
            {formatRelative(snap.at, base)}の版（{charsLabel(snapCharCount)}）を、現在の版（
            {charsLabel(currentCharCount)}）と入れ替えます。復元しても本文の保存で新しい版が積まれ、
            現在の版は履歴に残ります。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {changed ? (
            <>
              <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block size-2.5 rounded-xs bg-error-container"
                    aria-hidden
                  />
                  復元すると消える行
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block size-2.5 rounded-xs bg-primary-container"
                    aria-hidden
                  />
                  復元すると戻る行
                </span>
              </div>
              <div className="overflow-hidden rounded-md border border-outline-variant/40">
                {rows.map((row, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 差分行は useMemo で丸ごと再生成され並べ替えも部分更新も無いため index キーで安全
                  <DiffRowView key={i} row={row} />
                ))}
              </div>
            </>
          ) : (
            <p className="py-4 text-center text-[13px] text-on-surface-variant">
              現在の版と同じ内容です。復元しても本文は変わりません。
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onConfirm}>
            <History className="size-3.5" />
            この版を復元
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DiffRowView({ row }: { row: DiffRow }) {
  if (row.kind === 'skip') {
    return (
      <div className="bg-surface-container-lowest px-3 py-1 text-center text-[11px] text-on-surface-variant/60">
        ⋯ {row.count}行 変更なし ⋯
      </div>
    )
  }
  const style =
    row.kind === 'del'
      ? 'bg-error-container/45'
      : row.kind === 'add'
        ? 'bg-primary-container/45'
        : ''
  const marker = row.kind === 'del' ? '−' : row.kind === 'add' ? '＋' : ''
  return (
    <div className={`flex gap-2 px-3 py-0.5 ${style}`}>
      <span className="w-3 shrink-0 select-none text-[12px] text-on-surface-variant/70">
        {marker}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere] break-words font-serif text-[12px] text-on-surface leading-relaxed">
        {row.text || ' '}
      </span>
    </div>
  )
}

/** 履歴とバックアップ（ローカル・セーフティネット）。 */
export function HistoryPanel({
  snapshots,
  currentEpisodeId,
  currentText,
  onRestore,
  onClose,
  now,
}: HistoryPanelProps) {
  const base = now ?? Date.now()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const confirmSnap = confirmId ? (snapshots.find((s) => s.id === confirmId) ?? null) : null
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
                    {/* origin='sync'＝同期が別端末の版を採用する／削除を伝播する直前に退避した版。
                        「バックアップしました」の行き先はここだと分かるように名前で示す。 */}
                    <span className="font-medium text-[12px] text-on-surface">
                      {snap.origin === 'sync' ? '同期で退避' : current ? '現在の版' : '自動保存'}
                    </span>
                    <span className="text-[11px] text-on-surface-variant/70">
                      {formatRelative(snap.at, base)}
                    </span>
                  </div>
                  <span className="text-[11px] text-on-surface-variant">
                    {charsLabel(snapshotChars(snap, currentEpisodeId))}
                  </span>
                  <p className="line-clamp-2 [overflow-wrap:anywhere] break-words border-outline-variant/40 border-l-2 pl-2 font-serif text-[11px] text-on-surface-variant leading-snug">
                    {snapshotExcerpt(snap, currentEpisodeId) || '（本文なし）'}
                  </p>
                  {current ? null : (
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmId(snap.id)}
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

      {confirmSnap ? (
        <RestoreConfirmDialog
          snap={confirmSnap}
          currentEpisodeId={currentEpisodeId}
          currentText={currentText}
          base={base}
          onConfirm={() => {
            onRestore(confirmSnap.id)
            setConfirmId(null)
          }}
          onCancel={() => setConfirmId(null)}
        />
      ) : null}
    </aside>
  )
}

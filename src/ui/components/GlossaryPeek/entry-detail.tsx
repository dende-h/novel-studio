import { Lock, Pencil, Tag } from 'lucide-react'
import { type Appearances, publicTextOf } from '@/core/glossary'
import { markdownToHtml } from '@/core/markdown'
import type { GlossaryEntry } from '@/core/schema'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'

/**
 * 用語 1 項目のチラ見（読み取り専用）。本文エディタの用語集パネル（GlossaryPeek）と、
 * 用語集画面のプレビューから開くチラ見ドロワーが共有する。
 * 見出し・分類と登場数・別名・公開情報・作者メモ・編集ボタン、の縦並びを描く
 * （gap は親の flex コンテナが持つ）。
 */
export function GlossaryEntryDetail({
  entry,
  appearances,
  onEdit,
  editLabel = '編集',
}: {
  entry: GlossaryEntry
  appearances: Appearances | null
  onEdit: () => void
  editLabel?: string
}) {
  const used = (appearances?.refCount ?? 0) > 0
  return (
    <>
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
      {/* 記法（[[用語]]・ルビ）とマークダウンを編集画面のプレビューと同じ見た目で描く。
          チラ見は読み取り専用なので参照はリンク化しない（resolvedNames を渡さない＝プレーンへ degrade）。 */}
      {publicTextOf(entry) ? (
        <div
          // biome-ignore lint/security/noDangerouslySetInnerHtml: core/markdown が全エスケープ済みの安全な HTML
          dangerouslySetInnerHTML={{ __html: markdownToHtml(publicTextOf(entry)) }}
          className="preview notation-preview text-[13px] text-on-surface leading-relaxed"
        />
      ) : (
        <p className="text-[13px] text-on-surface-variant/60">説明はまだありません。</p>
      )}
      {/* 作者メモは公開されない欄。執筆中も「内緒の情報だ」と分かる見た目にしておく。 */}
      {entry.authorNote ? (
        <div className="space-y-1 rounded-lg bg-surface-container-high px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[10.5px] text-on-surface-variant/70">
            <Lock className="size-2.5" aria-hidden />
            作者メモ（公開されません）
          </div>
          <div
            // biome-ignore lint/security/noDangerouslySetInnerHtml: core/markdown が全エスケープ済みの安全な HTML
            dangerouslySetInnerHTML={{ __html: markdownToHtml(entry.authorNote) }}
            className="preview notation-preview text-[12.5px] text-on-surface leading-relaxed"
          />
        </div>
      ) : null}
      <Button variant="outline" size="sm" onClick={onEdit} className="w-full gap-2">
        <Pencil className="size-3.5" aria-hidden />
        {editLabel}
      </Button>
    </>
  )
}

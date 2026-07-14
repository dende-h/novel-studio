import { Pencil, Tag, Trash2 } from 'lucide-react'
import type { Appearances } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'

interface GlossaryDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 表示対象（null なら中身なし＝閉じている想定）。 */
  entry: GlossaryEntry | null
  appearances: Appearances
  /** 「編集」押下（呼び出し側で本ダイアログを閉じ、編集フォームを開く）。 */
  onEdit: () => void
  /** 「削除」押下（呼び出し側で確認ダイアログを開く）。 */
  onDelete: () => void
}

/**
 * 図鑑項目の閲覧ダイアログ。カード押下で開き、内容（サムネ・読み・カテゴリ・別名・概要・登場数）を
 * ゆったり読める大きめのダイアログで表示する。ここから「編集」「削除」へ進む（カードの3点リーダは廃止）。
 */
export function GlossaryDetailDialog({
  open,
  onOpenChange,
  entry,
  appearances,
  onEdit,
  onDelete,
}: GlossaryDetailDialogProps) {
  const used = appearances.refCount > 0
  const initial = (entry?.name.trim().charAt(0) ?? '') || '？'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {entry ? (
          <>
            <DialogHeader>
              <div className="flex items-start gap-4">
                {/* サムネはクリックで拡大。無ければ頭文字タイル。 */}
                {entry.thumbnail ? (
                  <ZoomableImage
                    src={entry.thumbnail}
                    alt={entry.name}
                    className="size-24 rounded-lg border border-outline-variant/30 object-cover"
                    wrapperClassName="self-start"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="flex size-24 shrink-0 items-center justify-center self-start rounded-lg border border-outline-variant/30 bg-accent font-serif text-[32px] text-primary"
                  >
                    {initial}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <DialogTitle className="break-words text-left font-serif text-[22px] text-on-surface">
                    {entry.name}
                  </DialogTitle>
                  {entry.reading ? (
                    <DialogDescription className="mt-1 text-left text-on-surface-variant">
                      {entry.reading}
                    </DialogDescription>
                  ) : (
                    <DialogDescription className="sr-only">
                      図鑑項目「{entry.name}」の詳細
                    </DialogDescription>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {entry.category ? (
                      <Badge
                        variant="secondary"
                        className="gap-1 bg-primary-container text-on-primary-container"
                      >
                        <Tag className="size-3" />
                        {entry.category}
                      </Badge>
                    ) : null}
                    <span className="text-[12px] text-on-surface-variant/70">
                      {used
                        ? `${appearances.episodeIds.length}話・${appearances.refCount}回 登場`
                        : '未使用'}
                    </span>
                  </div>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3">
              {entry.aliases.length > 0 ? (
                <p className="text-[13px] text-on-surface-variant">
                  <span className="text-on-surface-variant/60">別名: </span>
                  {entry.aliases.join('、')}
                </p>
              ) : null}
              {entry.summary ? (
                <p className="whitespace-pre-wrap text-[14px] text-on-surface leading-relaxed">
                  {entry.summary}
                </p>
              ) : (
                <p className="text-[14px] text-on-surface-variant/60">説明はまだありません。</p>
              )}
            </div>

            <DialogFooter className="sm:justify-between">
              <Button
                variant="ghost"
                onClick={onDelete}
                className="gap-2 text-destructive hover:bg-error-container hover:text-destructive"
              >
                <Trash2 className="size-4" />
                削除
              </Button>
              <Button onClick={onEdit} className="gap-2">
                <Pencil className="size-4" />
                編集
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

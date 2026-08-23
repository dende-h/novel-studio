import { Lock, Pencil, Tag, Trash2 } from 'lucide-react'
import type { Appearances } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
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
 * 用語集の項目の閲覧ダイアログ。カード押下で開き、内容（サムネ・読み・カテゴリ・別名・概要・詳細・
 * 作者メモ・登場数）をゆったり読める大きめのダイアログで表示する。ここから「編集」「削除」へ進む。
 * 情報が多いときは本文（DialogBody）だけがスクロールし、ヘッダー／フッターは固定される。
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
                {/* サムネは大きめ・クリックで拡大。無ければ頭文字タイル。 */}
                {entry.thumbnail ? (
                  <ZoomableImage
                    src={entry.thumbnail}
                    alt={entry.name}
                    className="size-20 rounded-xl border border-outline-variant/30 object-cover sm:size-28"
                    wrapperClassName="self-start"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="flex size-20 shrink-0 items-center justify-center self-start rounded-xl border border-outline-variant/30 bg-accent font-serif text-[30px] text-primary sm:size-28 sm:text-[40px]"
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
                      用語「{entry.name}」の詳細
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

            <DialogBody>
              <div className="space-y-1">
                <div className="text-[11px] text-on-surface-variant/60 tracking-wide">別名</div>
                <p className="text-[13px] text-on-surface-variant">
                  {entry.aliases.length > 0 ? entry.aliases.join('、') : 'なし'}
                </p>
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-on-surface-variant/60 tracking-wide">概要</div>
                {entry.summary ? (
                  <p className="whitespace-pre-wrap text-[14px] text-on-surface leading-relaxed">
                    {entry.summary}
                  </p>
                ) : (
                  <p className="text-[14px] text-on-surface-variant/60">説明はまだありません。</p>
                )}
              </div>
              {entry.body ? (
                <div className="space-y-1">
                  <div className="text-[11px] text-on-surface-variant/60 tracking-wide">詳細</div>
                  <p className="whitespace-pre-wrap text-[14px] text-on-surface leading-relaxed">
                    {entry.body}
                  </p>
                </div>
              ) : null}
              {/* 作者メモは公開されない欄。他と地色を変えて「ここは内緒」を一目で分からせる。 */}
              {entry.authorNote ? (
                <div className="space-y-1 rounded-lg bg-surface-container-high px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/70 tracking-wide">
                    <Lock className="size-3" />
                    作者メモ（公開されません）
                  </div>
                  <p className="whitespace-pre-wrap text-[13.5px] text-on-surface leading-relaxed">
                    {entry.authorNote}
                  </p>
                </div>
              ) : null}
            </DialogBody>

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

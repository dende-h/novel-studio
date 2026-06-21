import { RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { TrashSummary } from '@/core/storage/workRepository'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

interface TrashDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** ゴミ箱の作品一覧（新しい順） */
  trash: TrashSummary[]
  /** 残り日数の算出基準（描画時の現在時刻） */
  now: number
  /** ゴミ箱の保持期間(ms)。残り日数の表示に使う。 */
  ttlMs: number
  onRestore: (id: string) => void
  onPurge: (id: string) => void
  onEmpty: () => void
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * ゴミ箱ダイアログ。削除した作品の一覧・復元・完全削除・空にする。
 * 破壊操作はネスト Dialog を避け、その場の2段クリック確認（confirming）で受ける。
 */
export function TrashDialog({
  open,
  onOpenChange,
  trash,
  now,
  ttlMs,
  onRestore,
  onPurge,
  onEmpty,
}: TrashDialogProps) {
  // インライン確認の対象：作品 id または 'empty'（全件）。null は未確認。
  const [confirming, setConfirming] = useState<string | null>(null)

  const handleOpenChange = (o: boolean) => {
    if (!o) setConfirming(null)
    onOpenChange(o)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary text-xl">ゴミ箱</DialogTitle>
          <DialogDescription>
            削除した作品は30日間ここに残り、いつでも元に戻せます。完全に削除すると、本文だけでなく執筆履歴（版）も元に戻せなくなります。期間を過ぎると自動的に完全削除されます。
          </DialogDescription>
        </DialogHeader>

        {trash.length === 0 ? (
          <p className="py-8 text-center text-on-surface-variant text-sm">ゴミ箱は空です。</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto py-1">
            {trash.map((t) => {
              const days = Math.max(0, Math.ceil((t.trashedAt + ttlMs - now) / DAY_MS))
              return (
                <li key={t.id} className="rounded-md border border-outline-variant/30 p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-on-surface text-sm">
                        {t.title || '無題の作品'}
                      </div>
                      <div className="text-on-surface-variant text-xs">
                        {t.episodeCount}話・
                        {days > 0 ? `あと${days}日で自動削除` : 'まもなく自動削除'}
                      </div>
                    </div>
                    {confirming === t.id ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-destructive text-xs">履歴ごと完全に削除？</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            onPurge(t.id)
                            setConfirming(null)
                          }}
                        >
                          削除
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirming(null)}
                          className="text-on-surface-variant"
                        >
                          やめる
                        </Button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onRestore(t.id)}
                          className="gap-1.5 text-primary"
                        >
                          <RotateCcw className="size-3.5" />
                          復元
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`「${t.title || '無題の作品'}」を完全に削除`}
                          onClick={() => setConfirming(t.id)}
                          className="text-on-surface-variant hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <DialogFooter className="sm:justify-between">
          {trash.length > 0 ? (
            confirming === 'empty' ? (
              <div className="flex items-center gap-2">
                <span className="text-destructive text-xs">全件を履歴ごと完全に削除？</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    onEmpty()
                    setConfirming(null)
                  }}
                >
                  空にする
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirming(null)}
                  className="text-on-surface-variant"
                >
                  やめる
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirming('empty')}
                className="text-on-surface-variant hover:text-destructive"
              >
                ゴミ箱を空にする
              </Button>
            )
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="text-primary"
          >
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

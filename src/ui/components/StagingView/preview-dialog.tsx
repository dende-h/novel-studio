import { useEffect, useState } from 'react'
import { buildNovelGameHtml } from '@/core/exporter/toNovelGame'
import type { Staging } from '@/core/game'
import type { UserGameAsset } from '@/core/game/assets'
import type { Episode, Work } from '@/core/schema'
import { loadGameFontDataUrl } from '@/ui/_utils/game-font'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

/**
 * 演出のプレビュー（アプリ内で遊べる・書き出しや投稿を待たない）。
 *
 * 中身は**書き出し・投稿と同じプレイヤー**をその場で組み立てたもの（素材はすべて内包）。
 * iframe は sandbox（同一オリジンを渡さない）で開く——アプリの保存領域に触れさせないため。
 * その代わりフォントは実体（data URL）で渡す（同じサイトの URL でも CORS で読めないので）。
 */
export function StagingPreviewDialog({
  open,
  onOpenChange,
  work,
  episode,
  staging,
  gameAssets,
  startAt,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  work: Work
  episode: Episode
  staging: Staging | undefined
  gameAssets: UserGameAsset[]
  /** この行から始める（省略＝タイトル画面から）。 */
  startAt?: number
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) {
      setHtml(null)
      setError(false)
      return
    }
    let alive = true
    void loadGameFontDataUrl()
      .catch(() => undefined)
      .then((fontHref) => {
        if (!alive) return
        try {
          setHtml(
            buildNovelGameHtml(work, episode, staging, {
              ...(fontHref ? { fontHref } : {}),
              gameAssets,
              ...(startAt !== undefined ? { startAt } : {}),
            }),
          )
        } catch {
          setError(true)
        }
      })
    return () => {
      alive = false
    }
  }, [open, work, episode, staging, gameAssets, startAt])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-on-surface">
            プレビュー{startAt === undefined ? '' : '（選んだ行から）'}
          </DialogTitle>
          <DialogDescription>
            いまの演出のまま遊べます。書き出し・投稿と同じプレイヤーです。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {error ? (
            <p className="text-destructive text-sm">
              プレビューを作れませんでした。演出を保存し直してから、もう一度お試しください。
            </p>
          ) : html === null ? (
            <p className="text-on-surface-variant text-sm">組み立てています…</p>
          ) : (
            <iframe
              // 同一オリジンを渡さない＝アプリの保存領域（IndexedDB・localStorage）に触れない
              sandbox="allow-scripts"
              srcDoc={html}
              title="サウンドノベルのプレビュー"
              className="aspect-video w-full rounded-md border border-outline-variant/30 bg-black"
            />
          )}
          <p className="text-[12px] text-on-surface-variant leading-relaxed">
            ここでの操作は、原稿にも演出にも影響しません。読んだところは記録されません。
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

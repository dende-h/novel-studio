import { Download, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  MAX_ENTRIES,
  type SyncLostEntry,
  type SyncLostRepository,
} from '@/core/sync/syncLostRepository'
import { triggerDownload } from '@/ui/_utils/download'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

interface SyncLostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repo: SyncLostRepository
  /** 一覧が変わったら呼ぶ（データ管理メニューの件数表示を更新する）。 */
  onChanged?: () => void
}

const fmt = (ms: number) =>
  new Date(ms).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

const KIND_LABEL: Record<SyncLostEntry['kind'], string> = {
  work: '作品',
  structure: '構造（アウトライン・相関図・マインドマップ）',
  plot: 'プロット',
  staging: 'サウンドノベルの演出',
  idea: 'ネタ帳',
  profile: 'プロフィール',
}

const REASON_LABEL: Record<SyncLostEntry['reason'], string> = {
  conflict: '別端末の版に置き換わる前の内容',
  remoteDelete: '別端末で削除される前の内容',
}

/**
 * 「同期で退避した版」の一覧。**退避先はどこなのか**に答えるための画面。
 *
 * 同期が別端末の版を採用したときや、別端末の削除が届いたときは、消える側の内容を必ず
 * 端末内へ退避している。作品の競合は履歴（ローカル・セーフティネット）に、履歴を開けなくなる
 * 削除の伝播と、履歴を持たない構造・プロット・ネタ帳・プロフィールは JSON として。ここは
 * その置き場所の目次で、JSON はファイルへ書き出せる（復元は全置換になり取り違えが怖いので、
 * 戻し方は書き出し→取り込みに留める）。
 *
 * 保持は最大 MAX_ENTRIES 件・1 アイテム 1 世代で、超えた分は古いものから押し出す。
 */
export function SyncLostDialog({ open, onOpenChange, repo, onChanged }: SyncLostDialogProps) {
  const [entries, setEntries] = useState<SyncLostEntry[] | null>(null)

  const reload = useCallback(async () => {
    setEntries(await repo.list())
    onChanged?.()
  }, [repo, onChanged])

  useEffect(() => {
    if (!open) return
    setEntries(null)
    void reload()
  }, [open, reload])

  const download = (entry: SyncLostEntry) => {
    if (!entry.json) return
    const stamp = new Date(entry.at).toISOString().slice(0, 19).replace(/[:T]/g, '-')
    triggerDownload({
      filename: `kotonoha-synclost-${entry.kind}-${stamp}.json`,
      mime: 'application/json;charset=utf-8',
      data: entry.json,
    })
  }

  const remove = async (syncId: string) => {
    await repo.remove(syncId)
    await reload()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">同期で退避した版</DialogTitle>
          <DialogDescription>
            端末どうしで同じものを別々に編集したとき、また別の端末で削除されたときは、
            <strong>消える側の内容をこの端末に残します</strong>
            。作品の競合は執筆画面の「履歴」に、それ以外（削除された作品・構造・プロット・ネタ帳・プロフィール）は
            ここに JSON として残ります。保持は最大 {MAX_ENTRIES} 件・1 つにつき 1 世代で、
            超えた分は古いものから消えます（際限なく溜まりません）。
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {entries === null ? (
              <p className="py-6 text-center text-on-surface-variant text-sm">読み込み中…</p>
            ) : entries.length === 0 ? (
              <p className="py-6 text-center text-on-surface-variant text-sm">
                退避された版はありません。
              </p>
            ) : (
              entries.map((e) => (
                <div
                  key={e.syncId}
                  className="flex items-start justify-between gap-3 rounded-lg border border-outline-variant/30 px-3 py-2"
                >
                  <div className="min-w-0 font-sans">
                    <p className="truncate text-on-surface text-sm">
                      {e.title ?? KIND_LABEL[e.kind]}
                    </p>
                    <p className="text-on-surface-variant text-xs">
                      {KIND_LABEL[e.kind]}・{REASON_LABEL[e.reason]}
                    </p>
                    <p className="text-on-surface-variant/70 text-xs tabular-nums">{fmt(e.at)}</p>
                    {e.kind === 'work' && e.reason === 'conflict' ? (
                      <p className="mt-1 text-on-surface-variant text-xs">
                        この作品の内容は執筆画面の「履歴」に残しています。
                      </p>
                    ) : null}
                  </div>
                  <span className="flex shrink-0 items-center gap-1">
                    {e.json ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-primary"
                        onClick={() => download(e)}
                      >
                        <Download className="size-3.5" aria-hidden />
                        書き出し
                      </Button>
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="この退避を削除"
                      onClick={() => void remove(e.syncId)}
                      className="text-on-surface-variant hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </span>
                </div>
              ))
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

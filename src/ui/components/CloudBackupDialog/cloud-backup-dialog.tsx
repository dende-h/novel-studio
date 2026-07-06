import { CloudUpload, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { BackupService, BackupSummary } from '@/ui/backup/backup-service'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

interface CloudBackupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  service: BackupService
  /** 完了通知（トースト）。 */
  onNotify: (message: string) => void
  /** 復元後にライブラリ一覧を再読込する。 */
  onRestored: () => Promise<void> | void
}

const fmt = (ms: number) =>
  new Date(ms).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * クラウド全体バックアップの管理（バックアップ/復元モデル）。
 * 「今すぐバックアップ」＋ バックアップ一覧（時刻）から選んで **ローカル全体を置換（復元）**。
 * 復元は破壊的なので二段確認し、置換前に現在の状態を自動でクラウドへ安全退避する。
 */
export function CloudBackupDialog({
  open,
  onOpenChange,
  service,
  onNotify,
  onRestored,
}: CloudBackupDialogProps) {
  const [backups, setBackups] = useState<BackupSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setBackups(await service.list())
  }, [service])

  useEffect(() => {
    if (open) {
      setConfirmId(null)
      setBackups(null)
      void reload()
    }
  }, [open, reload])

  const backupNow = async () => {
    setBusy(true)
    try {
      const res = await service.backupNow()
      onNotify(res ? 'クラウドにバックアップしました' : 'バックアップに失敗しました')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const restore = async (id: string) => {
    setBusy(true)
    try {
      const ok = await service.restore(id)
      if (ok) {
        await onRestored()
        onNotify('このバックアップでローカルを復元しました（直前の状態は自動退避済み）')
        onOpenChange(false)
      } else {
        onNotify('復元に失敗しました')
      }
    } catch {
      onNotify('バックアップが壊れているため復元しませんでした')
    } finally {
      setBusy(false)
      setConfirmId(null)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await service.remove(id)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">クラウドバックアップ</DialogTitle>
          <DialogDescription>
            全作品・ゴミ箱・プロフィールをまとめてクラウドに保存します。復元は選んだ時点で
            <strong>ローカル全体を置き換え</strong>ます（置換前に現在の状態を自動で退避）。
          </DialogDescription>
        </DialogHeader>

        <Button onClick={backupNow} disabled={busy} className="w-full gap-2">
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <CloudUpload className="size-4" aria-hidden />
          )}
          今すぐバックアップ
        </Button>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {backups === null ? (
            <p className="py-6 text-center text-on-surface-variant text-sm">読み込み中…</p>
          ) : backups.length === 0 ? (
            <p className="py-6 text-center text-on-surface-variant text-sm">
              まだバックアップがありません。
            </p>
          ) : (
            backups.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-outline-variant/30 px-3 py-2"
              >
                <span className="font-sans text-on-surface text-sm">{fmt(b.createdAt)}</span>
                {confirmId === b.id ? (
                  <span className="flex items-center gap-2">
                    <span className="text-destructive text-xs">全置換で復元しますか？</span>
                    <Button size="sm" onClick={() => restore(b.id)} disabled={busy}>
                      復元する
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmId(null)}
                      disabled={busy}
                    >
                      取消
                    </Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-primary"
                      onClick={() => setConfirmId(b.id)}
                      disabled={busy}
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      復元
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="このバックアップを削除"
                      onClick={() => remove(b.id)}
                      disabled={busy}
                      className="text-on-surface-variant hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

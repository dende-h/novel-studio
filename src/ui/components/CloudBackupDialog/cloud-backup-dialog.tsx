import { CloudUpload, LoaderCircle, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { BackupService, BackupSummary } from '@/ui/backup/backup-service'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
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
  // AI（MCP）の変更を取り込む前の確認。
  const [pullConfirm, setPullConfirm] = useState(false)
  // 復元時に「置換前の現在の状態」をクラウドへ残すか（任意・既定オフ＝バックアップを無闇に増やさない）。
  const [keepCurrent, setKeepCurrent] = useState(false)

  const reload = useCallback(async () => {
    setBackups(await service.list())
  }, [service])

  useEffect(() => {
    if (open) {
      setConfirmId(null)
      setPullConfirm(false)
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

  const pullFromAi = async () => {
    setBusy(true)
    try {
      const ok = await service.pullLive()
      if (ok) {
        await onRestored()
        onNotify('AIの変更を取り込みました（ローカルを置き換え）')
        onOpenChange(false)
      } else {
        onNotify('取り込める変更がありません')
      }
    } catch {
      onNotify('取り込みデータが壊れているため取り込みませんでした')
    } finally {
      setBusy(false)
      setPullConfirm(false)
    }
  }

  const restore = async (id: string) => {
    setBusy(true)
    try {
      const ok = await service.restore(id, { backupCurrent: keepCurrent })
      if (ok) {
        await onRestored()
        onNotify(
          keepCurrent
            ? 'このバックアップで復元しました（置換前の状態も退避済み）'
            : 'このバックアップでローカルを復元しました',
        )
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
            全作品・ゴミ箱・プロフィール・執筆記録（草）をまとめてクラウドに保存します。復元は選んだ時点で
            <strong>ローカル全体を置き換え</strong>ます（置換前に現在の状態を自動で退避）。
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Button onClick={backupNow} disabled={busy} className="w-full gap-2">
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <CloudUpload className="size-4" aria-hidden />
            )}
            今すぐバックアップ
          </Button>

          {/* AI（MCPコネクタ）が書き込んだ変更をローカルへ取り込む（全置換）。 */}
          <div className="mt-3 space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
            <p className="flex items-start gap-1.5 text-on-surface-variant text-xs">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <span>
                Claude などの AI コネクタで編集した内容を取り込みます。
                <strong>ローカル全体が置き換わります</strong>。
              </span>
            </p>
            {pullConfirm ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-destructive text-xs">全置換で取り込みますか？</span>
                <Button size="sm" onClick={() => void pullFromAi()} disabled={busy}>
                  取り込む
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPullConfirm(false)}
                  disabled={busy}
                  className="text-on-surface-variant"
                >
                  取消
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPullConfirm(true)}
                disabled={busy}
                className="gap-1.5 text-primary"
              >
                <Sparkles className="size-4" aria-hidden />
                AIの変更を取り込む
              </Button>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2 font-sans text-on-surface-variant text-xs">
            <input
              type="checkbox"
              checked={keepCurrent}
              onChange={(e) => setKeepCurrent(e.target.checked)}
              className="size-4 accent-primary"
            />
            復元するとき、置換前の現在の状態もバックアップに残す
          </label>

          {/* 件数が増えても内部スクロールで高さを抑える（モーダルが伸び続けない）。 */}
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
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
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

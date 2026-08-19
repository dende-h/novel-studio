import { LoaderCircle, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { BackupService, LiveMeta } from '@/ui/backup/backup-service'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

interface AiPullDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  service: BackupService
  /** 完了通知（トースト）。 */
  onNotify: (message: string) => void
  /** 取り込み後にライブラリ一覧を再読込する。 */
  onRestored: () => Promise<void> | void
}

const fmt = (ms: number) =>
  new Date(ms).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

/** ざっくり相対時刻（「たった今」「12分前」「3時間前」「2日前」）。 */
function relative(ms: number, now: number): string {
  const min = Math.floor(Math.max(0, now - ms) / 60000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}時間前`
  return `${Math.floor(hr / 24)}日前`
}

/**
 * AI（MCP コネクタ）がライブスナップショットに書いた変更をローカルへ取り込む。
 * クラウドバックアップと同列のデータ管理メニューから開く独立ダイアログ。
 * 取り込みは破壊的（ローカル全体を置換）なので二段確認し、任意で置換前の状態を退避できる。
 */
export function AiPullDialog({
  open,
  onOpenChange,
  service,
  onNotify,
  onRestored,
}: AiPullDialogProps) {
  // undefined=取得中 / null=取得失敗 / LiveMeta=取得済み。
  const [info, setInfo] = useState<LiveMeta | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  // 取り込み前に現在の状態をクラウドへ退避するか。AI がプロット等を大量に書き換えられる
  // ようになったため既定 ON（外すのを能動操作にする）。復元側の任意チェックと同じ安全網。
  const [backupCurrent, setBackupCurrent] = useState(true)

  useEffect(() => {
    if (!open) return
    setConfirm(false)
    setInfo(undefined)
    void service.liveInfo().then(setInfo)
  }, [open, service])

  const pull = async () => {
    setBusy(true)
    try {
      const ok = await service.pullLive({ backupCurrent })
      if (ok) {
        await onRestored()
        onNotify(
          backupCurrent
            ? 'AIの変更を取り込みました（置換前の状態も退避済み）'
            : 'AIの変更を取り込みました（ローカルを置き換え）',
        )
        onOpenChange(false)
      } else {
        onNotify('取り込める変更がありません')
      }
    } catch {
      onNotify('取り込みデータが壊れているため取り込みませんでした')
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  const canPull = info?.exists === true

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-primary">
            <Sparkles className="size-5" aria-hidden />
            AIの変更を取り込む
          </DialogTitle>
          <DialogDescription>
            Claude などの AI コネクタが編集した内容をローカルへ反映します。取り込むと
            <strong>ローカル全体が置き換わります</strong>
            。複数回に分けた AI の編集は、取り込み前ならまとめて 1 つの変更として反映されます。
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {/* AI 側の最終編集時刻。 */}
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
            {info === undefined ? (
              <p className="flex items-center gap-2 text-on-surface-variant">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                確認中…
              </p>
            ) : info === null ? (
              <p className="text-on-surface-variant">AI の編集状況を取得できませんでした。</p>
            ) : !info.exists ? (
              <p className="text-on-surface-variant">
                AI が参照するデータ（ライブスナップショット）がまだありません。「AI
                に接続（MCP）」で接続すると作成されます。
              </p>
            ) : info.aiEditedAt ? (
              <p className="text-on-surface">
                AI の最終編集：<strong>{fmt(info.aiEditedAt)}</strong>
                <span className="text-on-surface-variant">
                  {' '}
                  （{relative(info.aiEditedAt, Date.now())}）
                </span>
              </p>
            ) : (
              <p className="text-on-surface-variant">
                未取り込みの AI 編集はありません（最後にこの端末から同期した状態のままです）。
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2 font-sans text-on-surface-variant text-xs">
            <input
              type="checkbox"
              checked={backupCurrent}
              onChange={(e) => setBackupCurrent(e.target.checked)}
              className="size-4 accent-primary"
            />
            取り込む前に、現在の状態もクラウドにバックアップする
          </label>

          {confirm ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-destructive text-sm">
                全置換で取り込みますか？（元に戻せません）
              </span>
              <Button onClick={() => void pull()} disabled={busy} className="gap-2">
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                取り込む
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirm(false)}
                disabled={busy}
                className="text-on-surface-variant"
              >
                取消
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => setConfirm(true)}
              disabled={busy || !canPull}
              className="w-full gap-2"
            >
              <Sparkles className="size-4" aria-hidden />
              AIの変更を取り込む（全置換）
            </Button>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

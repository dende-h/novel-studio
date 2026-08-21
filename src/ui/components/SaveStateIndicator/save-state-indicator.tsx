import { useBackupMarks } from '@/ui/hooks/use-backup-marks'
import { useSyncStatus } from '@/ui/hooks/use-sync-status'

/**
 * 全データの保存状態を淡々と示すインジケータ（タスク1・A案3行）。マイライブラリの隅に常設する。
 * バックアップは全作品がスコープなので、作品単体の執筆画面ではなく全体を俯瞰するこの場所に置く。
 *
 * 設計上の厳守事項：
 * - 日時を縦に並べるだけ。経過日数や差分を強調して不安を煽らない（差は読み手が読み取れる）。
 * - 点滅・赤・警告アイコンを使わない。古くなっても色や大きさを変えない。小さく、主張しない。
 * - 販売の場所ではない。行はクリックで各操作（書き出し／クラウド）へ飛べるが訴求文言は置かない。
 */

function fmt(ms: number | null): string {
  if (!ms) return '―'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

interface SaveStateIndicatorProps {
  /** 全作品で一番最近の端末内保存時刻（epoch ms・無ければ null）。 */
  lastUpdatedAt: number | null
  /** ファイルへの書き出しダイアログを開く（誰でも）。 */
  onOpenFileBackup?: () => void
  /** クラウドバックアップダイアログを開く（会員のときだけ渡す）。 */
  onOpenCloudBackup?: () => void
}

export function SaveStateIndicator({
  lastUpdatedAt,
  onOpenFileBackup,
  onOpenCloudBackup,
}: SaveStateIndicatorProps) {
  const marks = useBackupMarks()
  const sync = useSyncStatus()
  const rows: Array<{ label: string; value: string; onClick?: () => void }> = [
    { label: '最終更新', value: fmt(lastUpdatedAt) },
    { label: 'ファイルへの書き出し', value: fmt(marks.localBackupAt), onClick: onOpenFileBackup },
    { label: 'クラウドバックアップ', value: fmt(marks.cloudBackupAt), onClick: onOpenCloudBackup },
    // 会員のときだけ。同期が動いていることを、通知ではなくこの一行で分かるようにする。
    ...(sync.enabled
      ? [{ label: 'クラウド同期', value: sync.syncing ? '同期中…' : fmt(sync.lastSyncedAt) }]
      : []),
  ]
  return (
    <dl className="space-y-1 font-sans text-on-surface-variant text-xs">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-6">
          {r.onClick ? (
            <button
              type="button"
              onClick={r.onClick}
              className="text-left underline-offset-2 hover:text-primary hover:underline"
            >
              {r.label}
            </button>
          ) : (
            <dt>{r.label}</dt>
          )}
          <dd className="tabular-nums">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuth } from '@/ui/auth/auth-context'
import { NarrationBackupIO } from '@/ui/narration/backup'
import { narrationTransfer, subscribeNarrationTransfer } from '@/ui/narration/transfer-status'

const formatUsed = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  const scale = bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3
  return `${(bytes / 1024 ** scale).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} ${['', 'KB', 'MB', 'GB'][scale]}`
}

export function NarrationCloudStatus() {
  const { userId, getToken, status, canRestore } = useAuth()
  const owner = userId ?? 'local'
  const cloud = useSyncExternalStore(subscribeNarrationTransfer, () => narrationTransfer(owner))
  const io = useMemo(() => new NarrationBackupIO(owner, getToken), [owner, getToken])
  useEffect(() => {
    if (status === 'member' || canRestore) void io.usage().catch(() => {})
  }, [io, status, canRestore])
  if (status !== 'member' && !canRestore)
    return (
      <p>朗読の設定・音声はこの端末に保存されます。バックアップの書き出しで音声も保存できます。</p>
    )
  return (
    <div aria-live="polite">
      <p>
        {cloud.busy
          ? '朗読音声をクラウドに保存中…'
          : cloud.error ||
            (cloud.savedAt ? '朗読音声をクラウドに保存済み' : '朗読の設定と音声も同期します。')}
      </p>
      {cloud.limit !== undefined && (
        <p>
          現在の朗読：{formatUsed(cloud.used ?? 0)} / {(cloud.limit / 1024 ** 3).toFixed(0)} GB
        </p>
      )}
      <p>
        現在の朗読をクラウドに保存します。復元用の音声は、対応するバックアップを保持している間は別に保管します。
      </p>
    </div>
  )
}

import { CloudDownload, Download, LoaderCircle } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Button } from '@/ui/components/ui/button'

// 再購読の料金カード。Stripe 直課金。ここに来るのはサインイン済みなので lazy import。
const CloudPricing = lazy(() => import('@/ui/auth/cloud-pricing'))

interface RestoreGraceProps {
  /** クラウドデータが削除される時刻（epoch ms）。残り日数の表示に使う。 */
  graceUntil: number
  /** クラウドからの復元（CloudBackupDialog を復元専用モードで開く）。 */
  onRestore: () => void
  /** 端末に戻したデータを無料のファイル書き出しで保存する。 */
  onExport: () => void | Promise<void>
  /** サインアウト（ゲストに戻る）。 */
  onSignOut: () => void
}

/**
 * 解約後の「復元猶予期間」全画面。クラウドバックアップからの復元だけを許可し、端末に戻したうえで
 * 無料のファイル書き出しで手元に保存できる導線を出す（データ持ち出しの安全網）。猶予後はクラウドの
 * データが削除されるため、残り日数を明示する。再購読すればデータはそのまま継続できる。
 */
export function RestoreGrace({ graceUntil, onRestore, onExport, onSignOut }: RestoreGraceProps) {
  const days = Math.max(0, Math.ceil((graceUntil - Date.now()) / 86_400_000))
  return (
    <div className="min-h-dvh w-full overflow-y-auto bg-background font-sans">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-6 py-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-surface-container text-primary">
          <CloudDownload className="size-8" aria-hidden />
        </div>
        <div className="space-y-3">
          <h1 className="font-serif text-3xl text-on-surface">クラウドのデータを手元に戻せます</h1>
          <p className="mx-auto max-w-xl text-on-surface-variant leading-relaxed">
            解約が完了しました。クラウドに預けた原稿は{' '}
            <strong className="text-primary">あと {days} 日</strong> で削除されます。それまでは
            <strong>復元</strong>して端末に戻し、ファイルに書き出して保存できます。
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row">
          <Button onClick={onRestore} className="gap-2">
            <CloudDownload className="size-4" aria-hidden />
            1. クラウドから復元
          </Button>
          <Button variant="outline" onClick={() => void onExport()} className="gap-2">
            <Download className="size-4" aria-hidden />
            2. ファイルに書き出す
          </Button>
        </div>

        <div className="w-full border-outline-variant/30 border-t pt-8">
          <p className="mb-4 text-on-surface-variant text-sm">
            またクラウドを使うなら、再開できます（データはそのまま）。
          </p>
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-8 text-on-surface-variant text-sm">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                読み込み中…
              </div>
            }
          >
            <CloudPricing />
          </Suspense>
        </div>

        <Button
          variant="ghost"
          onClick={onSignOut}
          className="text-on-surface-variant hover:text-primary"
        >
          サインアウトする
        </Button>
      </div>
    </div>
  )
}

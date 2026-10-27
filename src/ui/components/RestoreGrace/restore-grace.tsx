import { CloudDownload, Download } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'

interface RestoreGraceProps {
  /** クラウドデータが削除される時刻（epoch ms）。残り日数の表示に使う。 */
  graceUntil: number
  /** クラウドからの復元（CloudBackupDialog を復元専用モードで開く）。 */
  onRestore: () => void
  /** 端末に戻したデータを無料のファイル書き出しで保存する。 */
  onExport: () => void | Promise<void>
  /** クラウド版を再開する（料金の案内へ）。 */
  onResume?: () => void
}

/**
 * 解約後の「復元猶予期間」の案内。ライブラリの上部に出す。
 *
 * かつては全画面でアプリを塞ぎ、復元・書き出し・再購読・サインアウトしか選べなかった。これは
 * 「アカウント＝課金者」だった頃の名残で、未課金のサインイン済み（free）を正当な状態に
 * したあとも残っていた（解約した人だけが無料の機能を使えず、ログインのたびにここへ戻された）。
 * 解約しても無料アカウントとして使い続けられるので、ここは案内だけにする。
 * 猶予後はクラウドのデータが削除されるため、残り日数を明示する。
 */
export function RestoreGrace({ graceUntil, onRestore, onExport, onResume }: RestoreGraceProps) {
  const days = Math.max(0, Math.ceil((graceUntil - Date.now()) / 86_400_000))
  return (
    <section
      aria-label="クラウドのデータの削除予定"
      className="mb-8 flex flex-col gap-3 rounded-lg border border-outline-variant/40 bg-surface-container px-5 py-4 font-sans md:flex-row md:items-center md:justify-between"
    >
      <div className="flex gap-3">
        <CloudDownload className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <p className="text-[13px] text-on-surface-variant leading-relaxed">
          クラウド版を解約したため、クラウドに預けた原稿は{' '}
          <strong className="text-primary">あと {days} 日</strong>{' '}
          で削除されます。それまでは復元して端末に戻し、ファイルに書き出して保存できます。この端末の原稿はそのまま使えます。
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" onClick={onRestore} className="gap-1.5">
          <CloudDownload className="size-4" aria-hidden />
          クラウドから復元
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onExport()} className="gap-1.5">
          <Download className="size-4" aria-hidden />
          ファイルに書き出す
        </Button>
        {onResume ? (
          <Button size="sm" variant="ghost" onClick={onResume}>
            クラウド版を再開
          </Button>
        ) : null}
      </div>
    </section>
  )
}

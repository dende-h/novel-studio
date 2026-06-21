import { CheckCircle2, Download, Info } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

interface BackupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** バックアップ対象の作品数（説明表示用）。 */
  workCount: number
  /** 実際の書き出し（全作品を 1つの JSON にしてダウンロード）。 */
  onExport: () => void | Promise<void>
}

/**
 * 全作品のバックアップ（構造化データ JSON）書き出しダイアログ。取り込み（ImportDialog）と対。
 * 個別作品の書き出し（EPUB/Web/フォルダ/AI）とは分離し、ライブラリ全体の保存だけを担う。
 */
export function BackupDialog({ open, onOpenChange, workCount, onExport }: BackupDialogProps) {
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setDone(false)
      setBusy(false)
    }
    onOpenChange(o)
  }

  const handleExport = async () => {
    setBusy(true)
    try {
      await onExport()
      setDone(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary text-xl">
            バックアップの書き出し
          </DialogTitle>
          <DialogDescription>
            すべての作品を 1つの構造化データ（JSON）ファイルにまとめて保存します。
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <p className="flex items-center gap-2 py-4 text-on-surface text-sm">
            <CheckCircle2 className="size-5 text-primary" aria-hidden />
            {workCount}作品をバックアップしました。
          </p>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-on-surface text-sm">
              <span className="font-medium">{workCount}作品</span>をまとめて書き出します。
            </p>
            <p className="flex items-start gap-2 rounded-md bg-surface-container-low p-3 text-on-surface-variant text-xs">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                本文・構成・図鑑などの設定を含みます。執筆履歴（版）は含まれません。取り込みで復元できます。
              </span>
            </p>
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="text-primary"
            >
              閉じる
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
                className="text-primary"
              >
                キャンセル
              </Button>
              <Button
                onClick={() => void handleExport()}
                disabled={busy || workCount === 0}
                className="gap-2"
              >
                <Download className="size-4" />
                書き出す
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

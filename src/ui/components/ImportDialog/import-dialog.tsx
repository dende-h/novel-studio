import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { importBundle } from '@/core/bundle'
import type { Work } from '@/core/schema'
import { readFileText } from '@/ui/_utils/download'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 取り込み実行（検証済みの作品配列を store.importWorks へ渡す）。 */
  onImport: (works: Work[]) => Promise<void>
}

/** 取り込みフローの段階。ファイル選択→確認→完了の3相＋選択相のエラー。 */
type Phase =
  | { kind: 'pick'; error: string | null }
  | { kind: 'confirm'; works: Work[]; fileName: string }
  | { kind: 'done'; count: number }

/**
 * バックアップ（構造化データ JSON）からの復元ダイアログ。
 * 解析・検証は core の importBundle（version＋スキーマ）に委ね、ここは選択→確認→実行の導線だけ。
 * 取り込みは id でのアップサート（同一作品は上書き・既存は保持）なので非破壊。
 */
export function ImportDialog({ open, onOpenChange, onImport }: ImportDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'pick', error: null })
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setPhase({ kind: 'pick', error: null })
    setBusy(false)
  }

  const handleOpenChange = (o: boolean) => {
    if (!o) reset()
    onOpenChange(o)
  }

  const onPickFile = async (file: File) => {
    try {
      const works = importBundle(await readFileText(file))
      setPhase({ kind: 'confirm', works, fileName: file.name })
    } catch {
      setPhase({
        kind: 'pick',
        error:
          'このファイルは取り込めませんでした。novel-studio で書き出した構造化データ（JSON）を選んでください。',
      })
    }
  }

  const handleImport = async () => {
    if (phase.kind !== 'confirm') return
    setBusy(true)
    try {
      await onImport(phase.works)
      setPhase({ kind: 'done', count: phase.works.length })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary text-xl">
            バックアップの取り込み
          </DialogTitle>
          <DialogDescription>
            書き出した構造化データ（JSON）から作品を復元します。
          </DialogDescription>
        </DialogHeader>

        {/* 隠しファイル入力（ボタンから開く）。同じファイルを連続で選んでも change が発火するよう値を毎回リセット。 */}
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="バックアップ JSON ファイル"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void onPickFile(file)
          }}
        />

        {phase.kind === 'pick' && (
          <div className="space-y-4 py-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              className="w-full gap-2 text-primary"
            >
              <Upload className="size-4" />
              JSON ファイルを選択
            </Button>
            {phase.error ? (
              <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-destructive text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{phase.error}</span>
              </p>
            ) : null}
          </div>
        )}

        {phase.kind === 'confirm' && (
          <div className="space-y-3 py-2">
            <p className="text-on-surface text-sm">
              <span className="font-medium">{phase.fileName}</span> から{' '}
              <span className="font-medium">{phase.works.length}作品</span>を取り込みます。
            </p>
            {phase.works.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-outline-variant/30 p-3 text-on-surface-variant text-sm">
                {phase.works.map((w) => (
                  <li key={w.id} className="truncate">
                    {w.title || '無題の作品'}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-on-surface-variant text-sm">取り込める作品がありません。</p>
            )}
            <p className="flex items-start gap-2 rounded-md bg-surface-container-low p-3 text-on-surface-variant text-xs">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                同じ作品（同一ID）は取り込んだ内容で上書きされます。履歴（版）は復元されません。
              </span>
            </p>
          </div>
        )}

        {phase.kind === 'done' && (
          <p className="flex items-center gap-2 py-4 text-on-surface text-sm">
            <CheckCircle2 className="size-5 text-primary" aria-hidden />
            {phase.count}作品を取り込みました。
          </p>
        )}

        <DialogFooter>
          {phase.kind === 'confirm' ? (
            <>
              <Button variant="outline" onClick={reset} disabled={busy} className="text-primary">
                別のファイル
              </Button>
              <Button
                onClick={() => void handleImport()}
                disabled={busy || phase.works.length === 0}
                className="gap-2"
              >
                <Upload className="size-4" />
                取り込む
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="text-primary"
            >
              閉じる
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

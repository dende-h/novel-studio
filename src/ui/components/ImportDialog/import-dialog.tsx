import { AlertTriangle, CheckCircle2, RotateCcw, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { type CloudBackup, deserializeBackup, isBackupJson } from '@/core/backup'
import { importBundle } from '@/core/bundle'
import type { Work } from '@/core/schema'
import { readFileText } from '@/ui/_utils/download'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 作品バンドルの取り込み（id アップサート＝マージ・非破壊）。 */
  onImport: (works: Work[]) => Promise<void>
  /** 全体バックアップからの復元（全置換・破壊的）。未指定なら全体バックアップ形式は受理しない。 */
  onRestoreAll?: (json: string) => Promise<void>
}

/** 取り込みフローの段階。ファイル選択→（マージ確認 or 全置換確認）→完了。 */
type Phase =
  | { kind: 'pick'; error: string | null }
  | { kind: 'confirm'; works: Work[]; fileName: string }
  | { kind: 'restore'; json: string; backup: CloudBackup; fileName: string }
  | { kind: 'done'; count: number }
  | { kind: 'restored' }

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * 取り込み／復元ダイアログ。ファイル形式を自動判別する:
 * - 全体バックアップ（createdAt を持つ）→ 全置換で復元（破壊的・警告つき）
 * - 作品バンドル（version＋works）→ id アップサートでマージ（非破壊・従来どおり）
 */
export function ImportDialog({ open, onOpenChange, onImport, onRestoreAll }: ImportDialogProps) {
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
      const text = await readFileText(file)
      // 全体バックアップ（createdAt あり）は全置換フローへ。それ以外は作品バンドルとしてマージ。
      if (onRestoreAll && isBackupJson(text)) {
        const backup = deserializeBackup(text) // version/スキーマ検証（不正なら throw）
        setPhase({ kind: 'restore', json: text, backup, fileName: file.name })
        return
      }
      const works = importBundle(text)
      setPhase({ kind: 'confirm', works, fileName: file.name })
    } catch {
      setPhase({
        kind: 'pick',
        error:
          'このファイルは取り込めませんでした。コトノハ-leaf- で書き出した構造化データ（JSON）を選んでください。',
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

  const handleRestore = async () => {
    if (phase.kind !== 'restore') return
    setBusy(true)
    try {
      await onRestoreAll?.(phase.json)
      setPhase({ kind: 'restored' })
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
            書き出したデータ（JSON）を取り込みます。全体バックアップは全置換で復元、作品ファイルは追加で取り込みます。
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
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

          {phase.kind === 'restore' && (
            <div className="space-y-3 py-2">
              <p className="text-on-surface text-sm">
                <span className="font-medium">{phase.fileName}</span>（
                {fmtDate(phase.backup.createdAt)}
                時点）から全体を復元します。
              </p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-outline-variant/30 p-3 text-on-surface-variant text-sm">
                <li>作品：{phase.backup.works.length}</li>
                <li>ゴミ箱：{phase.backup.trash.length}</li>
                <li>ネタ帳：{phase.backup.ideas.length}</li>
                <li>執筆記録：{phase.backup.activity.length}日</li>
              </ul>
              <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-destructive text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  現在のすべてのデータ（作品・図鑑・ネタ帳・執筆記録・ゴミ箱・プロフィール）が、このバックアップの内容に置き換わります。この操作は取り消せません。
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

          {phase.kind === 'restored' && (
            <p className="flex items-center gap-2 py-4 text-on-surface text-sm">
              <CheckCircle2 className="size-5 text-primary" aria-hidden />
              全体を復元しました。反映するにはページを再読み込みしてください。
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          {phase.kind === 'confirm' && (
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
          )}
          {phase.kind === 'restore' && (
            <>
              <Button variant="outline" onClick={reset} disabled={busy} className="text-primary">
                別のファイル
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleRestore()}
                disabled={busy}
                className="gap-2"
              >
                <RotateCcw className="size-4" />
                すべて置き換えて復元
              </Button>
            </>
          )}
          {phase.kind === 'restored' && (
            <Button onClick={() => window.location.reload()} className="gap-2">
              <RotateCcw className="size-4" />
              再読み込み
            </Button>
          )}
          {(phase.kind === 'pick' || phase.kind === 'done') && (
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

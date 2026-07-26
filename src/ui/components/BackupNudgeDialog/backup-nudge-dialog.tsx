import type { NudgeBody } from '@/core/nudge/backup-nudge'
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

interface BackupNudgeDialogProps {
  open: boolean
  /** 見出し（例「三万字を越えました！」）。 */
  headline: string
  /** 文面の状態（一度も未実行／前回から◯字書き足し）。 */
  body: NudgeBody
  /** ×・背景クリック・ESC のいずれでも閉じる（＝承認＋クールダウン開始）。強制しない。 */
  onClose: () => void
  /** ［ファイルにバックアップ］：その場で書き出しダイアログを開く（画面遷移しない）。 */
  onFileBackup: () => void
  /** 「クラウドバックアップを利用する場合はこちら」：案内へ。渡されないときリンクを出さない。 */
  onCloud?: () => void
}

/**
 * 執筆量の節目にだけ一度出す、バックアップの静かな声かけ（タスク4）。
 * マイライブラリでのみ表示し、執筆画面には決して出さない（＝執筆の割り込みを避ける）。
 *
 * - 主導線は無料の自衛＝［ファイルにバックアップ］。クラウドは後段のテキストリンク（順番を守る）。
 * - 「クラウドバックアップ」は必ず略さず書く（無料の「ファイルへのバックアップ」との混同を避ける）。
 * - 不安を煽らない：達成をたたえ、状況を淡々と添えるだけ。閉じるのは自由。
 */
export function BackupNudgeDialog({
  open,
  headline,
  body,
  onClose,
  onFileBackup,
  onCloud,
}: BackupNudgeDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">{headline}</DialogTitle>
          <DialogDescription>
            お疲れさまです。原稿を失わないために、バックアップは取っていますか？
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="font-sans text-on-surface-variant text-sm leading-relaxed">
            {body.kind === 'never'
              ? 'この端末では、まだ一度もバックアップを取っていません。'
              : `前回のファイルへの書き出しから、${body.chars.toLocaleString('ja-JP')}字ぶん書き足しています。`}
          </p>
        </DialogBody>
        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col sm:items-stretch">
          <Button
            onClick={() => {
              onClose()
              onFileBackup()
            }}
          >
            ファイルにバックアップ
          </Button>
          {onCloud ? (
            <button
              type="button"
              onClick={() => {
                onClose()
                onCloud()
              }}
              className="text-center font-sans text-on-surface-variant text-xs underline-offset-2 hover:text-primary hover:underline"
            >
              クラウドバックアップを利用する場合はこちら
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

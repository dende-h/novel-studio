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

interface FirstRunDialogProps {
  open: boolean
  /** 「はじめる」・×・ESC・背景クリックのいずれでも閉じる（＝初回フラグを立てる）。強制はしない。 */
  onClose: () => void
}

/**
 * 初回のみ一度だけ出す、保存の仕組みの説明（機能制限の告知でなく「思想の共有」）。
 * ローカルファースト＝原稿は端末内でサーバーに送られない、という事実を淡々と伝える。順番は
 * 「無料で自衛できること（ファイルへの書き出し）→ 有料の選択肢（クラウドバックアップ）」。
 * 事実の記述に留め、「AI に学ばせない」等の包括的な宣言はしない（プランで実態が異なるため）。
 */
export function FirstRunDialog({ open, onClose }: FirstRunDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">原稿は、あなたのものです。</DialogTitle>
          <DialogDescription>保存の仕組みを、はじめに一度だけ。</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 font-sans text-on-surface-variant text-sm leading-relaxed">
          <p>
            コトノハは、書いたものを<strong className="text-on-surface">この端末の保管庫</strong>
            に保存します。サーバーには送られません。だから速く、だから静かです。
          </p>
          <p>
            そのぶん、端末が変わればデータは移りません。書いたものは、いつでも
            <strong className="text-on-surface">ファイルに書き出して</strong>保存できます。
          </p>
          <p>
            端末の故障や紛失に備えたり、複数の端末で書きたいなら、
            <strong className="text-on-surface">自動同期＋クラウドバックアップ</strong>
            （クラウドプラン）という選択肢もあります。
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>はじめる</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

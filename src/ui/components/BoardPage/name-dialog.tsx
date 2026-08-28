import { useEffect, useId, useRef, useState } from 'react'
import { normalizeDisplayName, validateDisplayName } from '@/core/board/name'
import { BOARD_LIMITS } from '@/core/board/types'
import { cn } from '@/lib/utils'
import { type BoardResult, boardErrorMessage } from '@/ui/_api/board'
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
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'

export interface NameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * 入力欄の初期値。呼び出し側が grove の作者ペンネーム → ローカルの `Profile.penName` の順で
   * 詰める（D-BOARD-NAME は「提案するだけ」で、grove の作者登録を投稿の条件にしない）。
   */
  initialName?: string
  /**
   * 表示名を送る（`setDisplayName(name, getToken)` をそのまま渡せる形）。
   * 成功なら閉じる。失敗は `message` を画面に出し、**入力は消さない**。
   */
  onSubmit: (name: string) => Promise<BoardResult<unknown>>
}

/**
 * 表示名を決めるダイアログ（設計 09-board §2・初回投稿の直前に挟む）。
 *
 * この画面が背負っているのは 3 つ。
 *
 * 1. **記名式であること、そして公開範囲を、名前を決めるその場で伝える。** 掲示板は
 *    ログイン必須の記名式（D-BOARD-SIGNED）で、書いたものは**ログインしていない人を含め
 *    誰でも読める**。ここで決めた名前は過去の投稿にも出る。あとから「実名のつもりは
 *    なかった」と気づく経路を作らないために、書き込む前の画面で言い切る。
 *    利用規約・プライバシーポリシー・掲示板ガイドラインと**同じ強さの言い方に揃える**
 *    （画面でだけ弱めると、同意したつもりの範囲が文書とずれる）。
 * 2. **入力のたびに `validateDisplayName` で確かめ、理由ごとに違う文言を出す。**
 *    送信して初めて弾かれると、予約語や長さの当たりを 1 往復ずつ試すことになる。
 * 3. **サーバの重複（409 `duplicate`）も同じ場所に出す。** 名前の衝突は手元では判定できず
 *    （鍵の UNIQUE はサーバにしかない）、ここだけは往復して初めて分かる。
 *
 * 文言は自前で書かず `boardErrorMessage()` から引く。`validateDisplayName` の reason
 * （`empty` / `too_long` / `reserved` / `invalid`）は、サーバが返すエラーコードと同じ名前で
 * 揃えてある＝手元で弾いた場合とサーバに弾かれた場合で、利用者が読む文が変わらない。
 */
export function NameDialog({ open, onOpenChange, initialName = '', onSubmit }: NameDialogProps) {
  const inputId = useId()
  const errorId = useId()

  const [value, setValue] = useState(initialName)
  // 触る前から「表示名を入力してください」と出すと、開いた瞬間に叱られたように見える。
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // 開いた瞬間（閉→開の遷移）だけ初期値へ戻す。表示中は initialName の変化に追従しない
  // （親が /api/authors/me を読み直しても、入力途中の名前を巻き戻さない）。
  const initialRef = useRef(initialName)
  initialRef.current = initialName
  useEffect(() => {
    if (!open) return
    setValue(initialRef.current)
    setTouched(false)
    setSubmitting(false)
    setSendError(null)
  }, [open])

  const checked = validateDisplayName(value)
  // 数えるのは保存される形（正規化後）。入力欄の生文字数を出すと、全角空白や
  // ゼロ幅文字を含む名前で「24文字なのに保存できない」が起きる。
  const count = [...normalizeDisplayName(value)].length
  const localError = !checked.ok && touched ? boardErrorMessage(checked.reason) : null
  // 手元の判定を先に出す（サーバの重複より、いま直せる理由のほうが近い）。
  const error = localError ?? sendError

  const change = (next: string) => {
    setValue(next)
    setTouched(true)
    // 名前を書き換えたら、前の往復で返ってきた「すでに使われています」は用済み。
    setSendError(null)
  }

  const submit = async () => {
    if (submitting) return
    setTouched(true)
    setSendError(null)
    if (!checked.ok) return

    setSubmitting(true)
    // onSubmit は Result を返す約束（`src/ui/_api/board.ts` は例外を投げない）だが、
    // 呼び出し側の配線が投げても入力を巻き上げないように受け止める。
    const result = await onSubmit(checked.name).catch(() => null)
    setSubmitting(false)
    if (result === null) {
      setSendError(boardErrorMessage('network'))
      return
    }
    if (!result.ok) {
      setSendError(result.message)
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">表示名を決める</DialogTitle>
          {/* 公開範囲は、名前を決めるこの場でいちばん強く言う。文言は
              `public/board-guidelines.html` §1 と `public/privacy.html` の掲示板の項に揃える
              （3 か所で言うことが違うと、どれが本当か読み手には確かめようがない）。 */}
          <DialogDescription>
            掲示板に書いたものは、ログインしていない人を含め、誰でも読めます。ここで決めた名前が、書き込みと一緒に表示されます。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={inputId}>表示名</Label>
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    count > BOARD_LIMITS.displayName ? 'text-error' : 'text-on-surface-variant/70',
                  )}
                >
                  {count}/{BOARD_LIMITS.displayName}
                </span>
              </div>
              <Input
                id={inputId}
                value={value}
                onChange={(e) => change(e.target.value)}
                aria-invalid={error !== null}
                aria-describedby={error !== null ? errorId : undefined}
                autoFocus
              />
              {error !== null ? (
                <p id={errorId} role="alert" className="text-error text-sm">
                  {error}
                </p>
              ) : (
                <p className="text-on-surface-variant text-sm">
                  本名など、知られたくないものは使わないでください。あとから変えられます。変えると、これまでの書き込みの名前も新しい名前になります。
                </p>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="text-primary"
              disabled={submitting}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={submitting || !checked.ok}>
              {submitting ? '送信中…' : 'この名前にする'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

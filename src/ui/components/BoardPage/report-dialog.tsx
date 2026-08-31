import { useEffect, useId, useState } from 'react'
import { BOARD_LIMITS, type ReportInput } from '@/core/board/types'
import { cn } from '@/lib/utils'
import type { BoardResult } from '@/ui/_api/board'
import { useToast } from '@/ui/components/Toast/toast'
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
import { Label } from '@/ui/components/ui/label'
import { Textarea } from '@/ui/components/ui/textarea'

/**
 * 通報のダイアログ（設計 09-board D-BOARD-REPORT）。
 *
 * 文言は `public/board-guidelines.html` の「困ったときは」と同じことを、同じ言い方で書く。
 * 掲示板の外に公表した説明と画面の説明がずれると、どちらが本当か利用者に分からなくなる。
 *
 * ここが守るのは 3 つ。
 *
 * 1. **通報者が誰かは出ない、とその場で言う。** 記名式の掲示板（D-BOARD-SIGNED）なので、
 *    黙っていると「自分の名前で相手に伝わる」と思われて、いちばん報せてほしい人が黙る。
 * 2. **「通報すると消える」と誤解させない。** 件数による自動非表示はしない仕組みなので、
 *    運営が読んで決めると正直に書く。ここを曖昧にすると、消えないことが不信になる。
 * 3. **書いた文章を失わせない。** 送信に失敗したときはダイアログを開いたまま理由を出す
 *    （閉じてしまうと、書き直しを強いることになる）。
 *
 * 送信の成否は `onSubmit` が返す `BoardResult` で判断する。`report()` は例外を投げない
 * 契約だが、呼び出し側が包んで throw する余地は残るので catch も持つ。
 */

/**
 * 定型の理由。ガイドライン §3「してはいけないこと」の要点を短くしたもので、
 * **押すと本文へ足す**（選択肢を選ばせて終わりにしない）。通報は「何が起きたか」を
 * 運営が読める形で残すのが目的なので、書き足せる余地を必ず開けておく。
 */
export const REPORT_PRESETS: readonly string[] = [
  '誹謗中傷・攻撃的な書き込み',
  '差別的な表現',
  'わいせつな表現',
  '個人情報が書かれている',
  '無断転載・なりすまし',
  '宣伝の連投',
]

export interface ReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 通報する投稿の id。スレ本文も seq=1 の投稿なので、同じ経路で通報できる（設計 §4） */
  postId: string
  /** 送信。成否だけを返す（件数も他人の通報も画面には出さない） */
  onSubmit: (input: ReportInput) => Promise<BoardResult<null>>
}

export function ReportDialog({ open, onOpenChange, postId, onSubmit }: ReportDialogProps) {
  const toast = useToast()
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 開き直したら前回の下書きを持ち越さない（別の投稿を通報するのに、前の理由が残っていると事故る）。
  useEffect(() => {
    if (open) {
      setReason('')
      setError('')
    }
  }, [open])

  const limit = BOARD_LIMITS.reportReason
  // 字数は UTF-16 の length で数える。サーバの Zod（`trimmed(500)`）と textarea の
  // maxLength が同じ数え方なので、ここだけコードポイントで数えると「画面では収まって
  // いるのに保存で弾かれる」ずれが生まれる。
  const used = reason.length
  const filled = reason.trim() !== ''

  /** 定型の理由を本文へ足す。二度押しで同じ行が並ばない・上限を超える足し方はしない。 */
  const applyPreset = (text: string) => {
    setError('')
    setReason((prev) => {
      const base = prev.trim()
      if (base === '') return text
      if (base.split('\n').includes(text)) return prev
      const next = `${base}\n${text}`
      return next.length > limit ? prev : next
    })
  }

  const submit = async () => {
    const trimmed = reason.trim()
    if (submitting || trimmed === '' || postId === '') return
    setSubmitting(true)
    setError('')
    try {
      const result = await onSubmit({ postId, reason: trimmed })
      if (result.ok) {
        toast.show('通報を受け取りました')
        onOpenChange(false)
        return
      }
      setError(result.message)
    } catch {
      // API クライアントは例外を投げない契約だが、包んだ側が投げる余地は残る。
      // 何が起きても書いた文章は消さず、次の一手だけ伝える。
      setError('送信できませんでした。通信を確かめて、もう一度お試しください')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-serif text-primary">この投稿を通報する</DialogTitle>
            <DialogDescription>
              誰が通報したかは、書いた本人にも、ほかの人にも見えません。
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {/* 「通報したら消える」と思われたまま送られると、消えないこと自体が不信になる。
                仕組みを先に言う（D-BOARD-REPORT）。 */}
            <p className="text-on-surface-variant text-sm leading-6">
              通報の数で自動的に消える仕組みにはしていません。運営が読んで、非表示にするかどうかを
              決めます。
            </p>

            <div className="flex flex-col gap-1.5">
              <span className="text-on-surface-variant text-xs">
                よくある理由（押すと下に入ります）
              </span>
              <div className="flex flex-wrap gap-1.5">
                {REPORT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    disabled={submitting}
                    className={cn(
                      'rounded-full border border-outline-variant/40 px-3 py-1 text-xs',
                      'text-on-surface-variant transition-colors hover:bg-surface-container-low',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      'disabled:opacity-50',
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={reasonId}>どこが気になりましたか</Label>
              <Textarea
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={limit}
                rows={5}
                disabled={submitting}
                placeholder="読んで判断できるように、気になったところを書いてください"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-on-surface-variant text-xs">
                  運営だけが読みます。書いた人には届きません
                </span>
                <span className="shrink-0 text-on-surface-variant text-xs tabular-nums">
                  {used} / {limit}
                </span>
              </div>
            </div>

            {error !== '' && (
              <p role="alert" className="text-error text-sm">
                {error}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="text-primary"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={submitting || !filled}>
              {submitting ? '送信中…' : '通報する'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

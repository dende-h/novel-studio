import { Check } from 'lucide-react'
import { useId, useState } from 'react'
import type { PollResult } from '@/core/board/types'
import { cn } from '@/lib/utils'
import { formatRelative } from '@/ui/_utils/format'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { Card } from '@/ui/components/ui/card'

/**
 * 締切までの残り時間。`formatRelative` は過去向け（「3時間前」）なので、
 * 未来を指す言い回しだけここで作る。
 *
 * 桁は分・時間・日の 3 段。締切は最長でも数週間先を想定していて、
 * それより細かい表示（あと2日3時間）は投票の判断には要らない。
 */
function formatRemaining(closesAt: number, now: number): string {
  const min = Math.floor((closesAt - now) / 60000)
  if (min < 1) return 'まもなく締め切ります'
  if (min < 60) return `あと${min}分で締め切ります`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `あと${hour}時間で締め切ります`
  return `あと${Math.floor(hour / 24)}日で締め切ります`
}

interface PollCardProps {
  /** サーバが組み立てた結果（開示判定済み・`src/core/board/poll.ts` の `pollResultFor`） */
  poll: PollResult
  /** 投票を送る。文言（成功・失敗）は呼び出し側の担当 */
  onVote: (choices: number[]) => Promise<void>
  /** 未ログイン・投稿禁止・ロックなど、投票させない事情があるとき */
  disabled?: boolean
}

/**
 * スレッドに 1 つ付くアンケート（設計 09-board D-BOARD-POLL）。
 *
 * この画面が守るのは 3 つ。
 *
 * 1. **未投票かつ締切前は、票数も割合も一切描かない。** 先に結果が見えると後から
 *    投票する人が引っ張られる。サーバは `counts` / `total` を null で返してくる
 *    （0 埋めにしない＝「0 票」と誤読させない）ので、**null なら数字を組み立てない**。
 *    開示の判断は `poll.revealed` に一本化し、画面で締切や投票済みから再計算しない
 *    （判定が 2 か所に散ると、片方だけ緩んで規則が壊れる）。
 * 2. **割合の分母は `total`（投票した人数）。** 複数選択があるので票数の合計とは一致しない。
 *    分母が何かを注記に書く＝合計が 100% を超えても読み手が混乱しない。
 * 3. **投票の送信は 1 回だけ。** 送信中はボタンを止める（1 アカウント 1 票で、
 *    2 通目はサーバに 409 で弾かれる＝黙って失敗したように見える）。
 *
 * 選択肢は素の `input` で作る。共通部品カタログに radio / checkbox が無く、
 * ここ 1 画面のためだけに Radix の部品を足す理由が無い。
 */
export function PollCard({ poll, onVote, disabled = false }: PollCardProps) {
  // ラジオのグループ名。同じスレに複数のアンケートは無いが、他の input と混ざらないよう分ける。
  const groupName = useId()
  const [selected, setSelected] = useState<number[]>([])
  const [submitting, setSubmitting] = useState(false)

  const now = Date.now()

  // 開示は revealed だけで決める。counts / total が欠けた応答でも数字は組み立てない。
  const revealed = poll.revealed && poll.counts != null && poll.total != null
  const counts = poll.counts
  const total = poll.total
  // 投票欄を出すのは「締切前・未投票・未開示」のときだけ。
  // revealed も条件に入れておくと、結果と投票欄が同時に出る経路が構造的に無くなる。
  const showForm = !poll.closed && !poll.voted && !poll.revealed

  const toggle = (index: number) => {
    setSelected((prev) => {
      if (!poll.multiple) return [index]
      return prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    })
  }

  const submit = async () => {
    if (submitting || selected.length === 0) return
    setSubmitting(true)
    try {
      // 保存の形を 1 つに決めておく（サーバも昇順に正規化する）。
      await onVote([...selected].sort((a, b) => a - b))
    } catch {
      // 失敗の文言は呼び出し側が出す。ここは送信中の表示を戻すだけ。
    } finally {
      setSubmitting(false)
    }
  }

  const deadline = poll.closed
    ? `締め切りました（${formatRelative(poll.closesAt, now)}）`
    : formatRemaining(poll.closesAt, now)

  return (
    <Card className="gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="secondary">アンケート</Badge>
        <span className="text-xs text-on-surface-variant">{deadline}</span>
      </div>

      {showForm ? (
        <fieldset className="min-w-0" disabled={disabled || submitting}>
          <legend className="text-sm font-medium text-on-surface [overflow-wrap:anywhere]">
            {poll.question}
          </legend>
          {/* 未投票のあいだ票数を伏せるのは規則（D-BOARD-POLL）なので、隠していることを先に言う */}
          <p className="mt-1 text-xs text-on-surface-variant">
            {poll.multiple
              ? 'いくつでも選べます。投票すると結果が見られます'
              : 'ひとつ選べます。投票すると結果が見られます'}
          </p>
          <ul className="mt-2 space-y-0.5">
            {/* 選択肢は重複を許さない（poll.ts の validatePollInput）ので、文字列を key にできる */}
            {poll.options.map((option, index) => (
              <li key={option}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm text-on-surface hover:bg-surface-container-low">
                  <input
                    type={poll.multiple ? 'checkbox' : 'radio'}
                    name={poll.multiple ? undefined : groupName}
                    checked={selected.includes(index)}
                    onChange={() => toggle(index)}
                    // fieldset の disabled は input の `disabled` プロパティに映らない
                    // （継承されるのは操作の可否だけ）。各 input にも明示して、
                    // 投票させない状態のときに選択が動く経路を残さない。
                    disabled={disabled || submitting}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="[overflow-wrap:anywhere]">{option}</span>
                </label>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={submit}
            disabled={disabled || submitting || selected.length === 0}
          >
            {submitting ? '投票中…' : '投票する'}
          </Button>
        </fieldset>
      ) : (
        <div className="min-w-0">
          <p className="text-sm font-medium text-on-surface [overflow-wrap:anywhere]">
            {poll.question}
          </p>
          {revealed && counts != null && total != null ? (
            <>
              <ol className="mt-2 space-y-2">
                {poll.options.map((option, index) => {
                  const count = counts[index] ?? 0
                  // 分母は投票した人数。0 人のときに割り算をしない。
                  const percent = total > 0 ? Math.round((count / total) * 100) : 0
                  const mine = poll.myChoices?.includes(index) ?? false
                  return (
                    <li key={option}>
                      <div className="flex items-baseline gap-2 text-sm">
                        <span
                          className={cn(
                            'min-w-0 flex-1 [overflow-wrap:anywhere]',
                            mine ? 'font-medium text-on-surface' : 'text-on-surface-variant',
                          )}
                        >
                          {option}
                        </span>
                        {mine && (
                          <>
                            <Check className="size-4 shrink-0 text-forest-700" aria-hidden="true" />
                            <span className="sr-only">あなたが選びました</span>
                          </>
                        )}
                        <span className="shrink-0 text-xs tabular-nums text-on-surface-variant">
                          {count}票・{percent}%
                        </span>
                      </div>
                      {/* 数字は上の行で読める。バーは同じ内容の飾りなので読み上げから外す。 */}
                      <div
                        className="mt-1 h-2 overflow-hidden rounded-full bg-surface-container"
                        aria-hidden="true"
                      >
                        <div
                          className={cn(
                            'h-full rounded-full',
                            mine ? 'bg-primary' : 'bg-forest-400',
                          )}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ol>
              <p className="mt-2 text-xs text-on-surface-variant">
                {total === 0
                  ? 'まだ投票はありません'
                  : poll.multiple
                    ? `${total}人が投票しました。ひとりがいくつでも選べるため、票数の合計は人数と一致しません`
                    : `${total}人が投票しました。割合はこの人数に対する比率です`}
              </p>
            </>
          ) : (
            // 締切後でも未投票でもないのに票数が来なかった応答。数字を作らず、選択肢だけ出す。
            <ul className="mt-2 space-y-0.5">
              {poll.options.map((option) => (
                <li key={option} className="px-2 py-1.5 text-sm text-on-surface-variant">
                  {option}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

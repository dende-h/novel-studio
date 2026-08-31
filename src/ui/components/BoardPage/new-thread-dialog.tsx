import { Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { PollInputError } from '@/core/board/poll'
import { validatePollInput } from '@/core/board/poll'
import type { BoardKind, BoardRole, CreateThreadInput } from '@/core/board/types'
import { BOARD_LIMITS, boardKindHint } from '@/core/board/types'
import { cn } from '@/lib/utils'
import { type BoardResult, boardErrorMessage } from '@/ui/_api/board'
import { creatableKindOrder, KIND_UI } from '@/ui/board/board-ui'
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
import { Switch } from '@/ui/components/ui/switch'
import { Textarea } from '@/ui/components/ui/textarea'

/**
 * `validatePollInput` の失敗理由 → 画面に出す文。
 * 「何が起きたか（事実）＋ 次にできること（一歩）」の 2 要素で書く。
 *
 * `BOARD_ERROR_MESSAGES`（`src/ui/_api/board.ts`）に置かないのは、あちらがサーバの
 * エラーコードの表で、こちらは**送信前に手元で弾いた理由**だから。サーバまで往復した
 * アンケートの失敗は `bad_poll` に畳まれて返る。
 */
const POLL_ERROR_TEXT: Record<PollInputError, string> = {
  question_empty: '質問を入力してください',
  too_few_options: '選択肢は2つ以上にしてください',
  too_many_options: `選択肢は${BOARD_LIMITS.pollOptionCount}つまでです`,
  option_empty: '空の選択肢があります。入力するか、削除してください',
  duplicate_option: '同じ選択肢が2つあります。どちらかを書き直してください',
  closes_at_required: '締め切りを決めてください',
  closes_at_past: '締め切りは、いまより先の日時にしてください',
}

const DAY = 24 * 60 * 60 * 1000

/**
 * 開いたときに選ばれている種別。
 *
 * 旧「目安箱」（`suggestion`）から要望へ移した。目安箱は要望へ統合済みで、そもそも
 * 選択肢に出ない（`CREATABLE_KINDS`）。staff でも既定は要望のまま——お知らせは
 * 意図して選ぶもので、書き出しの既定にすると運営の雑談まで通知の器に載る。
 */
const DEFAULT_KIND: BoardKind = 'request'

/**
 * 文字数。**サーバと同じ数え方（`.length` ＝ UTF-16 の符号単位）で数える。**
 *
 * 上限を実際に判定するのは `CreateThreadInputSchema` の `z.string().max()` で、Zod は
 * `String.prototype.length` を見る＝絵文字 1 つを 2 と数える（`'😀😀'` は `max(2)` で落ちる）。
 * ここをコードポイントで数えると、カウンタが上限ちょうどに見えている本文が
 * サーバに `bad_request` で弾かれ、**書いた人には理由の分からない失敗**になる。
 * 数え方を緩いほうへずらさず、弾かれる側に揃える。
 *
 * 入力欄の `maxLength` も同じ単位（HTML の `maxlength` は符号単位）なので、
 * 「打てる長さ」「カウンタ」「サーバの判定」の 3 つが一致する。
 */
const charCount = (text: string): number => text.length

/** `<input type="datetime-local">` が読む形（ローカル時刻の `YYYY-MM-DDTHH:mm`）。 */
function toLocalInputValue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 入力欄の値 → epoch ms。空・壊れた値は NaN（`validatePollInput` が `closes_at_required` にする）。 */
function fromLocalInputValue(text: string): number {
  if (text.trim() === '') return Number.NaN
  return new Date(text).getTime()
}

/** アンケートの選択肢 1 行。並べ替え・削除で行が壊れないよう、値ではなく id で持つ。 */
type OptionRow = { id: string; text: string }

export interface NewThreadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * スレを立てる（`createThread(input, getToken)` をそのまま渡せる形）。
   * 成功なら閉じる。失敗は `message` を出し、**入力はそのまま残す**。
   */
  onSubmit: (input: CreateThreadInput) => Promise<BoardResult<unknown>>
  /**
   * 掲示板での立場。**任意**（省略＝`member`）。
   *
   * 立場で変わるのは「お知らせ」を選べるかだけで、渡さない呼び出し側は
   * これまでどおり member の選択肢を出す＝渡し忘れが**多い側へ倒れない**。
   * 判定そのものは `creatableKindOrder`（→ `core/board/permission`）が持つ。
   */
  role?: BoardRole
}

/**
 * スレッドを立てるダイアログ（設計 09-board §2 / §5 `POST /api/board/threads`）。
 *
 * この画面が守るのは 5 つ。
 *
 * 1. **種別を選ぶと何が変わるかを、選ぶその場に出す。** 文は `boardKindHint`（契約側）から引く。
 *    要望・不具合だけ 👍 と運営ステータスが付く（D-BOARD-KIND）。掲示板の心臓は
 *    「言えば直る」が見えることなので、その器に載るかどうかは立てる前に分かっていないといけない。
 * 2. **選べない種別は最初から出さない。** 廃止した「目安箱」（`suggestion`・要望へ統合）と、
 *    member にとっての「お知らせ」（運営だけが立てられる）は選択肢そのものを出さない。
 *    押させてから 403 で断るのは、断り方として高くつく。
 * 3. **アンケートは任意。** 開くまで欄を出さない（毎回アンケートの入力欄が並ぶと、
 *    ひとことの要望を書く人の前に無関係な 5 つの欄が立ちはだかる）。
 * 4. **送信前に `validatePollInput` を通す。** 選択肢が 2 未満・空・重複のまま送ると
 *    サーバに `bad_poll` で弾かれる＝往復してから「アンケートを保存できませんでした」しか
 *    返らない。手元で弾けば、どの欄をどう直すかまで言える。
 * 5. **失敗しても入力を消さない。** 上限いっぱいまで書いた本文が通信の失敗で消えるのが、
 *    この画面でいちばん高くつく事故。送信中は二重送信を止め、返ってきた失敗はダイアログの中に出す。
 *
 * 検証の結果を出すのは**一度送信を試みてから**。開いた直後から空欄を赤くしても、
 * これから書く人には何の情報にもならない。
 */
export function NewThreadDialog({
  open,
  onOpenChange,
  onSubmit,
  role = 'member',
}: NewThreadDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  const questionId = useId()
  const closesId = useId()
  const pollToggleId = useId()
  const multipleId = useId()

  // 選択肢の行 id。React の key に index を使うと、途中の行を消したときに
  // 入力中の文字が 1 行ずれる（DOM が使い回される）。
  const optionSeq = useRef(0)
  const nextOptionId = () => {
    optionSeq.current += 1
    return `opt-${optionSeq.current}`
  }

  // 立場で変わるのは「お知らせ」を出すかだけ。判定は board-ui（→ permission）に任せる。
  const kinds = creatableKindOrder(role)

  const [kind, setKind] = useState<BoardKind>(DEFAULT_KIND)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pollOn, setPollOn] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<OptionRow[]>([])
  const [multiple, setMultiple] = useState(false)
  const [closesAt, setClosesAt] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // 開いた瞬間（閉→開の遷移）だけ空に戻す。表示中は触らない。
  useEffect(() => {
    if (!open) return
    setKind(DEFAULT_KIND)
    setTitle('')
    setBody('')
    setPollOn(false)
    setQuestion('')
    setOptions([])
    setMultiple(false)
    setClosesAt('')
    setAttempted(false)
    setSubmitting(false)
    setSendError(null)
  }, [open])

  const titleText = title.trim()
  const bodyText = body.trim()
  const titleCount = charCount(titleText)
  const bodyCount = charCount(bodyText)

  const titleError =
    titleText === ''
      ? 'タイトルを入力してください'
      : titleCount > BOARD_LIMITS.title
        ? `タイトルは${BOARD_LIMITS.title}文字までです`
        : null
  const bodyError =
    bodyText === ''
      ? '本文を入力してください'
      : bodyCount > BOARD_LIMITS.body
        ? `本文は${BOARD_LIMITS.body}文字までです`
        : null

  // アンケートを添えないときは検証も走らせない（閉じた欄の中身で送信を止めない）。
  const pollInput = pollOn
    ? {
        question: question.trim(),
        options: options.map((o) => o.text.trim()),
        multiple,
        closesAt: fromLocalInputValue(closesAt),
      }
    : null
  const pollCheck = pollInput ? validatePollInput(pollInput, Date.now()) : null
  const pollError = pollCheck && !pollCheck.ok ? POLL_ERROR_TEXT[pollCheck.reason] : null

  const showError = (message: string | null) => (attempted ? message : null)

  const togglePoll = (on: boolean) => {
    setPollOn(on)
    if (!on) return
    // 既定値は開いたときに 1 度だけ入れる。閉じて開き直しても書いたものは残す
    // （うっかり閉じた人に、質問と選択肢をもう一度打たせない）。
    setOptions((prev) =>
      prev.length > 0
        ? prev
        : [
            { id: nextOptionId(), text: '' },
            { id: nextOptionId(), text: '' },
          ],
    )
    setClosesAt((prev) => (prev !== '' ? prev : toLocalInputValue(Date.now() + 7 * DAY)))
  }

  const setOptionText = (id: string, text: string) => {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, text } : o)))
  }

  const addOption = () => {
    setOptions((prev) =>
      prev.length >= BOARD_LIMITS.pollOptionCount
        ? prev
        : [...prev, { id: nextOptionId(), text: '' }],
    )
  }

  const removeOption = (id: string) => {
    setOptions((prev) => prev.filter((o) => o.id !== id))
  }

  const submit = async () => {
    if (submitting) return
    setAttempted(true)
    setSendError(null)
    // ここで止めた理由は、各欄の下にもう出ている（attempted が立つため）。
    if (titleError !== null || bodyError !== null || pollError !== null) return

    const input: CreateThreadInput = {
      kind,
      title: titleText,
      body: bodyText,
      ...(pollInput
        ? {
            poll: {
              question: pollInput.question,
              options: pollInput.options,
              multiple: pollInput.multiple,
              closesAt: pollInput.closesAt,
            },
          }
        : {}),
    }

    setSubmitting(true)
    // `src/ui/_api/board.ts` は例外を投げない約束だが、呼び出し側の配線が投げても
    // 書いたものを巻き上げないように受け止める。
    const result = await onSubmit(input).catch(() => null)
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">スレッドを立てる</DialogTitle>
          <DialogDescription>掲示板では、あなたの表示名で公開されます。</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          // ブラウザ標準の検証を切る。`maxLength` を付けた欄は、値が上限を超えていると
          // 標準の検証が **submit イベントごと握りつぶす**（IME の確定などで上限超えの値が
          // 入り込むと、押しても何も起きない画面になる）。理由の文言はこの画面が
          // 自分の言葉で出すので、標準の吹き出しに割り込ませない。
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            {/* --- 種別 --- */}
            <fieldset className="min-w-0 space-y-2">
              <legend className="font-medium text-on-surface text-sm">種別</legend>
              <div className="flex flex-wrap items-center gap-1.5">
                {kinds.map((k) => {
                  const active = kind === k
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setKind(k)}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs transition-colors',
                        active
                          ? KIND_UI[k].className
                          : 'border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-low',
                      )}
                    >
                      {KIND_UI[k].label}
                    </button>
                  )
                })}
              </div>
              {/* 一言の説明は契約側（`boardKindHint`）が正本。画面ごとに言い回しを作らない */}
              <p className="text-on-surface-variant text-xs">{boardKindHint[kind]}</p>
            </fieldset>

            {/* --- タイトル --- */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={titleId}>タイトル</Label>
                <FieldCount count={titleCount} max={BOARD_LIMITS.title} />
              </div>
              {/* そもそも上限を超えて打てないようにする。数える単位は charCount と同じ
                  （前後の空白は送信時に落ちるので、trim 後がここより長くなることはない）。 */}
              <Input
                id={titleId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={BOARD_LIMITS.title}
                aria-invalid={showError(titleError) !== null}
              />
              <FieldError message={showError(titleError)} />
            </div>

            {/* --- 本文 --- */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={bodyId}>本文</Label>
                <FieldCount count={bodyCount} max={BOARD_LIMITS.body} />
              </div>
              <Textarea
                id={bodyId}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                maxLength={BOARD_LIMITS.body}
                aria-invalid={showError(bodyError) !== null}
              />
              <FieldError message={showError(bodyError)} />
            </div>

            {/* --- アンケート（任意） --- */}
            <div className="space-y-3 rounded-lg border border-outline-variant/50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={pollToggleId} className="font-medium text-sm">
                  アンケートを添える
                </Label>
                <Switch id={pollToggleId} checked={pollOn} onCheckedChange={togglePoll} />
              </div>
              {!pollOn && (
                <p className="text-on-surface-variant text-xs">
                  選択肢から選んでもらえます。投票した人だけが結果を見られます。
                </p>
              )}

              {pollOn && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label htmlFor={questionId}>質問</Label>
                      <FieldCount
                        count={charCount(question.trim())}
                        max={BOARD_LIMITS.pollQuestion}
                      />
                    </div>
                    <Input
                      id={questionId}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      maxLength={BOARD_LIMITS.pollQuestion}
                    />
                  </div>

                  <fieldset className="min-w-0 space-y-2">
                    <legend className="font-medium text-on-surface text-sm">
                      選択肢（2〜{BOARD_LIMITS.pollOptionCount}）
                    </legend>
                    <ul className="space-y-2">
                      {options.map((option, index) => (
                        <li key={option.id} className="flex items-center gap-2">
                          {/* 選択肢には文字数カウンタが無い＝超えたことに気づける場所が
                              `maxLength` しかない。手元の `validatePollInput` も長さは見ないので、
                              ここで止めないとサーバの `bad_poll` まで往復する。 */}
                          <Input
                            value={option.text}
                            onChange={(e) => setOptionText(option.id, e.target.value)}
                            maxLength={BOARD_LIMITS.pollOption}
                            aria-label={`選択肢 ${index + 1}`}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`選択肢 ${index + 1} を削除`}
                            onClick={() => removeOption(option.id)}
                            className="shrink-0 text-on-surface-variant"
                          >
                            <X className="size-4" aria-hidden="true" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addOption}
                      disabled={options.length >= BOARD_LIMITS.pollOptionCount}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      選択肢を追加
                    </Button>
                  </fieldset>

                  <div className="space-y-2">
                    <Label htmlFor={closesId}>締め切り</Label>
                    <Input
                      id={closesId}
                      type="datetime-local"
                      value={closesAt}
                      onChange={(e) => setClosesAt(e.target.value)}
                      className="sm:max-w-64"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={multipleId} className="text-sm">
                      いくつでも選べるようにする
                    </Label>
                    <Switch id={multipleId} checked={multiple} onCheckedChange={setMultiple} />
                  </div>

                  <FieldError message={showError(pollError)} />
                </div>
              )}
            </div>

            {/* 送信して返ってきた失敗。入力はそのまま残っている */}
            {sendError !== null && (
              <p role="alert" className="text-error text-sm">
                {sendError}
              </p>
            )}
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
            {/* 検証で止まる場合も押せるようにする＝押して初めて「どこが足りないか」が出る */}
            <Button type="submit" disabled={submitting}>
              {submitting ? '送信中…' : '立てる'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 文字数カウンタ。上限を超えたら色で知らせる（送信は押してから理由を出す）。 */
function FieldCount({ count, max }: { count: number; max: number }) {
  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        count > max ? 'text-error' : 'text-on-surface-variant/70',
      )}
    >
      {count}/{max}
    </span>
  )
}

/** 欄ごとの検証の結果。null のときは高さも取らない。 */
function FieldError({ message }: { message: string | null }) {
  if (message === null) return null
  return (
    <p role="alert" className="text-error text-sm">
      {message}
    </p>
  )
}

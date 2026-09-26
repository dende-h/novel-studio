import { MessageSquareText } from 'lucide-react'
import { useMemo } from 'react'
import {
  type AnyDialogQuestion,
  activeDeepQuestionsFor,
  answerOutOfChoices,
  answerPublic,
  type DialogQuestion,
  type DialogSummary,
  digQuestionsOf,
  hasDialogQuestions,
  isDigQuestion,
  isFixedVisibility,
  questionByKey,
} from '@/core/glossary/dialog'
import type { DialogAnswer, GlossaryEntry } from '@/core/schema'
import { cn } from '@/lib/utils'
import { VisibilityLabel } from '@/ui/components/GlossaryView/visibility-label'
import { CommitTextarea } from '@/ui/components/NotationField/commit-textarea'
import { NotationText } from '@/ui/components/NotationField/notation-text'
import { Button } from '@/ui/components/ui/button'

/**
 * フォーム側の「対話ノート」区画（11-glossary-dialog.md §4）。対話の答えの一覧で、ここでも直せる
 * （欄を離れると確定・公開の扱いは印を押して切り替え）。対話タブでは同じ答えを一問ずつ聞かれる。
 * 未着手なら案内と「対話で深める」、途中なら「対話をつづける」、済みなら「対話で直す」。
 */
export function DialogNoteSection({
  entry,
  askBase = false,
  summary,
  onOpenDialog,
  onAnswer,
  onToggleVisibility,
  resolvedNames,
  onRefClick,
  glossary,
  onCreateEntry,
}: {
  entry: GlossaryEntry
  /** 共通 4 問も対話で聞く項目（新しく作った直後）。 */
  askBase?: boolean
  /** 対話の状態と進み具合（親が計算したもの）。 */
  summary: DialogSummary
  onOpenDialog: () => void
  /** 答えを書き換える（空文字＝答えを消す）。 */
  onAnswer: (question: AnyDialogQuestion, text: string) => void
  /** 「読者に見せる／作者だけ」を切り替える。 */
  onToggleVisibility: (key: string) => void
  resolvedNames: Set<string>
  onRefClick?: (name: string) => void
  /** 用語集（@／[[ の候補）。 */
  glossary: GlossaryEntry[]
  onCreateEntry?: (name: string) => Promise<string | null>
}) {
  const { status, progress } = summary
  const questions = useMemo(() => activeDeepQuestionsFor(entry), [entry])
  // 今の問いの列に無い答え（種類を変えて枝から外れた・質問セットから消えた鍵）。データは残るので、
  // 表示場所も残す（CLAUDE.md「欄の出力先を無くさない」）。
  const inactive = useMemo(() => {
    const active = new Set(
      questions.flatMap((q) => [q.key, ...digQuestionsOf(q).map((d) => d.key)]),
    )
    return Object.entries(entry.dialog ?? {})
      .filter(([key, a]) => !active.has(key) && a.text.trim() !== '')
      .map(([key, a]) => ({
        key,
        label: questionByKey(entry.category, key)?.label ?? key,
        text: a.text,
      }))
  }, [entry, questions])
  return (
    <section className="space-y-1.5" aria-label="対話ノート">
      <div className="flex items-center gap-2">
        <h2 className="font-medium text-[13px] text-on-surface">対話ノート</h2>
        <VisibilityLabel
          isPublic={false}
          label="「読者に見せる」にした答えも、まだ投稿には載りません"
        />
      </div>
      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3.5 py-3">
        {!hasDialogQuestions(entry.category) ? (
          <>
            <p className="rounded-md bg-accent px-3 py-2.5 text-[12.5px] text-on-surface leading-relaxed">
              カテゴリを選ぶと、そのカテゴリの質問が並びます。対話タブからも選べます。
            </p>
            <InactiveAnswers
              rows={inactive}
              lead="残っている答え（カテゴリを選ぶと問いに結びつきます）"
              resolvedNames={resolvedNames}
              onRefClick={onRefClick}
            />
          </>
        ) : status === 'none' ? (
          <div className="rounded-md bg-accent px-3 py-2.5 text-[12.5px] text-on-surface leading-relaxed">
            この{entry.category}の深掘りは、まだ答えていません。基本の質問は {progress.total}{' '}
            問（ほかに任意の問いが {questions.length - progress.total}{' '}
            問）、ひとつずつ答えられます。
            {askBase
              ? '名前・読み・別名・公開情報も、対話の最初に聞きます。'
              : '名前・読み・別名・公開情報はもう入っているので、そこは聞きません。'}
            <div className="mt-2">
              <OpenButton primary onClick={onOpenDialog}>
                対話で深める
              </OpenButton>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2.5">
              <span className="font-medium text-[13px] text-on-surface">
                対話 {progress.done}/{progress.total}
              </span>
              {progress.later > 0 ? (
                <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[10.5px] text-on-secondary-container">
                  あとで {progress.later}
                </span>
              ) : null}
              <div className="ml-auto">
                <OpenButton primary={status === 'inProgress'} onClick={onOpenDialog}>
                  {status === 'inProgress' ? '対話をつづける' : '対話で直す'}
                </OpenButton>
              </div>
            </div>
            <dl className="m-0 grid grid-cols-[8em_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1.5 text-[13px]">
              {questions.map((q) => (
                <NoteRow
                  key={q.key}
                  question={q}
                  entry={entry}
                  onAnswer={onAnswer}
                  onToggleVisibility={onToggleVisibility}
                  glossary={glossary}
                  onCreateEntry={onCreateEntry}
                />
              ))}
            </dl>
            <InactiveAnswers
              rows={inactive}
              lead="今の種類では聞かない答え（残してあります。種類を戻すと元の場所に出ます）"
              resolvedNames={resolvedNames}
              onRefClick={onRefClick}
            />
          </>
        )}
      </div>
      <p className="text-[11px] text-on-surface-variant/60 leading-relaxed">
        対話の答えです。ここでも直せます（欄を離れると保存・印を押すと公開の扱いが切り替わります）。対話タブでは同じ答えを一問ずつ聞かれます。名前・読み・別名・公開情報は上の欄がそのまま最初の
        4 問の答えです。
      </p>
    </section>
  )
}

/** 1 問ぶんの行（見出し・答えの欄・公開の印）。答え済みは見出しを濃く、未回答は薄く。 */
function NoteRow({
  question: q,
  entry,
  onAnswer,
  onToggleVisibility,
  glossary,
  onCreateEntry,
}: {
  question: DialogQuestion
  entry: GlossaryEntry
  onAnswer: (question: AnyDialogQuestion, text: string) => void
  onToggleVisibility: (key: string) => void
  glossary: GlossaryEntry[]
  onCreateEntry?: (name: string) => Promise<string | null>
}) {
  const a = entry.dialog?.[q.key]
  // 分類を変えて持ち越した「種類」（今の選択肢に無い）は未回答扱い（ボットが聞き直す）。
  const text = a && !answerOutOfChoices(q, a) ? a.text.trim() : ''
  const digs = digQuestionsOf(q).filter(
    (d) => (entry.dialog?.[d.key]?.text.trim() ?? '') !== '' || text !== '',
  )
  return (
    <>
      <NoteLine
        question={q}
        answer={a}
        text={text}
        onAnswer={onAnswer}
        onToggleVisibility={onToggleVisibility}
        glossary={glossary}
        onCreateEntry={onCreateEntry}
      />
      {digs.map((d) => (
        <NoteLine
          key={d.key}
          question={d}
          answer={entry.dialog?.[d.key]}
          text={entry.dialog?.[d.key]?.text.trim() ?? ''}
          onAnswer={onAnswer}
          onToggleVisibility={onToggleVisibility}
          glossary={glossary}
          onCreateEntry={onCreateEntry}
        />
      ))}
    </>
  )
}

function NoteLine({
  question: q,
  answer: a,
  text,
  onAnswer,
  onToggleVisibility,
  glossary,
  onCreateEntry,
}: {
  question: AnyDialogQuestion
  answer: DialogAnswer | undefined
  text: string
  onAnswer: (question: AnyDialogQuestion, text: string) => void
  onToggleVisibility: (key: string) => void
  glossary: GlossaryEntry[]
  onCreateEntry?: (name: string) => Promise<string | null>
}) {
  const answered = text !== ''
  const dig = isDigQuestion(q)
  const choicesOnly = !!q.choices && !q.free
  const label = `${dig ? '↳ ' : ''}${q.label}`
  return (
    <>
      <dt
        className={cn(
          'pt-1.5 leading-snug',
          dig && 'pl-4',
          answered ? 'font-medium text-on-surface' : 'text-on-surface-variant/55',
        )}
      >
        {label}
        {!dig && q.optional ? (
          <span className="ml-1 font-normal text-[10px] text-on-surface-variant/60">任意</span>
        ) : null}
      </dt>
      <dd className="m-0 min-w-0">
        {choicesOnly ? (
          <select
            aria-label={label}
            value={text}
            onChange={(e) => onAnswer(q, e.target.value)}
            className={cn(
              'h-8 w-full rounded-md border border-outline-variant/30 bg-surface px-2 text-[13px] outline-none focus:border-primary/50',
              answered ? 'text-on-surface' : 'text-on-surface-variant/60',
            )}
          >
            <option value="">未回答</option>
            {q.choices?.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <CommitTextarea
            ariaLabel={label}
            value={text}
            onCommit={(v) => onAnswer(q, v)}
            placeholder={a?.skipped || a?.later ? 'スキップした問い' : '未回答'}
            glossary={glossary}
            onCreateEntry={onCreateEntry}
            className={cn('min-h-8 py-1', !answered && 'border-dashed')}
          />
        )}
      </dd>
      <dd className="m-0 pt-1.5">
        {answered && a ? (
          isFixedVisibility(q) ? (
            <VisibilityLabel
              isPublic={answerPublic(q, a)}
              label={q.vis === 'public-fixed' ? '読者に見える欄' : '作者だけ（固定）'}
            />
          ) : (
            <button
              type="button"
              onClick={() => onToggleVisibility(q.key)}
              aria-pressed={answerPublic(q, a)}
              aria-label={
                answerPublic(q, a)
                  ? `${q.label}：読者に見せる（押すと作者だけに戻す）`
                  : `${q.label}：作者だけ（押すと読者に見せる）`
              }
              className="rounded-full transition-opacity hover:opacity-80"
            >
              <VisibilityLabel
                isPublic={answerPublic(q, a)}
                className="border border-outline-variant/40"
              />
            </button>
          )
        ) : null}
      </dd>
    </>
  )
}

/** 今の問いの列に無い答えの一覧（データの表示場所を無くさない）。無ければ何も出さない。 */
function InactiveAnswers({
  rows,
  lead,
  resolvedNames,
  onRefClick,
}: {
  rows: { key: string; label: string; text: string }[]
  lead: string
  resolvedNames: Set<string>
  onRefClick?: (name: string) => void
}) {
  if (rows.length === 0) return null
  return (
    <div className="mt-3 border-outline-variant/30 border-t pt-2">
      <p className="mb-1 text-[11px] text-on-surface-variant/70">{lead}</p>
      <dl className="m-0 grid grid-cols-[8em_1fr] items-start gap-x-2.5 gap-y-1 text-[12.5px]">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-on-surface-variant/60">{row.label}</dt>
            <NotationText
              text={row.text}
              resolvedNames={resolvedNames}
              onRefClick={onRefClick}
              className="m-0 whitespace-pre-wrap text-on-surface-variant"
            />
          </div>
        ))}
      </dl>
    </div>
  )
}

/** 対話タブを開くボタン（主の操作なら塗り）。 */
function OpenButton({
  primary,
  onClick,
  children,
}: {
  primary?: boolean
  onClick: () => void
  children: string
}) {
  return (
    <Button type="button" size="sm" variant={primary ? 'default' : 'outline'} onClick={onClick}>
      <MessageSquareText className="size-3.5" aria-hidden />
      {children}
    </Button>
  )
}

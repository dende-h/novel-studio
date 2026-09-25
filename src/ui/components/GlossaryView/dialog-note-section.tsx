import { MessageSquareText } from 'lucide-react'
import { useMemo } from 'react'
import {
  activeDeepQuestionsFor,
  answerOutOfChoices,
  answerPublic,
  type DialogQuestion,
  type DialogSummary,
  digQuestionsOf,
  hasDialogQuestions,
  questionByKey,
} from '@/core/glossary/dialog'
import type { GlossaryEntry } from '@/core/schema'
import { VisibilityLabel } from '@/ui/components/GlossaryView/visibility-label'
import { NotationText } from '@/ui/components/NotationField/notation-text'
import { Button } from '@/ui/components/ui/button'

/**
 * フォーム側の「対話ノート」区画（11-glossary-dialog.md §4）。対話の答えを**見るだけ**の場所で、
 * 直すのは対話タブから（書く場所を二つにしない）。未着手なら案内、途中なら答えの一覧と
 * 「対話をつづける」、済みなら「対話で直す」。
 */
export function DialogNoteSection({
  entry,
  summary,
  onOpenDialog,
  resolvedNames,
  onRefClick,
}: {
  entry: GlossaryEntry
  /** 対話の状態と進み具合（親が計算したもの）。 */
  summary: DialogSummary
  onOpenDialog: () => void
  resolvedNames: Set<string>
  onRefClick?: (name: string) => void
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
            問）、ひとつずつ答えられます。名前・読み・別名・公開情報はもう入っているので、そこは聞きません。
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
            <dl className="m-0 grid grid-cols-[8em_1fr_auto] items-start gap-x-2.5 gap-y-1.5 text-[13px]">
              {questions.map((q) => (
                <NoteRow
                  key={q.key}
                  question={q}
                  entry={entry}
                  resolvedNames={resolvedNames}
                  onRefClick={onRefClick}
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
        対話の答えです。ここは見るだけで、直すときは「対話で直す」から一問ずつ。既存の項目は、名前・読み・別名・公開情報がそのまま最初の
        4 問の答えになります。
      </p>
    </section>
  )
}

function NoteRow({
  question: q,
  entry,
  resolvedNames,
  onRefClick,
}: {
  question: DialogQuestion
  entry: GlossaryEntry
  resolvedNames: Set<string>
  onRefClick?: (name: string) => void
}) {
  const a = entry.dialog?.[q.key]
  // 分類を変えて持ち越した「種類」（今の選択肢に無い）は未回答扱い（ボットが聞き直す）。
  const text = a && !answerOutOfChoices(q, a) ? a.text.trim() : ''
  const digs = digQuestionsOf(q).filter((d) => (entry.dialog?.[d.key]?.text.trim() ?? '') !== '')
  return (
    <>
      <dt className="text-on-surface-variant/70">
        {q.label}
        {q.optional ? <span className="ml-1 text-[10px]">任意</span> : null}
      </dt>
      {text ? (
        <NotationText
          text={text}
          resolvedNames={resolvedNames}
          onRefClick={onRefClick}
          className="m-0 whitespace-pre-wrap text-on-surface"
        />
      ) : (
        <dd className="m-0 text-on-surface-variant/50">
          {a?.later ? 'あとで答える' : a?.skipped ? 'スキップ' : '未回答'}
        </dd>
      )}
      <dd className="m-0">
        {text && a ? <VisibilityLabel isPublic={answerPublic(q, a)} /> : null}
      </dd>
      {digs.map((d) => (
        <div key={d.key} className="contents">
          <dt className="pl-4 text-on-surface-variant/70">↳ {d.label}</dt>
          <NotationText
            text={entry.dialog?.[d.key]?.text ?? ''}
            resolvedNames={resolvedNames}
            onRefClick={onRefClick}
            className="m-0 whitespace-pre-wrap text-on-surface"
          />
          <dd className="m-0" />
        </div>
      ))}
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

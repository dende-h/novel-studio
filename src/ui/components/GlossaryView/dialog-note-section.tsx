import { BookOpen, Lock, MessageSquareText } from 'lucide-react'
import {
  activeDeepQuestionsFor,
  answerPublic,
  type DialogQuestion,
  dialogProgress,
  dialogStatusOf,
  digQuestionsOf,
  hasDialogQuestions,
} from '@/core/glossary/dialog'
import type { GlossaryEntry } from '@/core/schema'
import { cn } from '@/lib/utils'
import { NotationText } from '@/ui/components/NotationField/notation-text'

/**
 * フォーム側の「対話ノート」区画（11-glossary-dialog.md §4）。対話の答えを**見るだけ**の場所で、
 * 直すのは対話タブから（書く場所を二つにしない）。未着手なら案内、途中なら答えの一覧と
 * 「対話をつづける」、済みなら「対話で直す」。
 */
export function DialogNoteSection({
  entry,
  onOpenDialog,
  resolvedNames,
  onRefClick,
}: {
  entry: GlossaryEntry
  onOpenDialog: () => void
  resolvedNames: Set<string>
  onRefClick?: (name: string) => void
}) {
  const status = dialogStatusOf(entry)
  const progress = dialogProgress(entry)
  const questions = activeDeepQuestionsFor(entry)
  return (
    <section className="space-y-1.5" aria-label="対話ノート">
      <div className="flex items-center gap-2">
        <h2 className="font-medium text-[13px] text-on-surface">対話ノート</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 font-medium text-[10.5px] text-on-secondary-container">
          <Lock className="size-2.5" aria-hidden />
          「読者に見せる」にした答えも、まだ投稿には載りません
        </span>
      </div>
      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3.5 py-3">
        {!hasDialogQuestions(entry.category) ? (
          <p className="rounded-md bg-accent px-3 py-2.5 text-[12.5px] text-on-surface leading-relaxed">
            カテゴリを選ぶと、そのカテゴリの質問が並びます。対話タブからも選べます。
          </p>
        ) : status === 'none' ? (
          <div className="rounded-md bg-accent px-3 py-2.5 text-[12.5px] text-on-surface leading-relaxed">
            この{entry.category}の深掘りは、まだ答えていません。対話は {questions.length}{' '}
            問、ひとつずつ答えられます。名前・読み・別名・公開情報はもう入っているので、そこは聞きません。
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
  const text = a?.text.trim() ?? ''
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
      <dd className="m-0">{text && a ? <VisibilityMark isPublic={answerPublic(q, a)} /> : null}</dd>
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

function VisibilityMark({ isPublic }: { isPublic: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px]',
        isPublic
          ? 'bg-primary-container text-on-primary-container'
          : 'bg-secondary-container text-on-secondary-container',
      )}
    >
      {isPublic ? (
        <BookOpen className="size-2.5" aria-hidden />
      ) : (
        <Lock className="size-2.5" aria-hidden />
      )}
      {isPublic ? '読者に見せる' : '作者だけ'}
    </span>
  )
}

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
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] transition-colors',
        primary
          ? 'border-primary bg-primary text-white hover:bg-primary/90'
          : 'border-primary/60 bg-surface-container-lowest text-primary hover:bg-accent',
      )}
    >
      <MessageSquareText className="size-3.5" aria-hidden />
      {children}
    </button>
  )
}

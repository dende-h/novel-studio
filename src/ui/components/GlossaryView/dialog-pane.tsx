import { useEffect, useMemo, useRef, useState } from 'react'
import { publicTextOf, withPublicText } from '@/core/glossary'
import {
  type AnyDialogQuestion,
  activeDeepQuestionsFor,
  answerPublic,
  answersOf,
  digQuestionsOf,
  draftSummaryFromDialog,
  isDigQuestion,
  isFixedVisibility,
  questionByKey,
  toggleAnswerPublic,
} from '@/core/glossary/dialog'
import {
  beginSession,
  type ChipAction,
  type DialogMessage,
  type DialogSession,
  pendingHint,
  pendingQuestion,
  pickQuestion,
  rejectAnswer,
  runChip,
  type SessionStep,
  skipQuestion,
  submitAnswer,
  visibilityHint,
} from '@/core/glossary/dialogSession'
import type { DialogAnswer, GlossaryEntry } from '@/core/schema'
import { cn } from '@/lib/utils'
import { VisibilityLabel } from '@/ui/components/GlossaryView/visibility-label'
import {
  CommitTextarea,
  type CommitTextareaHandle,
} from '@/ui/components/NotationField/commit-textarea'
import { NotationText } from '@/ui/components/NotationField/notation-text'

/**
 * 用語集の「対話」ペイン（11-glossary-dialog.md §4）。台本は core/glossary/dialogSession が持ち、
 * ここは会話ログを描いて、答えを保存する（既存の項目は onChange → store、新規の下書きは親の state）。
 *
 * 答えるたびに手元の entry を進め（`local`）、保存の完了を待たずに次の問いへ進む。prop の entry は
 * 保存が終わってから追いつくので、保存中は prop を採らない（先に答えた分を巻き戻さない）。
 */
export function DialogPane({
  entry,
  isDraft,
  entries,
  resolvedNames,
  onChange,
  onFinish,
  onToForm,
  onCreateEntry,
  onRefClick,
  className,
  initialSession,
  onSessionChange,
}: {
  entry: GlossaryEntry
  /** 新規の下書き（登録するまで保存しない・D-DLG-ENTRY）。 */
  isDraft: boolean
  /** 画面を離れて戻ったときの会話（下書き）。無ければ最初から。 */
  initialSession?: DialogSession
  /** 会話が進むたびに知らせる（親が下書きと一緒に覚えておく）。 */
  onSessionChange?: (session: DialogSession) => void
  /** 用語集（@／[[ の候補と、名前の重複の検査）。 */
  entries: GlossaryEntry[]
  resolvedNames: Set<string>
  /**
   * 答え・分類・公開の扱い・公開情報（下書きを入れた）が変わるたびに呼ぶ。`prev` はその直前の
   * 手元の項目＝親は差分（変わった欄）だけを保存し、他の欄を巻き込まない。
   */
  onChange: (next: GlossaryEntry, prev: GlossaryEntry) => Promise<void> | void
  /** 下書きの「用語集に登録する」。失敗（重複など）は reject し、対話の中にそのまま出す。 */
  onFinish?: (entry: GlossaryEntry) => Promise<void>
  onToForm: () => void
  onCreateEntry?: (name: string) => Promise<string | null>
  onRefClick?: (name: string) => void
  className?: string
}) {
  const [local, setLocal] = useState(entry)
  const [session, setSession] = useState<DialogSession>(
    () => initialSession ?? beginSession(entry, { draft: isDraft }),
  )
  const notifySession = onSessionChange
  useEffect(() => {
    notifySession?.(session)
  }, [session, notifySession])
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null)
  const saving = useRef(0)
  const localRef = useRef(local)
  localRef.current = local
  const entryRef = useRef(entry)
  entryRef.current = entry
  // 保存が終わって prop が追いついたら、それを手元にする（フォーム側の編集・同期の取り込みも拾う）。
  // 分類がよそ（フォームのカテゴリ・同期）で変わったら、質問セットが変わるので台本を最初から始め直す。
  // 保存中は採らず、保存が終わった時点でもう一度見る（保存中に届いた変更を取りこぼさない）。
  const syncFromProp = () => {
    const latest = entryRef.current
    if (saving.current !== 0 || latest === localRef.current) return
    const categoryChanged = (latest.category ?? '') !== (localRef.current.category ?? '')
    setLocal(latest)
    if (categoryChanged) setSession(beginSession(latest, { draft: isDraft }))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: prop の entry が変わったときに同期する（関数は ref 経由で最新を読む）
  useEffect(syncFromProp, [entry])
  const answers = useMemo(() => answersOf(local), [local])

  const logRef = useRef<HTMLDivElement>(null)
  const logLength = session.log.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: ログが伸びるたびに末尾へ寄せる
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logLength])

  const persist = async (next: GlossaryEntry, prev: GlossaryEntry) => {
    saving.current += 1
    try {
      await onChange(next, prev)
    } catch (e) {
      // 保存できなかった変更を手元に残すと、以後の差分がそこを基準にして二度と保存されない。
      // 保存前の項目へ戻し、台本もそこから始め直す（答え済みは並び直し、失敗した問いから続く）。
      // ほかの保存が同時に走っているときは戻さない（そちらの答えまで消してしまう）＝一言だけ添える。
      const message = e instanceof Error ? e.message : '保存に失敗しました'
      if (saving.current === 1) {
        setLocal(prev)
        setSession(rejectAnswer(beginSession(prev, { draft: isDraft }), message, prev))
      } else {
        setSession((s) => rejectAnswer(s, message, localRef.current))
      }
    } finally {
      saving.current -= 1
      syncFromProp()
    }
  }

  const apply = (step: SessionStep) => {
    setSession(step.session)
    if (step.entry !== local) {
      setLocal(step.entry)
      void persist(step.entry, local)
    }
    if (step.effect === 'toform') onToForm()
    if (step.effect === 'finish' && onFinish) {
      void onFinish(step.entry).catch((e: unknown) => {
        setSession((s) =>
          rejectAnswer(s, e instanceof Error ? e.message : '登録に失敗しました', localRef.current),
        )
      })
    }
  }

  const ctx = { entries }
  const onChip = (action: ChipAction, value?: string) =>
    apply(runChip(session, local, action, value, ctx))
  const onToggleVisibility = (key: string) => {
    const next = toggleAnswerPublic(local, key)
    if (next === local) return
    setLocal(next)
    void persist(next, local)
  }
  const applySummaryDraft = () => {
    if (summaryDraft === null) return
    const next = withPublicText(local, summaryDraft)
    setLocal(next)
    setSummaryDraft(null)
    void persist(next, local)
  }

  const q = pendingQuestion(session, local)
  const hint = pendingHint(session)

  return (
    <section
      className={cn(
        'flex h-[min(72vh,680px)] flex-col overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest',
        className,
      )}
      aria-label="対話"
    >
      <div
        ref={logRef}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-4 pb-2"
        aria-live="polite"
      >
        {session.log.map((m, i) => (
          <Message
            // biome-ignore lint/suspicious/noArrayIndexKey: ログは末尾にしか増えない
            key={i}
            message={m}
            entry={local}
            answers={answers}
            isDraft={isDraft}
            resolvedNames={resolvedNames}
            onRefClick={onRefClick}
            onChip={onChip}
            onEdit={(key) => apply(pickQuestion(session, local, key))}
            onToggleVisibility={onToggleVisibility}
            summaryDraft={summaryDraft}
            onMakeSummaryDraft={() => setSummaryDraft(draftSummaryFromDialog(local))}
            onApplySummaryDraft={applySummaryDraft}
          />
        ))}
      </div>
      <div className="flex flex-col gap-2 border-outline-variant/30 border-t px-3 pt-2 pb-3">
        {q ? (
          <Composer
            key={q.key}
            question={q}
            required={session.pending?.kind === 'question' && session.pending.required === true}
            entries={entries}
            onCreateEntry={onCreateEntry}
            onAnswer={(text) => apply(submitAnswer(session, local, text, ctx))}
            onSkip={(later) => apply(skipQuestion(session, local, later))}
          />
        ) : hint ? (
          <p className="text-[11.5px] text-on-surface-variant/70">{hint}</p>
        ) : null}
      </div>
    </section>
  )
}

/** 答えの入力欄（選択肢はチップ・自由記述は Enter で決定・スキップとあとで）。 */
function Composer({
  question: q,
  required,
  entries,
  onCreateEntry,
  onAnswer,
  onSkip,
}: {
  question: AnyDialogQuestion
  /** スキップ・あとでにできない（登録に名前が要るときの聞き直し）。 */
  required: boolean
  entries: GlossaryEntry[]
  onCreateEntry?: (name: string) => Promise<string | null>
  onAnswer: (text: string) => void
  onSkip: (later: boolean) => void
}) {
  const control = useRef<CommitTextareaHandle | null>(null)
  const choicesOnly = !!q.choices && !q.free
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {q.choices?.map((c) => (
          <Chip key={c} label={c} onClick={() => onAnswer(c)} />
        ))}
        {choicesOnly || required ? null : (
          <Chip label="スキップ" ghost onClick={() => onSkip(false)} />
        )}
        {required ? null : <Chip label="あとで答える" ghost onClick={() => onSkip(true)} />}
        <span className="ml-auto text-[11px] text-on-surface-variant/60">{visibilityHint(q)}</span>
      </div>
      {choicesOnly ? null : (
        <>
          <div className="flex items-end gap-2">
            <CommitTextarea
              ariaLabel="答え"
              value=""
              onCommit={() => {}}
              onSubmit={onAnswer}
              controlRef={control}
              autoFocus
              placeholder={q.placeholder}
              glossary={entries}
              onCreateEntry={onCreateEntry}
              grow
              wrapperClassName="min-w-0 flex-1"
              className="max-h-36 min-h-11 text-[13.5px]"
            />
            <button
              type="button"
              onClick={() => control.current?.submit()}
              className="h-11 shrink-0 rounded-md bg-primary px-4 font-medium text-[13px] text-white transition-colors hover:bg-primary/90"
            >
              答える
            </button>
          </div>
          <p className="text-right text-[11px] text-on-surface-variant/60">
            <span className="[@media(pointer:coarse)]:hidden">
              Enter で決定、Shift+Enter で改行 ・{' '}
            </span>
            @ か [[ で用語集の項目を呼び出せます
          </p>
        </>
      )}
    </>
  )
}

function Message({
  message: m,
  entry,
  answers,
  isDraft,
  resolvedNames,
  onRefClick,
  onChip,
  onEdit,
  onToggleVisibility,
  summaryDraft,
  onMakeSummaryDraft,
  onApplySummaryDraft,
}: {
  message: DialogMessage
  entry: GlossaryEntry
  /** answersOf(entry)（ログの吹き出しごとに作り直さない）。 */
  answers: Record<string, DialogAnswer>
  isDraft: boolean
  resolvedNames: Set<string>
  onRefClick?: (name: string) => void
  onChip: (action: ChipAction, value?: string) => void
  onEdit: (key: string) => void
  onToggleVisibility: (key: string) => void
  summaryDraft: string | null
  onMakeSummaryDraft: () => void
  onApplySummaryDraft: () => void
}) {
  switch (m.role) {
    case 'bot':
      return (
        <div className="flex max-w-[82%] flex-col self-start">
          <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md bg-surface-container-high px-3.5 py-2 text-[13.5px] text-on-surface leading-relaxed">
            {m.text}
          </div>
        </div>
      )
    case 'user': {
      if (m.key === undefined) {
        return (
          <div className="flex max-w-[82%] flex-col items-end self-end">
            <div className="rounded-2xl rounded-br-md bg-primary-container px-3.5 py-2 text-[13.5px] text-on-primary-container">
              {m.text}
            </div>
          </div>
        )
      }
      const key = m.key
      const q = questionByKey(entry.category, key)
      const a = answers[key]
      // 吹き出しは今の答えを映す（ログの印は、答えが欄に無い下書きの共通 4 問のときだけ使う）。
      const later = a ? a.later === true && a.text.trim() === '' : m.later === true
      const blank = a ? a.text.trim() === '' : true
      return (
        <div className="flex max-w-[82%] flex-col items-end self-end">
          <span className="mx-1.5 mb-0.5 text-[11px] text-on-surface-variant/70">
            {m.isDig ? '↳ ' : ''}
            {m.label}
          </span>
          {blank ? (
            <div className="rounded-2xl rounded-br-md border border-outline-variant/40 border-dashed px-3.5 py-2 text-[13px] text-on-surface-variant/70">
              {later ? 'あとで答える' : 'スキップ'}
            </div>
          ) : (
            <NotationText
              text={a?.text ?? m.text}
              resolvedNames={resolvedNames}
              onRefClick={onRefClick}
              className="rounded-2xl rounded-br-md bg-primary-container px-3.5 py-2 text-[13.5px] text-on-primary-container leading-relaxed"
            />
          )}
          <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5">
            {!blank && q ? (
              <VisibilityPill
                question={q}
                isPublic={answerPublic(q, a)}
                onToggle={() => onToggleVisibility(key)}
              />
            ) : null}
            <button
              type="button"
              onClick={() => onEdit(key)}
              aria-label={`「${m.label ?? key}」の答えを直す`}
              className="px-1 text-[11px] text-on-surface-variant/70 underline underline-offset-2 hover:text-on-surface"
            >
              直す
            </button>
          </div>
        </div>
      )
    }
    case 'chips':
      return (
        <fieldset
          className="m-0 flex max-w-[92%] flex-wrap gap-1.5 self-start border-0 p-0"
          aria-label="選択肢"
        >
          {m.chips.map((c) => (
            <Chip
              key={`${c.action}:${c.value ?? ''}`}
              label={c.label}
              note={c.note}
              primary={c.primary}
              ghost={c.ghost}
              blank={c.blank}
              onClick={() => onChip(c.action, c.value)}
            />
          ))}
        </fieldset>
      )
    case 'card-base':
      return (
        <div className="self-stretch rounded-lg border border-outline-variant/30 bg-surface px-3.5 py-3 text-[13px]">
          <h3 className="mb-1.5 font-serif text-[15px] text-on-surface">
            {entry.name}{' '}
            <span className="font-sans text-[12px] text-on-surface-variant/70">
              フォームに入っている情報
            </span>
          </h3>
          <dl className="grid grid-cols-[6em_1fr] gap-x-2.5 gap-y-1">
            <dt className="text-on-surface-variant/70">読み</dt>
            <dd className={cn('m-0', !entry.reading && 'text-on-surface-variant/50')}>
              {entry.reading || '（なし）'}
            </dd>
            <dt className="text-on-surface-variant/70">別名</dt>
            <dd className={cn('m-0', entry.aliases.length === 0 && 'text-on-surface-variant/50')}>
              {entry.aliases.length > 0 ? entry.aliases.join('、') : '（なし）'}
            </dd>
            <dt className="text-on-surface-variant/70">公開情報</dt>
            <dd
              className={cn('m-0 truncate', !publicTextOf(entry) && 'text-on-surface-variant/50')}
            >
              {publicTextOf(entry).split('\n')[0] || '（なし）'}
            </dd>
          </dl>
        </div>
      )
    case 'card':
      return (
        <SummaryCard
          entry={entry}
          answers={answers}
          isDraft={isDraft}
          resolvedNames={resolvedNames}
          onRefClick={onRefClick}
          summaryDraft={summaryDraft}
          onMakeSummaryDraft={onMakeSummaryDraft}
          onApplySummaryDraft={onApplySummaryDraft}
        />
      )
  }
}

/** ひと通り答えたあとの「まとめ」（読者に見える答え／作者だけの答え・公開情報の下書き）。 */
function SummaryCard({
  entry,
  answers,
  isDraft,
  resolvedNames,
  onRefClick,
  summaryDraft,
  onMakeSummaryDraft,
  onApplySummaryDraft,
}: {
  entry: GlossaryEntry
  answers: Record<string, DialogAnswer>
  isDraft: boolean
  resolvedNames: Set<string>
  onRefClick?: (name: string) => void
  summaryDraft: string | null
  onMakeSummaryDraft: () => void
  onApplySummaryDraft: () => void
}) {
  const rows: { q: AnyDialogQuestion; text: string; pub: boolean }[] = []
  for (const q of activeDeepQuestionsFor(entry)) {
    for (const x of [q, ...digQuestionsOf(q)]) {
      const a = answers[x.key]
      if (!a || a.text.trim() === '') continue
      rows.push({ q: x, text: a.text, pub: answerPublic(x, a) })
    }
  }
  const list = (items: typeof rows) =>
    items.length === 0 ? (
      <p className="m-0 text-[12.5px] text-on-surface-variant/50">まだありません</p>
    ) : (
      <dl className="m-0 grid grid-cols-[7em_1fr] gap-x-2.5 gap-y-1 text-[13px]">
        {items.map(({ q, text }) => (
          <div key={q.key} className="contents">
            <dt className="text-on-surface-variant/70">
              {isDigQuestion(q) ? '↳ ' : ''}
              {q.label}
            </dt>
            <NotationText
              text={text}
              resolvedNames={resolvedNames}
              onRefClick={onRefClick}
              className="m-0 whitespace-pre-wrap text-on-surface"
            />
          </div>
        ))}
      </dl>
    )
  return (
    <div className="self-stretch rounded-lg border border-outline-variant/30 bg-surface px-3.5 py-3">
      <h3 className="mb-1 font-serif text-[15px] text-on-surface">
        {entry.name || '（名前なし）'}{' '}
        <span className="font-sans text-[12px] text-on-surface-variant/70">{entry.category}</span>
      </h3>
      <div className="mt-2 mb-1">
        <VisibilityLabel isPublic label="読者に見える" />
      </div>
      {list(rows.filter((r) => r.pub))}
      <div className="mt-3 mb-1">
        <VisibilityLabel isPublic={false} label="作者だけ" />
      </div>
      {list(rows.filter((r) => !r.pub))}
      {isDraft ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onMakeSummaryDraft}
            className="rounded-md border border-outline-variant/40 bg-surface-container-lowest px-3 py-1.5 text-[12.5px] text-on-surface transition-colors hover:bg-surface-container-high"
          >
            「読者に見せる」の答えから公開情報の下書きを作る
          </button>
          {summaryDraft !== null ? (
            <button
              type="button"
              onClick={onApplySummaryDraft}
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] text-white transition-colors hover:bg-primary/90"
            >
              公開情報の欄に入れる
            </button>
          ) : null}
        </div>
      )}
      {summaryDraft !== null ? (
        <output
          aria-label="公開情報の下書き"
          className="mt-2 block whitespace-pre-wrap rounded-md border border-outline-variant/40 border-dashed bg-surface-container-lowest px-2.5 py-2 font-sans text-[13px] text-on-surface"
        >
          {summaryDraft || '（「読者に見せる」の答えがまだありません）'}
        </output>
      ) : null}
    </div>
  )
}

/** 答えごとの「読者に見せる／作者だけ」。固定の問いは印だけ、切り替えられる問いはボタン。 */
function VisibilityPill({
  question: q,
  isPublic,
  onToggle,
}: {
  question: AnyDialogQuestion
  isPublic: boolean
  onToggle: () => void
}) {
  if (isFixedVisibility(q)) {
    return (
      <VisibilityLabel
        isPublic={isPublic}
        label={q.vis === 'public-fixed' ? '読者に見える欄' : '作者だけ（固定）'}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isPublic}
      aria-label={
        isPublic ? '読者に見せる（押すと作者だけに戻す）' : '作者だけ（押すと読者に見せる）'
      }
      className="rounded-full transition-opacity hover:opacity-80"
    >
      <VisibilityLabel isPublic={isPublic} className="border border-outline-variant/40" />
    </button>
  )
}

function Chip({
  label,
  note,
  primary,
  ghost,
  blank,
  onClick,
}: {
  label: string
  note?: string
  primary?: boolean
  ghost?: boolean
  blank?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-[12.5px] transition-colors md:py-1',
        primary
          ? 'border-primary bg-primary text-white hover:bg-primary/90'
          : 'border-outline-variant/40 bg-surface-container-lowest text-on-surface hover:border-primary/50 hover:bg-accent',
        ghost && 'text-on-surface-variant',
        blank && 'border-dashed',
      )}
    >
      {label}
      {note ? <span className="ml-1 text-[10.5px] text-on-surface-variant/70">{note}</span> : null}
    </button>
  )
}

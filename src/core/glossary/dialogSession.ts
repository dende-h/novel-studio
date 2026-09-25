import type { DialogAnswer, GlossaryEntry } from '../schema'
import {
  type AnsweredOptions,
  type AnyDialogQuestion,
  activeQuestionsFor,
  answerPublic,
  answersOf,
  BASE_QUESTIONS,
  DIALOG_CATEGORIES,
  type DialogQuestion,
  dialogProgress,
  dialogStarted,
  digQuestionsOf,
  hasDialogQuestions,
  isAnswered,
  isDigQuestion,
  isLater,
  laterQuestionsOf,
  nextQuestion,
  parseAliasInput,
  questionByKey,
  questionText,
  withDialogAnswer,
} from './dialog'
import { resolveRef } from './index'

/**
 * 対話ペインの**台本**（LLM を使わない決まった応答・D-DLG-BOT）。会話ログと「いま何を待っているか」を
 * 純データで持ち、遷移はすべて純関数＝画面は結果を描いて保存するだけ。
 *
 * 遷移は `{ session, entry }` を返す。entry が変わったとき（答え・分類）は、呼び出し側が保存する
 * （既存の項目は store へ、新規の下書きは登録まで手元に置く）。
 */

export type ChipAction =
  | 'category'
  | 'choice'
  | 'skip'
  | 'later'
  | 'pick'
  | 'reopen'
  | 'dig'
  | 'digskip'
  | 'resume'
  | 'finish'
  | 'toform'

export interface DialogChip {
  label: string
  action: ChipAction
  value?: string
  primary?: boolean
  ghost?: boolean
  /** 未回答・あとでの印（破線）。 */
  blank?: boolean
  /** ラベルの右に添える小さな注記（「あとで」「未回答」）。 */
  note?: string
}

export type DialogMessage =
  | { role: 'bot'; text: string }
  /** 答えの吹き出し。`key` が無いものは分類の選択（直す・公開の印を持たない）。 */
  | {
      role: 'user'
      key?: string
      label?: string
      text: string
      skipped?: boolean
      later?: boolean
      isDig?: boolean
    }
  | { role: 'chips'; chips: DialogChip[] }
  /** 既存の項目の「フォームに入っている情報」のカード。 */
  | { role: 'card-base' }
  /** ひと通り答えたあとの「まとめ」のカード。 */
  | { role: 'card' }

export type DialogPending =
  /** required＝スキップ・あとでにできない（登録に名前が要るときの聞き直し）。 */
  | { kind: 'question'; key: string; required?: true }
  | { kind: 'category' }
  | { kind: 'pick' }
  | { kind: 'dig-offer'; key: string }

export interface DialogSession {
  /** 新規の下書き（登録するまで保存しない）。 */
  draft: boolean
  log: DialogMessage[]
  pending: DialogPending | null
  /** 「直す」で聞き直している鍵。答えると本流（次の未回答）へ戻る（D-DLG-EDIT）。 */
  editingKey: string | null
  /** 直前に案内したまとまり（切り替わりでだけ案内する）。 */
  lastSection: string | null
  /** 下書きで共通 4 問をスキップ／あとでにした印。 */
  baseMarks: Record<string, 'skipped' | 'later'>
}

export type SessionEffect = 'finish' | 'toform'

export interface SessionStep {
  session: DialogSession
  entry: GlossaryEntry
  /** 画面側の操作（登録する・フォームへ戻る）。 */
  effect?: SessionEffect
}

const optsOf = (s: DialogSession): AnsweredOptions => ({ draft: s.draft, baseMarks: s.baseMarks })

/** チップは常に「いまの問いかけ」なので、次の遷移で消す。 */
const withoutChips = (log: DialogMessage[]) => log.filter((m) => m.role !== 'chips')
const say = (s: DialogSession, text: string): DialogSession => ({
  ...s,
  log: [...s.log, { role: 'bot', text }],
})
const push = (s: DialogSession, m: DialogMessage): DialogSession => ({ ...s, log: [...s.log, m] })
/** 答えの吹き出しは鍵ごとに 1 つ＝聞き直したら前の吹き出しを消して、最新だけ残す。 */
const pushAnswer = (s: DialogSession, m: DialogMessage & { role: 'user'; key: string }) => ({
  ...s,
  log: [...s.log.filter((x) => !(x.role === 'user' && x.key === m.key)), m],
})
const chips = (s: DialogSession, items: DialogChip[]): DialogSession =>
  push(s, { role: 'chips', chips: items })

/** 待っている問い（自由記述・選択肢の入力欄を出す状態）。 */
export function pendingQuestion(
  session: DialogSession,
  entry: GlossaryEntry,
): AnyDialogQuestion | undefined {
  if (session.pending?.kind !== 'question') return undefined
  return questionByKey(entry.category, session.pending.key)
}

/** 分類を聞く（新規・分類が対話の質問を持たないとき）。 */
function askCategory(s: DialogSession, lead: string): DialogSession {
  let next = say(s, lead)
  next = { ...next, pending: { kind: 'category' } }
  return chips(
    next,
    DIALOG_CATEGORIES.map((c) => ({ label: c, action: 'category', value: c })),
  )
}

/** 1 問を聞く（まとまりの切り替わりで案内・名前を差し込む・追い質問は ↳）。 */
function ask(s: DialogSession, entry: GlossaryEntry, q: AnyDialogQuestion): DialogSession {
  let next = s
  if (!isDigQuestion(q) && !s.editingKey && q.section !== s.lastSection) {
    // 数は進み具合と同じ「基本の問い」で言う。任意があれば添える。
    const inSection = activeQuestionsFor(entry).filter((x) => x.section === q.section)
    const core = inSection.filter((x) => !x.optional).length
    const optional = inSection.length - core
    next = say(
      next,
      optional > 0
        ? `ここから「${q.section}」について ${core} 問です（ほかに任意が ${optional} 問）。`
        : `ここから「${q.section}」について ${core} 問です。`,
    )
    next = { ...next, lastSection: q.section }
  }
  next = say(next, `${isDigQuestion(q) ? '↳ ' : ''}${questionText(q, entry)}`)
  return { ...next, pending: { kind: 'question', key: q.key } }
}

/** どれを変えるかを選ばせる（全問答え済み・あとでの答え・直すの入口）。 */
function askPick(s: DialogSession, entry: GlossaryEntry, lead: string | null): DialogSession {
  let next = lead ? say(s, lead) : s
  next = { ...next, pending: { kind: 'pick' } }
  const o = optsOf(next)
  const items: DialogChip[] = []
  for (const q of activeQuestionsFor(entry)) {
    if (q.field !== undefined && !next.draft) continue
    const later = isLater(entry, q, o)
    const blank = !isAnswered(entry, q, o) || later
    items.push({
      label: q.label,
      action: 'pick',
      value: q.key,
      blank,
      ...(later ? { note: 'あとで' } : blank ? { note: '未回答' } : {}),
    })
    // 追い質問は「あとで」にしたものだけ並べる（本流には無いので、ここが戻る道）。
    for (const d of digQuestionsOf(q)) {
      if (isLater(entry, d, o)) {
        items.push({
          label: `↳ ${d.label}`,
          action: 'pick',
          value: d.key,
          blank: true,
          note: 'あとで',
        })
      }
    }
  }
  const nu = nextQuestion(entry, o)
  if (nu) items.push({ label: 'つづきの質問へ', action: 'resume', primary: true })
  items.push(
    next.draft
      ? { label: 'これで登録する', action: 'finish', primary: !nu }
      : { label: 'フォームに戻る', action: 'toform', primary: !nu },
  )
  return chips(next, items)
}

/** 答え済みの吹き出しをログに並べ直す（再開・直すのとき）。 */
function replay(s: DialogSession, entry: GlossaryEntry): DialogSession {
  let next = s
  for (const q of activeQuestionsFor(entry)) {
    if (q.field !== undefined) continue
    const a = entry.dialog?.[q.key]
    if (!a) continue
    next = push(next, userMessage(q, a))
    for (const d of digQuestionsOf(q)) {
      const da = entry.dialog?.[d.key]
      if (da) next = push(next, userMessage(d, da))
    }
  }
  return next
}

function userMessage(q: AnyDialogQuestion, a: DialogAnswer): DialogMessage {
  return {
    role: 'user',
    key: q.key,
    label: q.label,
    text: a.text,
    ...(a.skipped ? { skipped: true } : {}),
    ...(a.later ? { later: true } : {}),
    ...(isDigQuestion(q) ? { isDig: true } : {}),
  }
}

const INTRO_DRAFT = [
  '新しい項目を作ります。決まった質問を順にお聞きしますので、ひとつずつ答えてください。「用語集に登録」するまで保存はされません。ほかの画面へ行って戻るあいだは残りますが、ページを閉じると消えます（登録したあとは「対話をつづける」でいつでも再開できます）。',
  '読者に見せるかどうかは、答えごとに選べます。答えの中で @ か [[ と打つと、用語集の項目を呼び出せます。答えたあとに「もう少し深める」を押すと、追い質問が続きます。',
]

/** 対話を始める（開いた項目の状態に合わせて、続きから・あとでから・どれを変えるか）。 */
export function beginSession(entry: GlossaryEntry, opts: { draft: boolean }): DialogSession {
  let s: DialogSession = {
    draft: opts.draft,
    log: [],
    pending: null,
    editingKey: null,
    lastSection: null,
    baseMarks: {},
  }
  if (opts.draft) {
    for (const t of INTRO_DRAFT) s = say(s, t)
    // フォームで先に分類を選んであれば聞かない（同じことを二度聞かない）。
    if (!hasDialogQuestions(entry.category)) return askCategory(s, 'どの分類の項目ですか。')
    // 答え済みがあれば（画面を離れて戻った下書き）並べ直してから続きを聞く。
    if (dialogStarted(entry)) s = replay(s, entry)
    const first = nextQuestion(entry, optsOf(s))
    return first ? ask(s, entry, first) : askPick(s, entry, null)
  }
  if (!hasDialogQuestions(entry.category)) {
    return askCategory(
      s,
      `${entry.name} の分類を選ぶと、その分類の質問が並びます。分類はフォームの「カテゴリ」と同じ欄です。`,
    )
  }
  const o = optsOf(s)
  const nu = nextQuestion(entry, o)
  const p = dialogProgress(entry)
  if (!dialogStarted(entry)) {
    s = push(s, { role: 'card-base' })
    s = say(
      s,
      `${entry.name} の名前・読み・別名・公開情報は入っているので、その先から聞きます。基本の質問は ${p.total} 問です（任意の問いは数に入れません）。読者に見せるかどうかは、答えごとに選べます。`,
    )
    return nu ? ask(s, entry, nu) : askPick(s, entry, null)
  }
  if (nu) {
    s = say(
      s,
      `${entry.name} の対話をつづけます。基本の ${p.total} 問のうち ${p.done} 問まで答えてあります。`,
    )
    return ask(replay(s, entry), entry, nu)
  }
  if (p.later > 0) {
    s = say(s, `${entry.name} は「あとで」にした答えが ${p.later} つあります。`)
    return askPick(replay(s, entry), entry, '答えますか。')
  }
  s = say(s, `${entry.name} は全部の質問に答えてあります。どれを変えますか。`)
  return askPick(replay(s, entry), entry, null)
}

/**
 * 答えを受け付けなかった・保存や登録に失敗したときの一言。待っている状態はそのままにし、
 * チップで待っていた状態（分類・どれを変えるか・深める）はチップを出し直す＝行き止まりにしない。
 */
export function rejectAnswer(
  session: DialogSession,
  message: string,
  entry: GlossaryEntry,
): DialogSession {
  return reissuePrompt(say({ ...session, log: withoutChips(session.log) }, message), entry)
}

/** チップで待っていた状態のチップを出し直す（問いを待つ状態はそのまま）。 */
function reissuePrompt(s: DialogSession, entry: GlossaryEntry): DialogSession {
  switch (s.pending?.kind) {
    case 'category':
      return chips(
        s,
        DIALOG_CATEGORIES.map((c) => ({ label: c, action: 'category', value: c })),
      )
    case 'pick':
      return askPick(s, entry, null)
    case 'dig-offer':
      return chips(s, [
        { label: 'もう少し深める', action: 'dig', value: s.pending.key, primary: true },
        { label: '次へ', action: 'digskip' },
      ])
    default:
      return s
  }
}

/** 答えを受け取る（分類の選択・自由記述・選択肢のどれでも）。 */
export function submitAnswer(
  session: DialogSession,
  entry: GlossaryEntry,
  rawText: string,
  ctx: { entries?: readonly GlossaryEntry[] } = {},
): SessionStep {
  const text = rawText.trim()
  const s: DialogSession = { ...session, log: withoutChips(session.log) }
  // 受け付けない入力（空・知らない分類）はチップを出し直して待つ＝行き止まりにしない。
  if (text === '' || !s.pending) return { session: reissuePrompt(s, entry), entry }
  if (s.pending.kind === 'category') {
    if (!hasDialogQuestions(text)) return { session: reissuePrompt(s, entry), entry }
    const next = { ...entry, category: text }
    let ns = push(s, { role: 'user', text })
    const core = activeQuestionsFor(next).filter((q) => !q.optional && q.field === undefined).length
    ns = say(
      ns,
      `${text} ですね。基本の質問は ${core} 問です。「種類」の答えによって、あとから枝の問いが加わります。`,
    )
    ns = { ...ns, pending: null }
    const first = nextQuestion(next, optsOf(ns))
    return { session: first ? ask(ns, next, first) : askPick(ns, next, null), entry: next }
  }
  if (s.pending.kind !== 'question') return { session: reissuePrompt(s, entry), entry }
  const q = questionByKey(entry.category, s.pending.key)
  if (!q) return { session: { ...s, pending: null }, entry }
  if (q.choices && !q.free && !q.choices.includes(text)) {
    return {
      session: rejectAnswer(s, `${q.choices.join('・')} から選んでください。`, entry),
      entry,
    }
  }
  // 名前の重複（D-GLOS-UNIQUE）は登録時にも弾かれるが、対話の途中で分かるほうが直しやすい。
  if (q.field === 'name' && ctx.entries) {
    const hit = resolveRef(
      text,
      ctx.entries.filter((e) => e.id !== entry.id),
    )
    if (hit) {
      return {
        session: rejectAnswer(
          s,
          `「${text}」は用語集にもうあります。別の名前を教えてください。`,
          entry,
        ),
        entry,
      }
    }
  }
  // 別名は読点区切りで配列になる。区切りだけの入力は答えにならず同じ問いが続くので、その場で伝える。
  if (q.field === 'aliases' && parseAliasInput(text).length === 0) {
    return {
      session: rejectAnswer(
        s,
        '別名は読点（、）で区切って書いてください。無ければ「スキップ」を押してください。',
        entry,
      ),
      entry,
    }
  }
  const prev = entry.dialog?.[q.key]
  const next = withDialogAnswer(entry, q, {
    text,
    ...(q.field === undefined ? { public: answerPublic(q, prev) } : {}),
  })
  let ns = pushAnswer(s, {
    role: 'user',
    key: q.key,
    label: q.label,
    text,
    ...(isDigQuestion(q) ? { isDig: true } : {}),
  })
  if (q.field !== undefined) {
    const { [q.key]: _drop, ...marks } = ns.baseMarks
    ns = { ...ns, baseMarks: marks }
  }
  if (isDigQuestion(q)) return afterDig(ns, next, q)
  if (q.dig && q.dig.length > 0 && !ns.editingKey) {
    ns = { ...ns, pending: { kind: 'dig-offer', key: q.key } }
    ns = chips(ns, [
      { label: 'もう少し深める', action: 'dig', value: q.key, primary: true },
      { label: '次へ', action: 'digskip' },
    ])
    return { session: ns, entry: next }
  }
  return after(ns, next)
}

/** スキップ／あとで答える。 */
export function skipQuestion(
  session: DialogSession,
  entry: GlossaryEntry,
  later: boolean,
): SessionStep {
  const s: DialogSession = { ...session, log: withoutChips(session.log) }
  if (s.pending?.kind !== 'question') return { session: s, entry }
  if (s.pending.required) {
    return {
      session: rejectAnswer(s, '名前は登録に必要です。名前を教えてください。', entry),
      entry,
    }
  }
  const q = questionByKey(entry.category, s.pending.key)
  if (!q) return { session: { ...s, pending: null }, entry }
  // 「直す」で聞き直しているときのスキップ・あとでは「そのままにする」＝答えを消さない。
  if (s.editingKey === q.key && (answersOf(entry)[q.key]?.text.trim() ?? '') !== '') {
    return after(say(s, 'そのままにします。'), entry, { silent: true })
  }
  let next = entry
  let ns = s
  if (q.field !== undefined) {
    ns = { ...ns, baseMarks: { ...ns.baseMarks, [q.key]: later ? 'later' : 'skipped' } }
  } else {
    next = withDialogAnswer(entry, q, {
      text: '',
      ...(later ? { later: true } : { skipped: true }),
    })
  }
  ns = pushAnswer(ns, {
    role: 'user',
    key: q.key,
    label: q.label,
    text: '',
    ...(later ? { later: true } : { skipped: true }),
    ...(isDigQuestion(q) ? { isDig: true } : {}),
  })
  if (isDigQuestion(q)) return afterDig(ns, next, q)
  return after(ns, next)
}

/** 同じ親の、まだ答えていない追い質問があれば続ける。 */
function afterDig(s: DialogSession, entry: GlossaryEntry, q: AnyDialogQuestion): SessionStep {
  const parent = isDigQuestion(q) ? questionByKey(entry.category, q.parentKey) : undefined
  const rest = parent ? digQuestionsOf(parent).filter((d) => !entry.dialog?.[d.key]) : []
  const ns = { ...s, pending: null }
  if (rest.length > 0 && !ns.editingKey && rest[0])
    return { session: ask(ns, entry, rest[0]), entry }
  return after(ns, entry)
}

/** 1 問済んだあとの本流（直す→戻る／次の問い／ひと通り済んだらまとめ）。 */
function after(
  s: DialogSession,
  entry: GlossaryEntry,
  opts: { silent?: boolean } = {},
): SessionStep {
  let ns: DialogSession = { ...s, pending: null }
  const o = optsOf(ns)
  if (ns.editingKey) {
    ns = { ...ns, editingKey: null }
    const nu = nextQuestion(entry, o)
    if (nu) {
      return {
        session: ask(
          opts.silent ? say(ns, 'つづきを聞きます。') : say(ns, '直しました。つづきを聞きます。'),
          entry,
          nu,
        ),
        entry,
      }
    }
    return { session: askPick(ns, entry, 'ほかに変えますか。'), entry }
  }
  const nu = nextQuestion(entry, o)
  if (nu) return { session: ask(ns, entry, nu), entry }
  const later = laterQuestionsOf(entry, o)
  ns = say(
    ns,
    later.length > 0
      ? `ひと通り聞きました。「あとで」にした答えが ${later.length} つあります。今答えても、あとで戻ってきても構いません。`
      : 'ひと通り聞きました。まとめはこちらです。',
  )
  ns = push(ns, { role: 'card' })
  ns = { ...ns, pending: { kind: 'pick' } }
  const items: DialogChip[] = later.map((q) => ({
    label: `${isDigQuestion(q) ? '↳ ' : ''}${q.label}`,
    action: 'pick',
    value: q.key,
    blank: true,
    note: 'あとで',
  }))
  items.push({ label: '答えを直す', action: 'reopen' })
  items.push(
    ns.draft
      ? { label: '用語集に登録する', action: 'finish', primary: true }
      : { label: 'フォームで確かめる', action: 'toform', primary: true },
  )
  return { session: chips(ns, items), entry }
}

/** 「直す」＝その問いだけ聞き直す。 */
export function pickQuestion(
  session: DialogSession,
  entry: GlossaryEntry,
  key: string,
): SessionStep {
  const s: DialogSession = { ...session, log: withoutChips(session.log) }
  const q = questionByKey(entry.category, key)
  // 分類が変わって無くなった問い：待っていた状態のチップを出し直す（行き止まりにしない）。
  if (!q) return { session: reissuePrompt(s, entry), entry }
  let ns: DialogSession = { ...s, editingKey: key }
  const a = answersOf(entry)[key]
  if (a && a.text.trim() !== '') {
    ns = say(ns, `「${q.label}」は今こうなっています。\n${a.text}\n\n新しい答えを書いてください。`)
  }
  return { session: ask(ns, entry, q), entry }
}

/** チップの操作。 */
export function runChip(
  session: DialogSession,
  entry: GlossaryEntry,
  action: ChipAction,
  value?: string,
  ctx: { entries?: readonly GlossaryEntry[] } = {},
): SessionStep {
  switch (action) {
    case 'category':
    case 'choice':
      return submitAnswer(session, entry, value ?? '', ctx)
    case 'skip':
      return skipQuestion(session, entry, false)
    case 'later':
      return skipQuestion(session, entry, true)
    case 'pick':
      return pickQuestion(session, entry, value ?? '')
    case 'reopen':
      return {
        session: askPick(
          { ...session, log: withoutChips(session.log) },
          entry,
          'どれを直しますか。',
        ),
        entry,
      }
    case 'dig': {
      const s: DialogSession = { ...session, log: withoutChips(session.log), pending: null }
      const parent = value ? questionByKey(entry.category, value) : undefined
      const first = parent ? digQuestionsOf(parent)[0] : undefined
      return first ? { session: ask(s, entry, first), entry } : after(s, entry)
    }
    case 'digskip':
      return after({ ...session, log: withoutChips(session.log) }, entry)
    case 'resume': {
      const s: DialogSession = {
        ...session,
        log: withoutChips(session.log),
        editingKey: null,
        pending: null,
      }
      const nu = nextQuestion(entry, optsOf(s))
      return { session: nu ? ask(s, entry, nu) : s, entry }
    }
    case 'finish': {
      const s: DialogSession = { ...session, log: withoutChips(session.log) }
      // 名前が無いと登録できない（@ 参照の解決キー）。スキップやあとでにしていたら、ここで聞き直す。
      if (entry.name.trim() === '') {
        const nameQ = BASE_QUESTIONS.find((q) => q.key === 'name')
        if (!nameQ) return { session: s, entry }
        const { name: _n, ...marks } = s.baseMarks
        const ns = say(
          { ...s, baseMarks: marks, editingKey: 'name' },
          '名前が無いと登録できません。まず名前を教えてください。',
        )
        const asked = ask(ns, entry, nameQ)
        return {
          session: { ...asked, pending: { kind: 'question', key: nameQ.key, required: true } },
          entry,
        }
      }
      return { session: s, entry, effect: 'finish' }
    }
    case 'toform':
      return { session: { ...session, log: withoutChips(session.log) }, entry, effect: 'toform' }
  }
}

/** 対話ペインの「答える」以外の状態案内（入力欄の代わりに出す一言）。 */
export function pendingHint(session: DialogSession): string | null {
  switch (session.pending?.kind) {
    case 'category':
      return '上の分類から選んでください。'
    case 'pick':
      return '変えたい項目を選ぶか、右のボタンで戻ります。'
    case 'dig-offer':
      return '「もう少し深める」で追い質問に進みます。「次へ」で先へ。'
    default:
      return null
  }
}

/** 入力欄の下に添える、公開の扱いの一言（D-DLG-VIS）。 */
export function visibilityHint(q: DialogQuestion): string {
  switch (q.vis) {
    case 'public-fixed':
      return 'この答えは読者に見えます'
    case 'private-fixed':
      return 'この答えは作者だけが見ます'
    case 'switch-public':
      return '最初から「読者に見せる」です。作者だけに戻せます'
    default:
      return '答えたあとに「読者に見せる」へ切り替えられます'
  }
}

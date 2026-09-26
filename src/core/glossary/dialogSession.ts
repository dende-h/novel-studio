import type { DialogAnswer, GlossaryEntry } from '../schema'
import {
  type AnsweredOptions,
  type AnyDialogQuestion,
  activeQuestionsFor,
  answerOf,
  answerPublic,
  answersOf,
  DIALOG_CATEGORIES,
  type DialogQuestion,
  dialogStarted,
  dialogSummaryOf,
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
 * 遷移は `{ session, entry }` を返す。entry が変わったとき（答え・分類）は、呼び出し側が保存する。
 * 新しい項目は**名前を答えた時点で用語集に登録され**、以後は答えるたびに保存される（D-DLG-ENTRY）。
 * 登録前（名前がまだ無い）のあいだだけ `unsaved` で、その間の答えは画面が手元に持つ。
 */

export type ChipAction =
  | 'category'
  | 'choice'
  | 'skip'
  | 'pick'
  | 'reopen'
  | 'dig'
  | 'digskip'
  | 'resume'
  | 'toform'

export interface DialogChip {
  label: string
  action: ChipAction
  value?: string
  primary?: boolean
  ghost?: boolean
  /** 未回答の印（破線）。 */
  blank?: boolean
  /** ラベルの右に添える小さな注記（「未回答」「深める」）。 */
  note?: string
}

/** ログの 1 件。`id` は会話の中で一意（画面の key。並び替え・消去があっても安定）。 */
export type DialogMessage = { id: number } & DialogMessageBody
export type DialogMessageBody =
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
  | { kind: 'question'; key: string }
  | { kind: 'category' }
  | { kind: 'pick' }
  | { kind: 'dig-offer'; key: string }

export interface DialogSession {
  /** 共通 4 問（名前・読み・別名・公開情報）も聞く（新しく作った項目）。既存の項目では聞かない。 */
  askBase: boolean
  /** まだ用語集に登録していない（名前を答えると登録される）。 */
  unsaved: boolean
  log: DialogMessage[]
  pending: DialogPending | null
  /** 「直す」で聞き直している鍵。答えると本流（次の未回答）へ戻る（D-DLG-EDIT）。 */
  editingKey: string | null
  /** 直前に案内したまとまり（切り替わりでだけ案内する）。 */
  lastSection: string | null
  /** 共通 4 問をスキップした印（欄には残らないので、ここで持つ）。 */
  baseMarks: Record<string, 'skipped'>
  /** 次に振るログの id。 */
  nextId: number
  /** 問いを出した回数。画面は入力欄をこれで作り直す（問いが出るたびに空で、拒否では残す）。 */
  promptId: number
}

export type SessionEffect = 'toform'

export interface SessionStep {
  session: DialogSession
  entry: GlossaryEntry
  /** 画面側の操作（フォームへ戻る）。 */
  effect?: SessionEffect
}

const optsOf = (s: DialogSession): AnsweredOptions => ({
  askBase: s.askBase,
  baseMarks: s.baseMarks,
})

/** チップは常に「いまの問いかけ」なので、次の遷移で消す。 */
const withoutChips = (log: DialogMessage[]) => log.filter((m) => m.role !== 'chips')
const push = (s: DialogSession, m: DialogMessageBody): DialogSession => ({
  ...s,
  log: [...s.log, { id: s.nextId, ...m }],
  nextId: s.nextId + 1,
})
const say = (s: DialogSession, text: string): DialogSession => push(s, { role: 'bot', text })
/** 答えの吹き出しは鍵ごとに 1 つ＝聞き直したら前の吹き出しを消して、最新だけ残す。 */
const pushAnswer = (s: DialogSession, m: DialogMessageBody & { role: 'user'; key: string }) =>
  push({ ...s, log: s.log.filter((x) => !(x.role === 'user' && x.key === m.key)) }, m)
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

/** 名前を答えて用語集に登録されたあとの会話（同じ会話を、登録された項目で続ける）。 */
export function markSaved(session: DialogSession): DialogSession {
  return session.unsaved ? { ...session, unsaved: false } : session
}

/** 分類を聞く（新規・分類が対話の質問を持たないとき）。 */
const categoryChips = (): DialogChip[] =>
  DIALOG_CATEGORIES.map((c) => ({ label: c, action: 'category', value: c }))

function askCategory(s: DialogSession, lead: string): DialogSession {
  let next = say(s, lead)
  next = { ...next, pending: { kind: 'category' } }
  return chips(next, categoryChips())
}

/** 1 問を聞く（まとまりの切り替わりで案内・名前を差し込む・追い質問は ↳）。 */
function ask(s: DialogSession, entry: GlossaryEntry, q: AnyDialogQuestion): DialogSession {
  let next = s
  if (!isDigQuestion(q) && !s.editingKey && q.section !== s.lastSection) {
    // 数は進み具合と同じ「基本の問い」で言い、任意があれば添える。答え済み（名前が先に入っている・
    // 途中から）があれば「残り」で言う＝これから聞く数と合う。
    const o = optsOf(s)
    const inSection = activeQuestionsFor(entry).filter((x) => x.section === q.section)
    const core = inSection.filter((x) => !x.optional)
    const remaining = core.filter((x) => !isAnswered(entry, x, o) && !isLater(entry, x, o)).length
    const optional = inSection.length - core.length
    const count = remaining < core.length ? `残り ${remaining} 問` : `${core.length} 問`
    next = say(
      next,
      optional > 0
        ? `ここから「${q.section}」について ${count}です（ほかに任意が ${optional} 問）。`
        : `ここから「${q.section}」について ${count}です。`,
    )
    next = { ...next, lastSection: q.section }
  }
  next = say(next, `${isDigQuestion(q) ? '↳ ' : ''}${questionText(q, entry)}`)
  return { ...next, pending: { kind: 'question', key: q.key }, promptId: next.promptId + 1 }
}

/** どれを変えるかを選ばせる（全問答え済み・直すの入口）。 */
function askPick(s: DialogSession, entry: GlossaryEntry, lead: string | null): DialogSession {
  let next = lead ? say(s, lead) : s
  next = { ...next, pending: { kind: 'pick' } }
  const o = optsOf(next)
  const items: DialogChip[] = []
  for (const q of activeQuestionsFor(entry)) {
    // 共通 4 問は新しい項目でだけ。名前は登録後はフォームの見出しで直す（改名は別名の退避を伴う）。
    if (q.field !== undefined && (!next.askBase || (q.field === 'name' && !next.unsaved))) continue
    const later = isLater(entry, q, o)
    const blank = !isAnswered(entry, q, o) || later
    items.push({
      label: q.label,
      action: 'pick',
      value: q.key,
      blank,
      ...(blank ? { note: '未回答' } : {}),
    })
    // 追い質問は本流に無いので、ここが戻る道。答えた親の追い質問で、まだ答えていないもの
    // （「次へ」で飛ばした）を並べる。答え済みは親の「直す」から辿れる。
    if (isAnswered(entry, q, o) && !later) {
      for (const d of digQuestionsOf(q)) {
        if (isAnswered(entry, d, o)) continue
        items.push({
          label: `↳ ${d.label}`,
          action: 'pick',
          value: d.key,
          blank: true,
          note: '深める',
        })
      }
    }
  }
  const nu = nextQuestion(entry, o)
  if (nu) items.push({ label: 'つづきの質問へ', action: 'resume', primary: true })
  items.push({ label: 'フォームに戻る', action: 'toform', primary: !nu })
  return chips(next, items)
}

/** 答え済みの吹き出しをログに並べ直す（再開・直すのとき）。 */
function replay(s: DialogSession, entry: GlossaryEntry): DialogSession {
  let next = s
  for (const q of activeQuestionsFor(entry)) {
    if (q.field !== undefined) continue
    const a = answerOf(entry.dialog, q.key)
    if (!a) continue
    next = push(next, userMessage(q, a))
    for (const d of digQuestionsOf(q)) {
      const da = answerOf(entry.dialog, d.key)
      if (da) next = push(next, userMessage(d, da))
    }
  }
  return next
}

function userMessage(q: AnyDialogQuestion, a: DialogAnswer): DialogMessageBody {
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

const INTRO_HOW = [
  '読者に見せるかどうかは、答えごとに選べます。答えの中で @ か [[ と打つと、用語集の項目を呼び出せます。答えたあとに「もう少し深める」を押すと、追い質問が続きます。',
  '答えはフォームの「対話ノート」からも直せます。「対話を終える」でいつでもフォームに戻れ、続きは「対話をつづける」から。',
]

/** 対話を始める（開いた項目の状態に合わせて、続きから・どれを変えるか）。 */
export function beginSession(
  entry: GlossaryEntry,
  opts: { askBase: boolean; unsaved?: boolean; baseMarks?: DialogSession['baseMarks'] },
): DialogSession {
  let s: DialogSession = {
    askBase: opts.askBase,
    unsaved: opts.unsaved ?? false,
    log: [],
    pending: null,
    editingKey: null,
    lastSection: null,
    // 分類を変えて始め直すときは、共通 4 問のスキップの印を引き継ぐ（同じことを二度聞かない）。
    baseMarks: { ...(opts.baseMarks ?? {}) },
    nextId: 1,
    promptId: 0,
  }
  if (opts.askBase) {
    s = say(
      s,
      s.unsaved
        ? '新しい項目を作ります。決まった質問を順にお聞きしますので、ひとつずつ答えてください。名前を答えた時点で用語集に登録され、そのあとは答えるたびに保存されます。'
        : `「${entry.name}」を用語集に登録しました。決まった質問を順にお聞きしますので、ひとつずつ答えてください。答えるたびに保存されます。`,
    )
    for (const t of INTRO_HOW) s = say(s, t)
    // フォームで先に分類を選んであれば聞かない（同じことを二度聞かない）。
    if (!hasDialogQuestions(entry.category)) return askCategory(s, 'どの分類の項目ですか。')
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
  const p = dialogSummaryOf(entry).progress
  if (!dialogStarted(entry)) {
    s = push(s, { role: 'card-base' })
    s = say(
      s,
      `${entry.name} の名前・読み・別名・公開情報は入っているので、その先から聞きます。基本の質問は ${p.total} 問です（任意の問いは数に入れません）。読者に見せるかどうかは、答えごとに選べます。答えるたびに保存されます。`,
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
    s = say(s, `${entry.name} は答えていない問いが ${p.later} つあります。`)
    return askPick(replay(s, entry), entry, '答えますか。')
  }
  s = say(s, `${entry.name} は全部の質問に答えてあります。どれを変えますか。`)
  return askPick(replay(s, entry), entry, null)
}

/**
 * 答えを受け付けなかった・保存に失敗したときの一言。待っている状態はそのままにし、
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
      return chips(s, categoryChips())
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
    // 分類を変える前の答えが残っていれば（持ち越し・MCP）、並べ直してから続きを聞く。
    if (dialogStarted(next)) ns = replay(ns, next)
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
  // 名前・別名の重複（D-GLOS-UNIQUE）は保存時にも弾かれるが、対話の途中で分かるほうが直しやすい。
  if ((q.field === 'name' || q.field === 'aliases') && ctx.entries) {
    const others = ctx.entries.filter((e) => e.id !== entry.id)
    const keys = q.field === 'name' ? [text] : parseAliasInput(text)
    const hit = keys.find((k) => resolveRef(k, others) !== undefined)
    if (hit !== undefined) {
      return {
        session: rejectAnswer(
          s,
          q.field === 'name'
            ? `「${hit}」は用語集にもうあります。別の名前を教えてください。`
            : `「${hit}」は用語集にもうあります。別名から外すか、別の呼び方にしてください。`,
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
  const prev = answerOf(entry.dialog, q.key)
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
  if (q.field === 'name') {
    // 登録前なら名前で登録される。登録後の「直す」は改名（前の名前は別名に退避される）。
    ns = say(
      ns,
      s.unsaved
        ? `「${text}」を用語集に登録しました。ここからは答えるたびに保存されます。`
        : `名前を「${text}」に直しました。前の名前は別名に残ります。`,
    )
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

/** スキップ（その問いを飛ばす。あとから「答えを直す」で戻れる）。 */
export function skipQuestion(session: DialogSession, entry: GlossaryEntry): SessionStep {
  const s: DialogSession = { ...session, log: withoutChips(session.log) }
  if (s.pending?.kind !== 'question') return { session: s, entry }
  const q = questionByKey(entry.category, s.pending.key)
  if (!q) return { session: { ...s, pending: null }, entry }
  // 名前は登録に要る（@ 参照の解決キー）。飛ばせない。
  if (q.field === 'name' && entry.name.trim() === '') {
    return {
      session: rejectAnswer(
        s,
        '名前は用語集の登録に必要なので、飛ばせません。名前を教えてください。',
        entry,
      ),
      entry,
    }
  }
  // 「直す」で聞き直しているときのスキップは「そのままにする」＝答えを消さない。
  if (s.editingKey === q.key && (answersOf(entry)[q.key]?.text.trim() ?? '') !== '') {
    return after(say(s, 'そのままにします。'), entry, { silent: true })
  }
  let next = entry
  let ns = s
  if (q.field !== undefined) {
    ns = { ...ns, baseMarks: { ...ns.baseMarks, [q.key]: 'skipped' } }
  } else {
    next = withDialogAnswer(entry, q, { text: '', skipped: true })
  }
  ns = pushAnswer(ns, {
    role: 'user',
    key: q.key,
    label: q.label,
    text: '',
    skipped: true,
    ...(isDigQuestion(q) ? { isDig: true } : {}),
  })
  if (isDigQuestion(q)) return afterDig(ns, next, q)
  return after(ns, next)
}

/** 同じ親の、まだ答えていない追い質問があれば続ける。 */
function afterDig(s: DialogSession, entry: GlossaryEntry, q: AnyDialogQuestion): SessionStep {
  const parent = isDigQuestion(q) ? questionByKey(entry.category, q.parentKey) : undefined
  const rest = parent ? digQuestionsOf(parent).filter((d) => !answerOf(entry.dialog, d.key)) : []
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
  // 古いデータの「あとで」（今の画面では作らない）は、まとめのあとに並べて戻る道にする。
  const later = laterQuestionsOf(entry, o)
  ns = say(
    ns,
    later.length > 0
      ? `ひと通り聞きました。答えていない問いが ${later.length} つあります。今答えても、あとで戻ってきても構いません。`
      : 'ひと通り聞きました。まとめはこちらです。飛ばした問いは「答えを直す」から答えられます。',
  )
  ns = push(ns, { role: 'card' })
  ns = { ...ns, pending: { kind: 'pick' } }
  const items: DialogChip[] = later.map((q) => ({
    label: `${isDigQuestion(q) ? '↳ ' : ''}${q.label}`,
    action: 'pick',
    value: q.key,
    blank: true,
    note: '未回答',
  }))
  items.push({ label: '答えを直す', action: 'reopen' })
  items.push({ label: 'フォームで確かめる', action: 'toform', primary: true })
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
      return skipQuestion(session, entry)
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
      // つづきが無くなっていたら（同期で埋まった等）選び直しへ＝行き止まりにしない。
      return { session: nu ? ask(s, entry, nu) : askPick(s, entry, null), entry }
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
      return '変えたい項目を選ぶか、「フォームに戻る」で戻ります。'
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

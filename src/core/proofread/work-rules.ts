import { z } from 'zod'
import type { ProofreadRecord } from './decisions'
import { type Finding, formDisplay, type VariantRef } from './types'
import { variantFormOf } from './variants'

/**
 * 推敲の作品の決まり（COT-62）。作品ごとに1件（kv `proofread-rules:<workId>`）。
 * - 例外：この作品ではこの言葉を指摘しない（ら抜き言葉・同じ語の連続は言葉ごと、表記ゆれは組ごと＝書き分けを許す）
 * - 表記の好み：表記ゆれの組をどの書き方にそろえるか
 * - 提案しない言葉：「提案しない」を押した提案（戻すまで同じ提案を出さない）
 * 新設なので核の欄（workId・updatedAt）は必須、中の配列は省略できる。決まりを消すのは「戻す」と作品の完全削除だけ。
 * 推敲の判断の記録（decisions.ts）には触れない。
 */
export const RuleExceptionSchema = z.object({
  /** 'ra-nuki:<ら抜きの原形>' / 'successive-word:<文字列>' / 'variant:<組>' */
  key: z.string(),
  /** 一覧の表示名（見れる・言った言った・子供・子ども・「人」の数）。 */
  label: z.string(),
  /** 表記ゆれの組の書き方（自動の組は、組のキーが変わっても書き方の集合で当てる）。 */
  forms: z.array(z.string()).optional(),
  at: z.number(),
})
export type RuleException = z.infer<typeof RuleExceptionSchema>

export const RulePreferenceSchema = z.object({
  /** 'dict:<VariantGroup.id>'（数は 'dict:numeral:<助数詞>'）/ 'auto:<原形を並べたもの>' */
  group: z.string(),
  /** そろえる先（辞書の組は書き方の名前、数は '算用'／'漢数字'、自動の組は原形）。 */
  preferred: z.string(),
  forms: z.array(z.string()),
  /** 数の書き方なら助数詞（表示用）。 */
  numeral: z.string().optional(),
  at: z.number(),
})
export type RulePreference = z.infer<typeof RulePreferenceSchema>

export const DeclinedSuggestionSchema = z.object({
  /** 'exception' | 'preference' */
  kind: z.string(),
  /** 例外の提案は例外のキー、表記の好みの提案は '<組>|<直した書き方>'。 */
  key: z.string(),
  label: z.string(),
  at: z.number(),
})
export type DeclinedSuggestion = z.infer<typeof DeclinedSuggestionSchema>

export const ProofreadRulesSchema = z.object({
  workId: z.string(),
  exceptions: z.array(RuleExceptionSchema).optional().default([]),
  preferences: z.array(RulePreferenceSchema).optional().default([]),
  declined: z.array(DeclinedSuggestionSchema).optional().default([]),
  /** 同期の LWW に使う（ProofreadRecordSchema と同じ）。 */
  updatedAt: z.number(),
})
export type ProofreadRules = z.infer<typeof ProofreadRulesSchema>

/** 指摘を作るときに渡す決まり（proofreadNovel の `rules`）。 */
export interface WorkRules {
  exceptions: ReadonlyArray<RuleException>
  preferences: ReadonlyArray<RulePreference>
}

const empty = (workId: string, now: number): ProofreadRules => ({
  workId,
  exceptions: [],
  preferences: [],
  declined: [],
  updatedAt: now,
})

/** 指摘を作るときに渡す形（記録が無ければ決まりなし）。 */
export function workRulesOf(record: ProofreadRules | undefined): WorkRules {
  return { exceptions: record?.exceptions ?? [], preferences: record?.preferences ?? [] }
}

const isAuto = (group: string) => group.startsWith('auto:')
const overlaps = (a: ReadonlyArray<string> | undefined, b: ReadonlyArray<string>) =>
  (a ?? []).some((x) => b.includes(x))

/** 表記ゆれの組が同じか（自動の組は、書き方が増えて組のキーが変わっても、書き方が重なれば同じ組とみなす）。 */
function sameGroup(
  a: { group: string; forms?: ReadonlyArray<string> },
  b: { group: string; forms: ReadonlyArray<string> },
): boolean {
  if (a.group === b.group) return true
  return isAuto(a.group) && isAuto(b.group) && overlaps(a.forms, b.forms)
}

/** 例外がこの指摘に当たるか。 */
export function exceptionMatches(x: RuleException, f: Finding): boolean {
  if (f.rule && x.key === f.rule.key) return true
  const v = f.variant
  return Boolean(
    v && isAuto(v.group) && x.key.startsWith('variant:auto:') && x.forms?.includes(v.form),
  )
}

/** 例外に当たる指摘を取り除く（決まりが無ければそのまま返す）。 */
export function applyExceptions(
  findings: ReadonlyArray<Finding>,
  exceptions: ReadonlyArray<RuleException>,
): Finding[] {
  if (exceptions.length === 0) return [...findings]
  return findings.filter((f) => !exceptions.some((x) => exceptionMatches(x, f)))
}

/** この指摘から例外を作れるか（ら抜き言葉・同じ語の連続・表記ゆれ）。 */
export const canExcept = (f: Finding): boolean => Boolean(f.rule)

/** 例外を足す。表記ゆれなら同じ組の好みを消す（同じ組に例外と好みを同時に持たない）。 */
export function addException(
  record: ProofreadRules | undefined,
  workId: string,
  f: Finding,
  now: number,
): ProofreadRules {
  const base = record ?? empty(workId, now)
  if (!f.rule) return base
  const rule = f.rule
  if (base.exceptions.some((x) => x.key === rule.key)) return base
  const v = f.variant
  return {
    ...base,
    exceptions: [
      ...base.exceptions,
      { key: rule.key, label: rule.label, ...(v ? { forms: [...v.forms] } : {}), at: now },
    ],
    preferences: v ? base.preferences.filter((p) => !sameGroup(p, v)) : base.preferences,
    updatedAt: now,
  }
}

/** 表記の好みを決める。同じ組の好みと例外（書き分け）は置き換える。 */
export function setPreference(
  record: ProofreadRules | undefined,
  workId: string,
  variant: VariantRef,
  preferred: string,
  now: number,
): ProofreadRules {
  const base = record ?? empty(workId, now)
  const cur = base.preferences.find((p) => sameGroup(p, variant))
  if (cur && cur.preferred === preferred && cur.group === variant.group) return base
  return {
    ...base,
    preferences: [
      ...base.preferences.filter((p) => !sameGroup(p, variant)),
      {
        group: variant.group,
        preferred,
        forms: [...variant.forms],
        ...(variant.numeral ? { numeral: variant.numeral } : {}),
        at: now,
      },
    ],
    exceptions: base.exceptions.filter(
      (x) =>
        x.key !== `variant:${variant.group}` &&
        !(
          isAuto(variant.group) &&
          x.key.startsWith('variant:auto:') &&
          overlaps(x.forms, variant.forms)
        ),
    ),
    updatedAt: now,
  }
}

/** 一覧の1行の id（例外はキー、表記の好みは 'pref:<組>'）。 */
export const preferenceRowId = (p: Pick<RulePreference, 'group'>) => `pref:${p.group}`

/** 決まりを1件戻す（一覧の「戻す」）。当たらなければ同じ参照を返す。 */
export function removeRule(record: ProofreadRules, rowId: string, now: number): ProofreadRules {
  const exceptions = record.exceptions.filter((x) => x.key !== rowId)
  const preferences = record.preferences.filter((p) => preferenceRowId(p) !== rowId)
  if (
    exceptions.length === record.exceptions.length &&
    preferences.length === record.preferences.length
  ) {
    return record
  }
  return { ...record, exceptions, preferences, updatedAt: now }
}

/** 一覧の1行。 */
export interface RuleRow {
  id: string
  /** 中身（「見れる」・「子ども」にそろえる（子供・子ども）など）。 */
  text: string
  /** 理由（例外と書き分けだけ）。 */
  reason?: string
}

/** 一覧の行（例外 → 表記の好みの順、それぞれ決めた順）。 */
export function ruleRows(record: ProofreadRules | undefined): RuleRow[] {
  if (!record) return []
  const rows: RuleRow[] = []
  for (const x of record.exceptions) {
    const reason = x.key.startsWith('ra-nuki:')
      ? 'ら抜き言葉は指摘しない'
      : x.key.startsWith('successive-word:')
        ? '同じ語の連続は指摘しない'
        : '書き分けを許す'
    rows.push({ id: x.key, text: `「${x.label}」`, reason })
  }
  for (const p of record.preferences) {
    rows.push({
      id: preferenceRowId(p),
      text: p.numeral
        ? `「${p.numeral}」の数は${formDisplay(p, p.preferred)}にそろえる`
        : `「${p.preferred}」にそろえる（${p.forms.join('・')}）`,
    })
  }
  return rows
}

/** 提案（COT-62 FR-4）。 */
export type RuleSuggestion =
  | {
      kind: 'exception'
      /** 例外のキー（提案しない言葉のキーも同じ）。 */
      key: string
      label: string
      count: number
      finding: Finding
    }
  | {
      kind: 'preference'
      /** '<組>|<直した書き方>'（提案しない言葉のキー）。 */
      key: string
      variant: VariantRef
      /** 直した書き方。 */
      from: string
      /** そろえる先の候補（直した書き方を除く）。 */
      to: string[]
      count: number
    }

/** 例外の提案の線（同じ言葉を全話で「このまま」にした回数）。 */
export const EXCEPTION_SUGGEST_AT = 3
/** 表記の好みの提案の線（同じ組の同じ書き方を全話で「直す」にした回数）。 */
export const PREFERENCE_SUGGEST_AT = 2

/**
 * 直前の判断から、決まりの提案を作る（直前の判断が線を超えたときだけ）。勝手に決まりは作らない。
 * - 例外：ら抜き言葉・同じ語の連続で、同じ code・text の「このまま」が全話で3件以上
 * - 表記の好み：表記ゆれで、同じ組・同じ書き方の「直す」が全話で2件以上。辞書の組と数は判断の文字列を
 *   書き方に当て直して数え（variantFormOf）、自動の組は文字列で数える
 * - すでに決まりがある言葉・組と、提案しない言葉は出さない
 */
export function suggestRule(input: {
  last: { finding: Finding; verdict: string } | null
  records: ReadonlyArray<ProofreadRecord>
  rules: ProofreadRules | undefined
}): RuleSuggestion | null {
  const { last, records, rules } = input
  if (!last) return null
  const f = last.finding
  const declined = new Set((rules?.declined ?? []).map((d) => d.key))
  const decisions = records.flatMap((r) => r.decisions)

  if (last.verdict === 'keep' && f.rule && (f.code === 'ra-nuki' || f.code === 'successive-word')) {
    const key = f.rule.key
    if (declined.has(key) || (rules?.exceptions ?? []).some((x) => x.key === key)) return null
    const count = decisions.filter(
      (d) => d.code === f.code && d.text === f.text && d.verdict === 'keep',
    ).length
    if (count < EXCEPTION_SUGGEST_AT) return null
    return { kind: 'exception', key, label: f.rule.label, count, finding: f }
  }

  if (last.verdict === 'fix' && f.variant) {
    const v = f.variant
    const key = `${v.group}|${v.form}`
    if (declined.has(key)) return null
    if ((rules?.preferences ?? []).some((p) => sameGroup(p, v))) return null
    if ((rules?.exceptions ?? []).some((x) => exceptionMatches(x, f))) return null
    const isDict = v.group.startsWith('dict:')
    const count = decisions.filter(
      (d) =>
        d.code === 'variant' &&
        d.verdict === 'fix' &&
        (isDict ? variantFormOf(v.group, d.text) === v.form : d.text === f.text),
    ).length
    if (count < PREFERENCE_SUGGEST_AT) return null
    const to = v.forms.filter((x) => x !== v.form)
    if (to.length === 0) return null
    return { kind: 'preference', key, variant: v, from: v.form, to, count }
  }
  return null
}

/** 提案の文。 */
export function suggestionText(s: RuleSuggestion): string {
  if (s.kind === 'exception') {
    return `「${s.label}」を${s.count}回このままにしました。この作品では指摘しないようにしますか？`
  }
  const v = s.variant
  if (v.numeral) {
    const to = s.to.length === 1 ? formDisplay(v, s.to[0] as string) : 'どちらか'
    return `${formDisplay(v, s.from)}の「${v.numeral}」を${s.count}回直すと決めました。この作品の「${v.numeral}」は${to}にそろえますか？`
  }
  return s.to.length === 1
    ? `「${s.from}」を${s.count}回直すと決めました。この作品は「${s.to[0]}」にそろえますか？`
    : `「${s.from}」を${s.count}回直すと決めました。この作品の表記をそろえますか？`
}

/** 提案しない（戻すまで同じ提案を出さない）。 */
export function decline(
  record: ProofreadRules | undefined,
  workId: string,
  s: RuleSuggestion,
  now: number,
): ProofreadRules {
  const base = record ?? empty(workId, now)
  if (base.declined.some((d) => d.key === s.key)) return base
  const label =
    s.kind === 'exception'
      ? s.label
      : s.variant.numeral
        ? `${formDisplay(s.variant, s.from)}の「${s.variant.numeral}」`
        : s.from
  return {
    ...base,
    declined: [...base.declined, { kind: s.kind, key: s.key, label, at: now }],
    updatedAt: now,
  }
}

/** 提案しない言葉を戻す。 */
export function undecline(record: ProofreadRules, key: string, now: number): ProofreadRules {
  if (!record.declined.some((d) => d.key === key)) return record
  return { ...record, declined: record.declined.filter((d) => d.key !== key), updatedAt: now }
}

import { z } from 'zod'
import { plainTextOfBlock } from '../game'
import { plainOffsetMap } from '../parser/parseNotation'
import type { Block } from '../schema'
import type { Finding } from './types'

/**
 * 推敲の判断（直す／このまま）と、執筆画面の「直す箇所」の計算（COT-40）。
 *
 * - 判断は本文の外に話ごとに保存する（`proofread:<workId>:<episodeId>`）。Work 等のスキーマは変えない。
 * - 指摘との照合はキー `blockId|code|text|nth`（nth＝同じ段落・同じ項目・同じ文字列の指摘の何番目か）。
 * - 「直す箇所」の判定と位置決めは `occurrence`（判断した時点で、段落のプレーン文字列に現れる同じ文字列の
 *   中での通し番号。指摘かどうかを問わず、重なり合う出現も数える）で行う。ルールの当て直しは要らない。
 * - 未知の値（code・verdict・anchor）も捨てずに持つ。判断が消えるのは明示の操作と作品の完全削除だけ。
 */
export const ProofreadDecisionSchema = z.object({
  blockId: z.string(),
  code: z.string(),
  text: z.string(),
  nth: z.number().int().nonnegative().optional().default(0),
  occurrence: z.number().int().nonnegative().optional(),
  anchor: z.string().optional().default('contains'),
  verdict: z.string(),
  message: z.string().optional(),
  decidedAt: z.number(),
})
export type ProofreadDecision = z.infer<typeof ProofreadDecisionSchema>

export const ProofreadRecordSchema = z.object({
  workId: z.string(),
  episodeId: z.string(),
  decisions: z.array(ProofreadDecisionSchema).optional().default([]),
  /** 同期の LWW に使う（StagingSchema と同じ）。 */
  updatedAt: z.number(),
})
export type ProofreadRecord = z.infer<typeof ProofreadRecordSchema>

export type Verdict = 'fix' | 'keep'

export type FindingN = Finding & { nth: number }

/** 判断の種類（未知の値は判断なし）。 */
export function verdictOf(d: ProofreadDecision): Verdict | null {
  return d.verdict === 'fix' || d.verdict === 'keep' ? d.verdict : null
}

const keyOf = (blockId: string, code: string, text: string, nth: number) =>
  `${blockId}\u0000${code}\u0000${text}\u0000${nth}`

export const findingKey = (f: FindingN) => keyOf(f.blockId, f.code, f.text, f.nth)
export const decisionKey = (d: ProofreadDecision) => keyOf(d.blockId, d.code, d.text, d.nth)

/** 同じ段落・同じ項目・同じ文字列の指摘に、位置の順で 0 始まりの番号を振る。 */
export function withNth(findings: ReadonlyArray<Finding>): FindingN[] {
  const seen = new Map<string, number>()
  const ordered = [...findings].sort((a, b) => a.blockIndex - b.blockIndex || a.start - b.start)
  const nthOf = new Map<Finding, number>()
  for (const f of ordered) {
    const k = keyOf(f.blockId, f.code, f.text, 0)
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    nthOf.set(f, n)
  }
  return findings.map((f) => ({ ...f, nth: nthOf.get(f) ?? 0 }))
}

/** 文字列の出現位置を、1 文字ずつずらして探す（重なり合う出現もそれぞれ数える）。 */
export function occurrencesOf(needle: string, hay: string): number[] {
  if (!needle) return []
  const out: number[] = []
  let at = hay.indexOf(needle)
  while (at !== -1) {
    out.push(at)
    at = hay.indexOf(needle, at + 1)
  }
  return out
}

/** 指摘に判断を当てて、未判断・直す・このままに分ける（並びは入力の順）。 */
export function classify(
  findings: ReadonlyArray<FindingN>,
  record: ProofreadRecord | undefined,
): { pending: FindingN[]; fix: FindingN[]; keep: FindingN[] } {
  const byKey = new Map<string, ProofreadDecision>()
  for (const d of record?.decisions ?? []) byKey.set(decisionKey(d), d)
  const out = { pending: [] as FindingN[], fix: [] as FindingN[], keep: [] as FindingN[] }
  for (const f of findings) {
    const d = byKey.get(findingKey(f))
    const v = d ? verdictOf(d) : null
    out[v ?? 'pending'].push(f)
  }
  return out
}

function emptyRecord(workId: string, episodeId: string, now: number): ProofreadRecord {
  return { workId, episodeId, decisions: [], updatedAt: now }
}

/**
 * 指摘に判断を付ける（既にあれば置き換える）。他の判断には触らない。入力は書き換えない。
 * blocks は保存済みの話の段落。occurrence は指摘の段落のプレーン文字列から数える。
 */
export function decide(
  record: ProofreadRecord | undefined,
  ids: { workId: string; episodeId: string },
  findings: ReadonlyArray<FindingN>,
  verdict: Verdict,
  now: number,
  blocks: ReadonlyArray<Block>,
): ProofreadRecord {
  const base = record ?? emptyRecord(ids.workId, ids.episodeId, now)
  const keys = new Set(findings.map(findingKey))
  const plainOf = new Map<string, string>()
  for (const b of blocks) plainOf.set(b.id, plainTextOfBlock(b))
  const added: ProofreadDecision[] = findings.map((f) => ({
    blockId: f.blockId,
    code: f.code,
    text: f.text,
    nth: f.nth,
    occurrence:
      f.anchor === 'lineStart'
        ? 0
        : occurrencesOf(f.text, plainOf.get(f.blockId) ?? '').filter((i) => i < f.start).length,
    anchor: f.anchor,
    verdict,
    message: f.message,
    decidedAt: now,
  }))
  return {
    ...base,
    decisions: [...base.decisions.filter((d) => !keys.has(decisionKey(d))), ...added],
    updatedAt: now,
  }
}

/** 判断を外す（未判断に戻す）。指摘・判断のどちらでも、同じキーの判断を消す。 */
export function undecide(
  record: ProofreadRecord,
  target: FindingN | ProofreadDecision,
  now: number,
): ProofreadRecord {
  const key = 'decidedAt' in target ? decisionKey(target) : findingKey(target)
  return {
    ...record,
    decisions: record.decisions.filter((d) => decisionKey(d) !== key),
    updatedAt: now,
  }
}

/** まだ直っていない「直す」の判断 1 件。位置は段落のプレーン文字列の UTF-16 位置。 */
export interface OpenFix {
  decision: ProofreadDecision
  blockIndex: number
  start: number
  end: number
}

/**
 * まだ直っていない「直す」の判断（段落の順・位置の順）。blocks は id 付きの下書き（reconcile 済み）。
 * 段落が無い・判断した出現が無くなった（段落の中のその文字列の数が occurrence 以下）ものは直ったとみなす。
 * 字下げ（lineStart）は段落がまだその文字で始まるかを見る。記録は消さない。
 */
export function openFixes(
  record: ProofreadRecord | undefined,
  blocks: ReadonlyArray<Block>,
): OpenFix[] {
  if (!record) return []
  const indexOf = new Map<string, number>()
  blocks.forEach((b, i) => {
    indexOf.set(b.id, i)
  })
  const out: OpenFix[] = []
  for (const d of record.decisions) {
    if (verdictOf(d) !== 'fix' || !d.text) continue
    const blockIndex = indexOf.get(d.blockId)
    if (blockIndex === undefined) continue
    const plain = plainTextOfBlock(blocks[blockIndex] as Block)
    if (d.anchor === 'lineStart') {
      if (plain.startsWith(d.text))
        out.push({ decision: d, blockIndex, start: 0, end: d.text.length })
      continue
    }
    const at = occurrencesOf(d.text, plain)[d.occurrence ?? d.nth]
    if (at !== undefined) out.push({ decision: d, blockIndex, start: at, end: at + d.text.length })
  }
  return out.sort((a, b) => a.blockIndex - b.blockIndex || a.start - b.start)
}

/**
 * 「直す箇所」を下書き（記法つきの textarea の文字列）の位置に移す。
 * 段落の行の中だけを見る。参照の中にかかるなど位置を移せないときは行全体を返し whole=true（呼び出し側がトーストを出す）。
 */
export function locateFix(
  fix: Pick<OpenFix, 'blockIndex' | 'start' | 'end'>,
  draft: string,
): { start: number; end: number; whole: boolean } {
  const lines = draft.split('\n')
  const index = Math.min(fix.blockIndex, Math.max(0, lines.length - 1))
  const lineStart = lines.slice(0, index).reduce((sum, l) => sum + l.length + 1, 0)
  const line = lines[index] ?? ''
  const whole = { start: lineStart, end: lineStart + line.length, whole: true }
  if (fix.end <= fix.start) return whole
  const { sourceOf } = plainOffsetMap(line)
  const first = sourceOf[fix.start]
  const last = sourceOf[fix.end - 1]
  if (first == null || last == null) return whole
  for (let k = fix.start; k < fix.end; k++) if (sourceOf[k] == null) return whole
  return { start: lineStart + first, end: lineStart + last + 1, whole: false }
}

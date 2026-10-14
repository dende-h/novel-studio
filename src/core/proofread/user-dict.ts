import type { GlossaryEntry } from '../schema'

/**
 * 用語集の名前と別名を、形態素解析で 1 語として扱う（COT-40）。
 * IPADIC は人名や造語を細かく割る（黒鉄城 → 黒／鉄／城）ので、ユーザー辞書に入れてから解析する。
 * 形式は lindera の IPADIC 簡易形式 `表層形,カスタム名詞,読み`。読みは用語集の「読み」（ひらがな）を
 * カタカナにしたもの。無ければ表層形をそのまま入れる（ルールは「カスタム名詞」を対象から外すので読みは使わない）。
 */
const toKatakana = (s: string) =>
  s.replace(/[ぁ-ゖ]/gu, (c) => String.fromCharCode((c.codePointAt(0) as number) + 0x60))

const csvField = (s: string) => (/[",\n\r]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s)

/** 用語集の名前・別名（前後の空白を除き、空と重複を落とす）。指摘の対象から外す語の一覧にも使う。 */
export function glossaryTerms(glossary: ReadonlyArray<GlossaryEntry>): string[] {
  const out = new Set<string>()
  for (const e of glossary) {
    for (const raw of [e.name, ...(e.aliases ?? [])]) {
      const t = raw.replace(/[\r\n]/gu, '').trim()
      if (t) out.add(t)
    }
  }
  return [...out]
}

export function glossaryUserDictCsv(glossary: ReadonlyArray<GlossaryEntry>): string {
  const rows: string[] = []
  const seen = new Set<string>()
  for (const e of glossary) {
    const reading = e.reading?.trim() ? toKatakana(e.reading.trim()) : ''
    for (const [i, raw] of [e.name, ...(e.aliases ?? [])].entries()) {
      const surface = raw.replace(/[\r\n]/gu, '').trim()
      if (!surface || seen.has(surface)) continue
      seen.add(surface)
      // 読みは名前に対する 1 つだけ（別名ごとの読みは無い）。別名は表層形をそのまま読みに置く。
      const r = i === 0 && reading ? reading : toKatakana(surface)
      rows.push([surface, 'カスタム名詞', r].map(csvField).join(','))
    }
  }
  return rows.length > 0 ? `${rows.join('\n')}\n` : ''
}

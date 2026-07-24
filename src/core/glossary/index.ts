import type { GlossaryEntry, Work } from '../schema'

/**
 * @参照 / オブジェクト辞書のコアロジック（純TS・React 非依存）。
 * 解決（resolveRef）・登場集計（findAppearances）・リネーム（renameEntry）・
 * @ サジェスト発火判定（shouldTriggerSuggest）を提供する。
 */

/**
 * ref.name を辞書 entries の name ＋ aliases（前後 trim 後の完全一致）で解決する。
 * - 大小区別あり（alice ≠ Alice）。内部空白は別物（「アリス スミス」≠「アリススミス」）。
 * - name が空（trim 後）は常に未解決。reading は解決対象外（サジェスト/ソート専用）。
 */
export function resolveRef(name: string, entries: GlossaryEntry[]): GlossaryEntry | undefined {
  const key = name.trim()
  if (key === '') return undefined
  return entries.find((e) => e.name.trim() === key || e.aliases.some((a) => a.trim() === key))
}

/**
 * 解決済み @参照名の集合を作る（プレビューの blocksToHtml(blocks, set) 用）。
 * 各 entry の name ＋ aliases を trim して非空のものだけ収める（resolveRef と同じ突合キー）。
 * これに含まれる名前を持つ ref が「解決」、含まれないものが「未解決」（点線）になる。
 */
export function resolvedNameSet(entries: GlossaryEntry[]): Set<string> {
  const set = new Set<string>()
  for (const e of entries) {
    for (const key of [e.name, ...e.aliases]) {
      const k = key.trim()
      if (k !== '') set.add(k)
    }
  }
  return set
}

export interface Appearances {
  /** entry が登場する話の id（話順・同話内重複なし）。 */
  episodeIds: string[]
  /** entry を指す ref inline の総数（同話内の複数も加算）。 */
  refCount: number
}

/**
 * Work 全体を走査し、entry（name ＋ aliases で解決される）を指す ref の登場話と総参照数を返す。
 * 解決判定は resolveRef と同一（alias 経由 ref も算入）。
 */
export function findAppearances(work: Work, entry: GlossaryEntry): Appearances {
  const episodeIds: string[] = []
  let refCount = 0
  for (const ep of work.episodes) {
    let appearsHere = false
    for (const block of ep.blocks) {
      if (block.type !== 'paragraph') continue
      for (const inline of block.inlines) {
        if (inline.type === 'ref' && resolveRef(inline.name, [entry])) {
          refCount++
          appearsHere = true
        }
      }
    }
    if (appearsHere) episodeIds.push(ep.id)
  }
  return { episodeIds, refCount }
}

export interface RenameOptions {
  /** true なら本文中の ref(旧名) を新名へ一括書換（プレーン同名 text は不変）。 */
  rewriteBody?: boolean
}

/**
 * 辞書 entry をリネームする。新しい Work を返す（不変・純関数）。
 *   ① 旧名を aliases に退避し、既存 ref が解決され続けるようにする（自動エイリアス）。
 *   ② rewriteBody=true なら本文の ref(旧名) のみ新名へ書換（別名 ref・プレーン text は不変）。
 * - newName が現在名と同値（trim 後）は no-op。
 * - newName が現 aliases にあれば昇格（旧 aliases から除き name と同値の alias を残さない）。
 * - newName が他 entry の name/alias と完全一致（衝突）する場合は拒否（throw）= D-GLOS-UNIQUE。
 */
export function renameEntry(
  work: Work,
  entryId: string,
  newName: string,
  opts: RenameOptions = {},
): Work {
  const entries = work.glossary ?? []
  const target = entries.find((e) => e.id === entryId)
  if (!target) throw new Error(`glossary entry が見つかりません: ${entryId}`)

  const oldName = target.name
  const trimmedNew = newName.trim()
  const trimmedOld = oldName.trim()

  // no-op: 新旧が同値（無駄な alias を増やさない）
  if (trimmedNew === trimmedOld) return work

  // D-GLOS-UNIQUE: 他 entry の name/alias との完全一致は拒否
  const collides = entries.some(
    (e) =>
      e.id !== entryId &&
      (e.name.trim() === trimmedNew || e.aliases.some((a) => a.trim() === trimmedNew)),
  )
  if (collides) throw new Error(`「${newName}」は既存の項目と重複しています`)

  const glossary = entries.map((e) => {
    if (e.id !== entryId) return e
    // newName が現 aliases にあれば昇格（重複を除く）
    const withoutNew = e.aliases.filter((a) => a.trim() !== trimmedNew)
    // 旧名を alias に退避（既存でなければ追加）
    const hasOld = withoutNew.some((a) => a.trim() === trimmedOld)
    const aliases = hasOld ? withoutNew : [...withoutNew, oldName]
    return { ...e, name: newName, aliases }
  })

  let episodes = work.episodes
  if (opts.rewriteBody) {
    episodes = work.episodes.map((ep) => ({
      ...ep,
      blocks: ep.blocks.map((block) => {
        if (block.type !== 'paragraph') return block
        return {
          ...block,
          inlines: block.inlines.map((inline) =>
            inline.type === 'ref' && inline.name.trim() === trimmedOld
              ? { ...inline, name: newName }
              : inline,
          ),
        }
      }),
    }))
  }

  return { ...work, glossary, episodes }
}

/** @ サジェストのトリガ文字。半角 @ と全角 ＠(U+FF20) の双方（D-GLOS-SUGGEST-TRIGGER）。 */
const TRIGGER_CHARS = new Set(['@', '＠'])
/** 「文字・数字」＝ Unicode の Letter/Number（漢字・かな・ラテン・全角数字を含む）。 */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/**
 * キャレット直前テキストから @ サジェストを発火すべきか判定する（@ の逃げ道ヒューリスティック）。
 * 末尾が @ または ＠ で、その直前が「文字・数字でない」（＝行頭/空白/句読点/記号）のとき true。
 * 直前が文字・数字（例「foo@」メール・「名前@」）なら抑制し @ を literal 扱いにする（D-GLOS-SUGGEST-TRIGGER）。
 * IME 変換中（isComposing）の抑制は UI 層の責務（この純関数はキャレット直前文字列のみで判定）。
 */
export function shouldTriggerSuggest(textBeforeCaret: string): boolean {
  const last = textBeforeCaret[textBeforeCaret.length - 1] ?? ''
  if (!TRIGGER_CHARS.has(last)) return false
  const before = textBeforeCaret.slice(0, -1)
  if (before === '') return true
  return !LETTER_OR_DIGIT.test(before[before.length - 1] ?? '')
}

/**
 * 五十音ソート用の比較キー。reading があればそれ、無ければ name（D-GLOS-SORT=name 文字コードフォールバック）。
 */
function sortKey(e: GlossaryEntry): string {
  const r = e.reading?.trim()
  return r && r.length > 0 ? r : e.name
}

/**
 * 辞書一覧の五十音ソート（純関数・元配列を変更しない）。
 * reading を持つ entry は読み順、欠落 entry は name の文字コードでフォールバック配置（D-GLOS-SORT）。
 * 比較は UTF-16 コードポイント順（かなは概ね五十音順に並ぶ）で決定的。
 */
export function sortEntries(entries: GlossaryEntry[]): GlossaryEntry[] {
  return [...entries].sort((a, b) => {
    const ka = sortKey(a)
    const kb = sortKey(b)
    if (ka < kb) return -1
    if (ka > kb) return 1
    // キー同値は name → id で安定化
    if (a.name !== b.name) return a.name < b.name ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * @ サジェスト・辞書検索のフィルタ判定。name ＋ aliases ＋ reading の部分一致（大文字小文字無視）。
 * body・category・summary は対象外（F-GLOS-INS-002 / F-GLOS-FIND）。空 query は常に true。
 */
export function matchesQuery(entry: GlossaryEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const fields = [entry.name, ...entry.aliases, entry.reading ?? '']
  return fields.some((f) => f.toLowerCase().includes(q))
}

/** @ サジェストの 1 候補（本文へ挿入する表記付き）。正式名と、query に一致する別名は別候補になる。 */
export interface RefSuggestion {
  /** 紐づく辞書 entry（表示コンテキスト用）。 */
  entry: GlossaryEntry
  /** 本文へ挿入する表記（正式名 or 別名そのもの）。別名候補を選ぶと本文はこの別名表記で入る。 */
  name: string
  /** この候補が別名か（正式名なら false）。 */
  isAlias: boolean
}

/**
 * @ サジェスト候補（D-GLOS-SUGGEST-ORDER=一致度順・前方一致優先＋上限）。正式名だけでなく、
 * query に一致する別名も **それぞれ独立した候補** として出す。別名候補を選ぶと本文にはその別名表記が
 * 入る（例: 別名「世界樹」を選ぶと `[[世界樹]]` が入り、resolveRef が別名解決するので図鑑に正しく紐づく）。
 * 正式名候補は name/reading の一致で出す。同ランクは五十音（別名は表記、正式名は reading→name）で
 * タイブレーク。空 query は正式名のみを五十音順に limit 件。
 */
export function suggestRefs(query: string, entries: GlossaryEntry[], limit = 8): RefSuggestion[] {
  const q = query.trim().toLowerCase()
  if (q === '') {
    return sortEntries(entries)
      .slice(0, limit)
      .map((entry) => ({ entry, name: entry.name, isAlias: false }))
  }

  const items: RefSuggestion[] = []
  for (const entry of entries) {
    // 正式名 or 読みが一致 → 正式名の候補。
    if (entry.name.toLowerCase().includes(q) || (entry.reading ?? '').toLowerCase().includes(q)) {
      items.push({ entry, name: entry.name, isAlias: false })
    }
    // 一致する別名はそれぞれ独立候補に（本文はこの別名表記で入る）。
    for (const alias of entry.aliases) {
      if (alias.toLowerCase().includes(q)) items.push({ entry, name: alias, isAlias: true })
    }
  }

  // 前方一致（正式名候補は reading も見る）を先に、部分一致のみを後に。
  const startsWith = (it: RefSuggestion) =>
    it.name.toLowerCase().startsWith(q) ||
    (!it.isAlias && (it.entry.reading ?? '').toLowerCase().startsWith(q))
  // 五十音キー：別名は表記、正式名は reading→name（sortKey と同じ規則）。
  const key = (it: RefSuggestion) =>
    it.isAlias ? it.name : it.entry.reading?.trim() || it.entry.name

  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const r = (startsWith(a.it) ? 0 : 1) - (startsWith(b.it) ? 0 : 1)
      if (r !== 0) return r
      const ka = key(a.it)
      const kb = key(b.it)
      if (ka !== kb) return ka < kb ? -1 : 1
      return a.i - b.i // 安定タイブレーク
    })
    .map(({ it }) => it)
    .slice(0, limit)
}

/** 辞書のカテゴリ絞り込み用に、出現するカテゴリの一覧を重複なく返す（出現順）。 */
export function categoriesOf(entries: GlossaryEntry[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of entries) {
    const c = e.category?.trim()
    if (c && !seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  return out
}

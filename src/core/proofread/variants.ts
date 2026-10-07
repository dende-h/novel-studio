/**
 * 表記ゆれ辞書（初版）と、作品全体の集計・行ごとの候補。
 *
 * 各組は「書き方（表示名＋正規表現）」の集合。活用語は語幹で取り、熟語に化ける字（事・時・所・物・様・位）は
 * 直前の活用語尾や直後の助詞で縛る。熟語は exclude で先にマスクしてから数える。
 * 数の書き方は助数詞ごとに別の組（numeral:人 …）にし、同じ助数詞で算用・漢数字の両方があるときだけ混在とする。
 * 当たり／外れの例は variants.test.ts に固定してある（docs/specs/COT-30/design.md「表記ゆれ辞書」）。
 */
export interface VariantForm {
  label: string
  /** 正規表現のソース（u フラグで構築する）。 */
  re: string
}

export interface VariantGroup {
  id: string
  forms: VariantForm[]
  exclude?: string
  kind: 'word' | 'numeral'
}

export interface VariantTally {
  count: number
  /** 作品内で最初に見つかった実例（数の書き方のメッセージ用）。 */
  example: string
}

/** 組ID → 書き方の表示名 → 集計。 */
export type VariantCounts = Record<string, Record<string, VariantTally>>

/** 直前に来る活用語尾（た・る・う・い・の・な と五段動詞の終止形）。 */
const V = '[たるういのなくすつぬぶむぐ]'
const V2 = '[たるういのくすつぬぶむぐ]'

const word = (id: string, forms: [string, string][], exclude?: string): VariantGroup => ({
  id,
  forms: forms.map(([label, re]) => ({ label, re })),
  exclude,
  kind: 'word',
})

export const COUNTERS = [
  '人',
  'つ',
  '日',
  '年',
  '月',
  '回',
  '本',
  '枚',
  '匹',
  '個',
  '歳',
  '時',
  '分',
  '階',
  '度',
  '番',
  '台',
  '冊',
  '杯',
  '件',
  '名',
  '歩',
  '秒',
] as const

const NUMERAL_EXCLUDE =
  '十分|何分|数分|大分|半分|随分|当分|多分|自分|気分|一時的|[一二三四五六七八九十百千]+分の'

export const VARIANT_GROUPS: ReadonlyArray<VariantGroup> = [
  word(
    'dekiru',
    [
      ['出来る', '出来[るたなまれず]'],
      ['できる', '(?<![んい])でき[るたなまれず]'],
    ],
    '出来事|出来心|上出来|不出来|出来高|出来栄',
  ),
  word(
    'koto',
    [
      ['事', `${V}事[がをにはもでだ]`],
      ['こと', `${V}こと[がをにはもでだ]`],
    ],
    '[仕用大無返火食家物]事|事[件情実故務業]',
  ),
  word(
    'toki',
    [
      ['時', `${V2}時[にはもを、]`],
      ['とき', `${V2}とき[にはもを、]`],
    ],
    '時[間計代期刻々折速差点]|[当同一瞬臨常日何潮]時',
  ),
  word('iu', [
    ['言う', '言[うっわえお]'],
    ['いう', '[とて]い[うっわえお]'],
  ]),
  word('teiru', [
    ['ている', '[てで]い[るたれなま]'],
    ['て居る', '[てで]居[るたれなま]'],
  ]),
  word('nai', [
    ['ない', '[がはも]ない'],
    ['無い', '[がはも]無[いくかけ]'],
  ]),
  word(
    'tame',
    [
      ['ため', 'ため[にのだ]'],
      ['為', '為[にのだ]'],
    ],
    '[行作無人]為|為[替政]',
  ),
  word(
    'you',
    [
      ['よう', `${V2}よう[にだなで]`],
      ['様', `${V2}様[にだなで]`],
    ],
    '様[子式々]|模様',
  ),
  word(
    'kurai',
    [
      ['くらい', '[くぐ]らい'],
      ['位', '[れのたるいう]位[いだでのかに]'],
    ],
    '位置|[地順単品首王学上下]位',
  ),
  word('made', [
    ['まで', 'まで'],
    ['迄', '迄'],
  ]),
  word(
    'hodo',
    [
      ['ほど', 'ほど'],
      ['程', '程'],
    ],
    '程[度遠近]|[過日工行旅射]程',
  ),
  word('sarani', [
    ['さらに', 'さらに'],
    ['更に', '更に'],
  ]),
  word('sudeni', [
    ['すでに', 'すでに'],
    ['既に', '既に'],
  ]),
  word('subete', [
    ['すべて', 'すべて'],
    ['全て', '全て'],
  ]),
  word('choudo', [
    ['ちょうど', 'ちょうど'],
    ['丁度', '丁度'],
  ]),
  word('anata', [
    ['あなた', 'あなた'],
    ['貴方', '貴方'],
  ]),
  word('kodomo', [
    ['子ども', '子ども'],
    ['子供', '子供'],
  ]),
  word('kirei', [
    ['きれい', 'きれい'],
    ['綺麗', '綺麗'],
  ]),
  word('takusan', [
    ['たくさん', 'たくさん'],
    ['沢山', '沢山'],
  ]),
  word('sasuga', [
    ['さすが', 'さすが'],
    ['流石', '流石'],
  ]),
  word(
    'tokoro',
    [
      ['ところ', `${V2}ところ[がでにをへもだ]`],
      ['所', `${V2}所[がでにをへもだ]`],
    ],
    '[場近台住箇]所|所[持属有長々]',
  ),
  word(
    'mono',
    [
      ['もの', `${V}もの[がでにをへもだ]`],
      ['物', `${V}物[がでにをへもだ]`],
    ],
    '物[語音陰事]|[動植人荷品怪建本食]物',
  ),
  word(
    'itadaku',
    [
      ['いただく', 'いただ[くきけい]'],
      ['頂く', '頂[くきけい]'],
    ],
    '頂[上点]|[絶山]頂',
  ),
  word('kudasai', [
    ['ください', 'ください'],
    ['下さい', '下さい'],
  ]),
  word(
    'itasu',
    [
      ['いたす', 'いた(?:し(?=ま)|す(?=[。、」）]|$)|せ(?=ば))'],
      ['致す', '致(?:し(?=ま)|す(?=[。、」）]|$)|せ(?=ば))'],
    ],
    '致[命死]|[一合]致',
  ),
  word('aru', [
    ['ある', '[がはも]あ[るっり]'],
    ['有る', '[がはも]有[るっり]'],
  ]),
  word(
    'yoi',
    [
      ['いい', '[がはもてでに]いい'],
      ['よい', '[がはもてでに]よ[いくかけ]'],
      ['良い', '良[いくかけ]'],
    ],
    '仲良|良[心好質品]|[改優不善]良',
  ),
  word('bokutachi', [
    ['僕たち', '僕たち'],
    ['僕達', '僕達'],
  ]),
  word('watashitachi', [
    ['私たち', '私たち'],
    ['私達', '私達'],
  ]),
  word('karera', [
    ['彼ら', '彼[女]?ら(?![しせ])'],
    ['彼等', '彼[女]?等'],
  ]),
  word('tonikaku', [
    ['とにかく', 'とにかく'],
    ['兎に角', '兎に角'],
  ]),
  word('doko', [
    ['どこ', 'どこ'],
    ['何処', '何処'],
  ]),
  word('naze', [
    ['なぜ', 'なぜ'],
    ['何故', '何故'],
  ]),
  word(
    'zehi',
    [
      ['ぜひ', 'ぜひ'],
      ['是非', '是非'],
    ],
    '是非[をもの]',
  ),
  word('hotondo', [
    ['ほとんど', 'ほとんど'],
    ['殆ど', '殆ど'],
  ]),
  word('shibaraku', [
    ['しばらく', 'しばらく'],
    ['暫く', '暫く'],
  ]),
  word('masumasu', [
    ['ますます', 'ますます'],
    ['益々', '益々'],
  ]),
  word(
    'dandan',
    [
      ['だんだん', 'だんだん'],
      ['段々', '段々'],
    ],
    '段々畑',
  ),
  word('yahari', [
    ['やはり', 'や[はっ]ぱ?り'],
    ['矢張り', '矢張り'],
  ]),
  word(
    'chotto',
    [
      ['ちょっと', 'ちょっと'],
      ['一寸', '一寸'],
    ],
    '一寸先|一寸法師',
  ),
  word('metta', [
    ['めったに', 'めった[にな]'],
    ['滅多', '滅多[にな]'],
  ]),
  ...COUNTERS.map(
    (c): VariantGroup => ({
      id: `numeral:${c}`,
      forms: [
        { label: '算用', re: `[0-9０-９]+${c}` },
        { label: '漢数字', re: `[一二三四五六七八九十百千]+${c}` },
      ],
      exclude: NUMERAL_EXCLUDE,
      kind: 'numeral',
    }),
  ),
]

const regexCache = new Map<string, RegExp>()
function re(source: string): RegExp {
  let r = regexCache.get(source)
  if (!r) {
    r = new RegExp(source, 'gu')
    regexCache.set(source, r)
  }
  r.lastIndex = 0
  return r
}

/** exclude に当たる箇所を同じ長さの \u0000 で塗りつぶす（位置を変えずに数えないため）。 */
function mask(text: string, exclude: string | undefined): string {
  if (!exclude) return text
  return text.replace(re(exclude), (m) => '\u0000'.repeat(m.length))
}

export function emptyCounts(): VariantCounts {
  return {}
}

function tally(counts: VariantCounts, groupId: string, label: string, example: string): void {
  let g = counts[groupId]
  if (!g) {
    g = {}
    counts[groupId] = g
  }
  const t = g[label]
  if (t) t.count += 1
  else g[label] = { count: 1, example }
}

/** 複数行のプレーン文字列から、組ごと・書き方ごとの件数を数える。 */
export function countVariants(texts: string[]): VariantCounts {
  const counts: VariantCounts = {}
  for (const group of VARIANT_GROUPS) {
    for (const text of texts) {
      if (!text) continue
      const masked = mask(text, group.exclude)
      for (const form of group.forms) {
        for (const m of masked.matchAll(re(form.re))) tally(counts, group.id, form.label, m[0])
      }
    }
  }
  return counts
}

/** 2 つの集計を合算する（件数は和、実例は a を優先）。どちらも書き換えない。 */
export function mergeCounts(a: VariantCounts, b: VariantCounts): VariantCounts {
  const out: VariantCounts = {}
  for (const src of [a, b]) {
    for (const [gid, forms] of Object.entries(src)) {
      let g = out[gid]
      if (!g) {
        g = {}
        out[gid] = g
      }
      for (const [label, t] of Object.entries(forms)) {
        const cur = g[label]
        g[label] = cur
          ? { count: cur.count + t.count, example: cur.example }
          : { count: t.count, example: t.example }
      }
    }
  }
  return out
}

/** 作品内で 2 つ以上の書き方が 1 件以上ある組だけを返す。 */
function mixedGroups(counts: VariantCounts): VariantGroup[] {
  return VARIANT_GROUPS.filter((g) => {
    const tallies = counts[g.id]
    if (!tallies) return false
    return Object.values(tallies).filter((t) => t.count > 0).length >= 2
  })
}

/** その行に含まれる書き方（マスク後）。 */
function formsInLine(group: VariantGroup, text: string): { form: VariantForm; example: string }[] {
  const masked = mask(text, group.exclude)
  const out: { form: VariantForm; example: string }[] = []
  for (const form of group.forms) {
    const m = re(form.re).exec(masked)
    if (m) out.push({ form, example: m[0] })
  }
  return out
}

function joinLabels(labels: string[]): string {
  const quoted = labels.map((l) => `「${l}」`)
  return quoted.length === 2 ? quoted.join('と') : quoted.join('・')
}

/**
 * 1 行分の表記ゆれ候補。語の組は組ごとに 1 件、数の書き方は助数詞をまとめて 1 件。
 * counts は作品全体（他の話＋いまの話）の集計。
 */
export function variantNoticesForLine(text: string, counts: VariantCounts): string[] {
  if (!text.trim()) return []
  const messages: string[] = []
  const numeralParts: string[] = []
  for (const group of mixedGroups(counts)) {
    const present = formsInLine(group, text)
    if (present.length === 0) continue
    const tallies = counts[group.id] ?? {}
    const presentLabels = new Set(present.map((p) => p.form.label))
    const ordered = [
      ...group.forms.filter((f) => presentLabels.has(f.label)),
      ...group.forms.filter(
        (f) => !presentLabels.has(f.label) && (tallies[f.label]?.count ?? 0) > 0,
      ),
    ]
    const stats = ordered.map((f) => `${f.label} ${tallies[f.label]?.count ?? 0}件`).join('・')
    if (group.kind === 'numeral') {
      const counter = group.id.slice('numeral:'.length)
      const examples = ordered.map(
        (f) =>
          present.find((p) => p.form.label === f.label)?.example ?? tallies[f.label]?.example ?? '',
      )
      numeralParts.push(`${counter}（${examples.join('・')}／${stats}）`)
    } else {
      messages.push(
        `${joinLabels(ordered.map((f) => f.label))}が混ざっています（この作品で ${stats}）。どちらかに揃えると読みやすくなります。`,
      )
    }
  }
  if (numeralParts.length > 0) {
    messages.push(`数の書き方が算用数字と漢数字で混ざっています：${numeralParts.join('・')}。`)
  }
  return messages
}

import { z } from 'zod'

/**
 * プロット（物語の設計図）のデータモデルと純ロジック。
 * 構造レイヤー（ノード＋エッジの自由な器）とは別に、幕（セクション）×ビート（出来事カード）
 * ＋プロットライン＋伏線という型付きの器を持つ。永続化は PlotRepository、同期は
 * アイテム同期（`plot:<id>`）、バックアップ/ライブスナップショットには CloudBackup.plots で同乗する。
 */

/** 幕・部など、大きな区切り。beatIds がビートの並び順の正本。 */
export const PlotSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string().optional(),
  beatIds: z.array(z.string()),
})
export type PlotSection = z.infer<typeof PlotSectionSchema>

/** プロットライン（メイン・サブプロット・キャラアーク）。グリッドビューの行になる。 */
export const PlotLineSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** 色（トークン名。構造レイヤーの color と同じ方式・未設定＝既定）。 */
  color: z.string().optional(),
  note: z.string().optional(),
})
export type PlotLine = z.infer<typeof PlotLineSchema>

/** ビートの進行状態。検討中→確定→執筆中→済。 */
export const PlotBeatStatusSchema = z.enum(['idea', 'fixed', 'writing', 'done'])
export type PlotBeatStatus = z.infer<typeof PlotBeatStatusSchema>

/** ビート＝出来事カード。物語設計の最小単位。参照は用語集・本文・ネタ帳と結ぶ。 */
export const PlotBeatSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** 何が起きるか（数行の要約）。 */
  summary: z.string().optional(),
  /** 狙い・代案などの自由メモ。 */
  note: z.string().optional(),
  /** テンプレート由来のガイド文。summary が空の間だけプレースホルダ表示に使う。 */
  guide: z.string().optional(),
  /** 視点キャラ（用語集 entry id）。 */
  povRef: z.string().optional(),
  /** 登場キャラ（用語集 entry id）。 */
  castRefs: z.array(z.string()),
  /** 舞台（用語集 entry id）。 */
  placeRefs: z.array(z.string()),
  /** 作中時間の自由記述（「三日後の夜」等）。 */
  timeLabel: z.string().optional(),
  /** 属するプロットライン。 */
  lineRefs: z.array(z.string()),
  /** 対応する本文の話 id（構造レイヤーの episodeRef と同じ結合点）。 */
  episodeRef: z.string().optional(),
  /** 種になったネタ帳メモ id。 */
  ideaRef: z.string().optional(),
  status: PlotBeatStatusSchema,
  /** 予定文字数。 */
  targetLength: z.number().optional(),
})
export type PlotBeat = z.infer<typeof PlotBeatSchema>

/** 伏線。張るビートと回収するビートを結ぶ。状態は保存せず導出する。 */
export const ForeshadowSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string().optional(),
  plantBeatId: z.string().optional(),
  payoffBeatId: z.string().optional(),
})
export type Foreshadow = z.infer<typeof ForeshadowSchema>

/**
 * 秘密＝読者に伏せている情報と、それを明かすビート。
 *
 * 伏線（張る→回収する「仕掛け」）とは別物として持つ。伏線が「後で効く布石を置いたか」
 * を管理するのに対し、秘密は「いま読者は何を知らないか／どこで知るか」を管理する。
 * 真相（truth）は作者だけが見る欄で、本文には出さない。
 */
export const SecretSchema = z.object({
  id: z.string(),
  /** 伏せている事柄の呼び名（例：ユキの正体）。 */
  title: z.string(),
  /** 真相そのもの（読者に伏せている中身）。 */
  truth: z.string().optional(),
  /** 読者へ明かすビート。未設定＝開示未定（点検対象）。 */
  revealBeatId: z.string().optional(),
  /** 最後まで明かさないと決めた秘密は点検から外す（未開示の警告を出さない）。 */
  keepHidden: z.boolean().optional(),
})
export type Secret = z.infer<typeof SecretSchema>

/**
 * 世界観設定の 1 項目（作者専用のノート）。
 *
 * 用語集（Work.glossary）は**読者に段階公開される場所**なので、設定のルールや執筆の決め事、
 * まだ伏せている真相をそこへ書くと公開経路に乗ってしまう。世界観設定はプロット側に置くことで
 * 公開バンドル（toBundleWork が運ぶのは Work だけ）に構造的に載らない＝作者だけの場所になる。
 *
 * `slot` が枠の識別子。WORLD_SLOTS の key と一致するものは案内文つきの定型枠、
 * `'custom'` は作者が自分で見出しを付けた自由枠。
 */
export const WorldNoteSchema = z.object({
  id: z.string(),
  slot: z.string(),
  /** 見出し。定型枠では WORLD_SLOTS のラベルを使うので空でよい（自由枠は必須）。 */
  title: z.string().optional(),
  body: z.string(),
  updatedAt: z.number(),
})
export type WorldNote = z.infer<typeof WorldNoteSchema>

/**
 * 世界観設定の枠のまとまり。アコーディオンの 1 セクションに対応する。
 * 「世界そのもの」「どう書くか」「読者にどう見せるか」の 3 つ。
 */
export type WorldSlotGroup = 'world' | 'writing' | 'reader'

export interface WorldSlotDef {
  key: string
  group: WorldSlotGroup
  label: string
  /** 「ここに何を書くのか」の案内。空の枠でも常に表示して、作者が迷わないようにする。 */
  guide: string
  /** 書き出しの取っかかり（textarea の placeholder）。 */
  placeholder: string
  /** 作品によっては要らない枠（空のままで構わないことを画面で明示する）。 */
  optional?: boolean
}

/**
 * 定型枠の定義（表示順）。空でも一覧に出し、案内文をそのまま読ませる＝
 * 「何を書けばいいか分からない」で止まらないための器。増やすときは末尾へ足す
 * （key は保存済みデータの結合キーなので変えない）。
 *
 * **ジャンルを選ばない語で書く。**「力の体系」「種族」のような語は異世界物を前提にしてしまい、
 * 現代物・ミステリ・恋愛・私小説の作者には空欄の押しつけになる。どの作品にもある問い
 *（いつどこの話か／人は何に縛られているか／何を破らないか）に言い換え、現実に無い仕組みを
 * 持つ作品だけが使う枠は 1 つに畳んで optional にした。placeholder も現代物と架空世界の
 * 両方を並べ、「自分の作品には関係ない」と思わせない。
 */
export const WORLD_SLOTS: WorldSlotDef[] = [
  {
    key: 'stage',
    group: 'world',
    label: '時代と場所',
    guide: 'いつ・どこの話か。土地の広がり、季節、街や部屋の空気。',
    placeholder:
      '例：現代の地方都市、夏。駅前だけが明るい\n例：氷に閉ざされた大陸。冬が長く、街道は三月ふさがる',
  },
  {
    key: 'society',
    group: 'world',
    label: '人を縛るもの',
    guide:
      'その世界で人が従っているもの。立場・お金・仕事・信仰・慣習・空気。誰が力を持っているか。',
    placeholder:
      '例：進学校の中の序列。親の期待がいちばん強い\n例：教団が配給を握る。等級は生まれで決まらないが、事実上は動かない',
  },
  {
    key: 'rules',
    group: 'world',
    label: 'この作品の約束事',
    guide:
      '破ると話が壊れる芯。「この作品では○○は起こらない」を決めておきます。現実どおりの世界なら、そう書いておくだけで十分です。',
    placeholder:
      '例：現実どおり。偶然や超常で問題は解決しない\n例：死者は生き返らない。力には必ず代償が要る',
  },
  {
    key: 'history',
    group: 'world',
    label: 'ここまでの経緯',
    guide: '物語が始まる前に何があったか。いま起きていることの前提になる出来事。',
    placeholder:
      '例：三年前の事故から、家族は口をきいていない\n例：数万年前の厄災。以後、人は外殻の内側だけで暮らす',
  },
  {
    key: 'special',
    group: 'world',
    label: '固有の仕組み',
    optional: true,
    guide:
      '現実には無い仕組みがある作品だけの枠。魔法・異能・未来技術・特殊なルールなど、その理屈と限界。とくに「できないこと」を決めると話が締まります。無ければ空のままで大丈夫です。',
    placeholder: '例：体系として使えるが、原理は誰にも分かっていない',
  },
  {
    key: 'style',
    group: 'writing',
    label: '語り手と文体',
    guide: '誰の目で語るか。人称・視点・時制、地の文の温度。',
    placeholder: '例：一人称・現在形。主人公が知らないことは地の文に出さない',
  },
  {
    key: 'words',
    group: 'writing',
    label: '言葉づかい',
    guide: '誰がどう話すか。使う言葉と使わない言葉、呼び名の原則。ここが揃うと文章がぶれません。',
    placeholder: '例：主人公は誰にでも敬語。心の中だけ崩れる\n例：この世界に「星」という語がない',
  },
  {
    key: 'characters',
    group: 'writing',
    label: '人物の描き方',
    guide:
      '人物を立てるときの自分ルール。何で見せ、何を説明しないか。個々の人物の設定そのものは用語集へ。',
    placeholder: '例：内面を説明せず、動作で見せる。主人公を万能にしない',
  },
  {
    key: 'structure',
    group: 'writing',
    label: '話の組み立て',
    guide: '1 話の長さ、章の切り方、引きの作り方、連載のリズム。',
    placeholder: '例：1 話 3000 字前後。章の終わりは必ず引きで閉じる',
  },
  {
    key: 'reveal',
    group: 'reader',
    label: '何を、いつ明かすか',
    guide:
      '伏せることと、出す順番の方針。個々の秘密がどこで明かされるかは「伏線・秘密」タブが管理します。',
    placeholder: '例：手がかりは与える、答えは与えない。読者は主人公が知る以上を知らない',
  },
  {
    key: 'forbidden',
    group: 'reader',
    label: 'やらないこと',
    guide: '書かないと決めたもの。手が滑りやすい逸脱を先に潰しておくと、あとで直す手間が消えます。',
    placeholder: '例：都合のいい偶然で助けない／章間に神視点の解説を挟まない',
  },
]

/** 定型枠の key の集合（保存済みの未知 slot を自由枠として扱うための判定に使う）。 */
const WORLD_SLOT_KEYS = new Set(WORLD_SLOTS.map((s) => s.key))

/** 自由枠（作者が自分で見出しを付けたノート）の slot 値。 */
export const WORLD_CUSTOM_SLOT = 'custom'

/** ノートの見出し。定型枠は WORLD_SLOTS のラベル、自由枠は title（無ければ「無題のメモ」）。 */
export function worldNoteLabel(note: WorldNote): string {
  const slot = WORLD_SLOTS.find((s) => s.key === note.slot)
  if (slot) return slot.label
  const title = note.title?.trim()
  if (title && title.length > 0) return title
  // 見出しの無い自由枠は既定文言。定義から外れた枠（過去の定型枠など）は slot 名をそのまま出す
  // ＝中身のあるノートが「無題」に見えて見失われることがない。
  return note.slot === WORLD_CUSTOM_SLOT ? '無題のメモ' : note.slot
}

/**
 * 世界観設定を表示順に並べる（定型枠を WORLD_SLOTS の順で先に、自由枠を保存順で後ろに）。
 * 中身が空のノートは持たない規約なので、ここに出るものは必ず本文がある。
 */
export function worldNotesInOrder(plot: Plot): WorldNote[] {
  const notes = plot.world ?? []
  const fixed = WORLD_SLOTS.map((s) => notes.find((n) => n.slot === s.key)).filter(
    (n): n is WorldNote => n !== undefined,
  )
  const custom = notes.filter((n) => !WORLD_SLOT_KEYS.has(n.slot))
  return [...fixed, ...custom]
}

/** 何か書かれている枠の数（タブのバッジ用）。 */
export function countWorldNotes(plot: Plot): number {
  return worldNotesInOrder(plot).length
}

/**
 * 世界観設定のノートを書き込む。
 *
 * 定型枠（WORLD_SLOTS）は slot 一致で 1 枠 1 ノートに収束し、**本文が空になったら削除する**
 * （枠そのものは画面に常にあるので、空のレコードを持つ意味がない）。
 * 自由枠は id 一致で更新し、見出しがあるかぎり本文が空でも残す
 * （作者が作った器なので、書く前に離れただけで消えると驚く）。
 */
export function setWorldNote(
  plot: Plot,
  input: { id?: string; slot: string; title?: string; body: string },
  newId: string,
  at: number,
): Plot {
  const notes = plot.world ?? []
  const isFixed = WORLD_SLOT_KEYS.has(input.slot)
  const prev = input.id
    ? notes.find((n) => n.id === input.id)
    : isFixed
      ? notes.find((n) => n.slot === input.slot)
      : undefined

  const body = input.body.trim()
  const title = input.title?.trim()
  // 定型枠は器が常に画面にあるので、空＝未記入として持たない。
  // 自由枠は器そのものを作者が作ったものなので、見出しがあるかぎり空でも残す
  //（足した直後に何も書かずに離れると消える、という驚きを避ける）。
  if (body === '' && !(!isFixed && title)) {
    // もともと無ければ何もしない（no-op は呼び出し側が保存を省ける）。
    if (!prev) return plot
    return { ...plot, world: notes.filter((n) => n.id !== prev.id) }
  }

  const note: WorldNote = {
    id: prev?.id ?? input.id ?? newId,
    slot: input.slot,
    ...(!isFixed && title ? { title } : {}),
    body,
    updatedAt: at,
  }
  return {
    ...plot,
    world: prev ? notes.map((n) => (n.id === note.id ? note : n)) : [...notes, note],
  }
}

/** 世界観設定のノートを削除する。 */
export function removeWorldNote(plot: Plot, id: string): Plot {
  const notes = plot.world ?? []
  if (!notes.some((n) => n.id === id)) return plot
  return { ...plot, world: notes.filter((n) => n.id !== id) }
}

export const PlotTemplateSchema = z.enum([
  'three-act',
  'kishotenketsu',
  'johakyu',
  'heros-journey',
  'custom',
])
export type PlotTemplate = z.infer<typeof PlotTemplateSchema>

export const PlotSchema = z.object({
  id: z.string(),
  workId: z.string(),
  title: z.string(),
  template: PlotTemplateSchema.optional(),
  /** ログライン（一行で言うと何の話か）。 */
  premise: z.string().optional(),
  theme: z.string().optional(),
  sections: z.array(PlotSectionSchema),
  beats: z.array(PlotBeatSchema),
  lines: z.array(PlotLineSchema),
  foreshadows: z.array(ForeshadowSchema),
  /** 読者に伏せる情報。後から足した項目なので、旧データ互換のため既定 []。 */
  secrets: z.array(SecretSchema).optional().default([]),
  /**
   * 世界観設定（作者専用のノート）。後から足した項目なので、旧データ互換のため既定 []。
   * 用語集と違って公開バンドルには載らない＝ネタバレを安心して書ける場所。
   */
  world: z.array(WorldNoteSchema).optional().default([]),
  updatedAt: z.number(),
})
export type Plot = z.infer<typeof PlotSchema>

/**
 * 保存済みレコードを現行スキーマの形へ揃える（後から足した配列を埋める）。
 *
 * 永続化層は `store.get<Plot>()` の**キャストで読み出しており zod を通さない**ため、
 * 項目を後から足すと「型は必須なのに実体は undefined」という値が普通に出てくる
 * （`secrets` は 2026-08、`world` は 2026-08 に追加）。読み手ごとに `?? []` を書くと
 * 書き漏らした一箇所で画面が落ちるので、**入り口で一度だけ**揃える。
 *
 * 検証（parse）ではなく穴埋めなのは、少し形の崩れたレコードを弾いて
 * プロットごと読めなくするより、読める範囲で開くほうが被害が小さいため。
 */
export function normalizePlot(raw: Plot): Plot {
  return { ...raw, secrets: raw.secrets ?? [], world: raw.world ?? [] }
}

/**
 * 作品既定プロットの決定的 id。複数端末が同時に自動作成しても同じレコードへ収束し、
 * 同期レースで空プロットが増殖しない（構造レイヤーの singletonStructureId と同じ流儀）。
 */
export function singletonPlotId(workId: string): string {
  return `${workId}:plot`
}

/** 中身が無い（＝自動生成されただけの）プロットか。同期レースの重複解消に使う。 */
export function isTrivialPlot(p: Plot): boolean {
  return (
    p.beats.length === 0 &&
    p.lines.length === 0 &&
    p.foreshadows.length === 0 &&
    (p.secrets?.length ?? 0) === 0 &&
    (p.world?.length ?? 0) === 0 &&
    !p.premise &&
    !p.theme
  )
}

/**
 * 同一作品にプロットが複数あるとき、表示すべき 1 つを選ぶ（純関数）。
 * 中身あり優先 → 内容量 → updatedAt の新しい方 → id 昇順で決定的に
 * （構造レイヤーの pickPrimaryStructure と同じ流儀。同期レースで生まれた
 * 「新しくて空」より、書きかけの内容を持つ方を常に優先する）。
 */
export function pickPrimaryPlot(list: Plot[]): Plot | undefined {
  if (list.length === 0) return undefined
  const weight = (p: Plot) =>
    p.beats.length +
    p.sections.length +
    p.lines.length +
    p.foreshadows.length +
    (p.secrets?.length ?? 0) +
    (p.world?.length ?? 0)
  return [...list].sort((a, b) => {
    const aTrivial = isTrivialPlot(a) ? 1 : 0
    const bTrivial = isTrivialPlot(b) ? 1 : 0
    if (aTrivial !== bTrivial) return aTrivial - bTrivial // 中身ありが先
    if (weight(a) !== weight(b)) return weight(b) - weight(a)
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
    return a.id < b.id ? -1 : 1
  })[0]
}

/** 空のプロットを組み立てる（純関数）。永続化は Repository 側で行う。 */
export function emptyPlot(id: string, workId: string, at: number, title = '本編プロット'): Plot {
  return {
    id,
    workId,
    title,
    sections: [],
    beats: [],
    lines: [],
    foreshadows: [],
    secrets: [],
    world: [],
    updatedAt: at,
  }
}

/** テンプレート定義（幕＋ガイド文つきビートの雛形）。 */
interface TemplateBeatDef {
  title: string
  guide: string
}
interface TemplateSectionDef {
  title: string
  beats: TemplateBeatDef[]
}
export const PLOT_TEMPLATES: Record<
  Exclude<PlotTemplate, 'custom'>,
  { label: string; description: string; sections: TemplateSectionDef[] }
> = {
  'three-act': {
    label: '三幕構成',
    description: '導入・対立・解決の王道。二幕を前後に割った4区切り。',
    sections: [
      {
        title: '第一幕',
        beats: [
          { title: 'オープニング', guide: '主人公の日常と、満たされていない欠落を見せる' },
          { title: 'きっかけの事件', guide: '日常を壊し、物語を動かす出来事が起きる' },
          { title: '決断', guide: '主人公が一歩を踏み出し、後戻りできなくなる' },
        ],
      },
      {
        title: '第二幕・前',
        beats: [
          { title: '新しい世界', guide: '事件後の世界のルールを学び、仲間や敵と出会う' },
          { title: '中間点', guide: '物語の折り返し。状況が反転する出来事が起きる' },
        ],
      },
      {
        title: '第二幕・後',
        beats: [
          { title: '迫る危機', guide: '敵対する力が強まり、選択肢が狭まっていく' },
          { title: 'どん底', guide: 'すべてを失ったと思える最悪の瞬間' },
        ],
      },
      {
        title: '第三幕',
        beats: [
          { title: 'クライマックス', guide: '最後の対決。主人公の変化が試される' },
          { title: '結末', guide: '変化した主人公と、変わった世界を見せる' },
        ],
      },
    ],
  },
  kishotenketsu: {
    label: '起承転結',
    description: '状況を立て、転がし、ひっくり返して結ぶ。短編〜中編向き。',
    sections: [
      { title: '起', beats: [{ title: '発端', guide: '人物と状況を立ち上げる' }] },
      { title: '承', beats: [{ title: '展開', guide: '状況を受けて物語を進め、積み上げる' }] },
      { title: '転', beats: [{ title: '転換', guide: '流れを裏切る出来事で局面を変える' }] },
      { title: '結', beats: [{ title: '結び', guide: '転を受け止めて物語を締める' }] },
    ],
  },
  johakyu: {
    label: '序破急',
    description: 'ゆるやかに立ち上げ、崩し、一気に畳む三部構成。',
    sections: [
      { title: '序', beats: [{ title: '立ち上がり', guide: '世界と人物をゆっくり立ち上げる' }] },
      { title: '破', beats: [{ title: '展開と破綻', guide: '均衡が崩れ、物語が加速する' }] },
      { title: '急', beats: [{ title: '急転と決着', guide: '一気に頂点へ駆け上がり、畳む' }] },
    ],
  },
  'heros-journey': {
    label: 'ヒーローズジャーニー',
    description: '旅立ち・試練・帰還の円環。長編の背骨になる簡約12ビート。',
    sections: [
      {
        title: '旅立ち',
        beats: [
          { title: '日常世界', guide: '主人公のいつもの世界を見せる' },
          { title: '冒険への誘い', guide: '日常の外から呼び声が届く' },
          { title: '拒絶', guide: '主人公は一度ためらい、拒む' },
          { title: '賢者との出会い', guide: '導き手が現れ、背中を押す' },
          { title: '第一関門', guide: '日常を離れ、もう戻れない一線を越える' },
        ],
      },
      {
        title: '試練',
        beats: [
          { title: '試練・仲間・敵', guide: '新世界のルールを学び、関係が生まれる' },
          { title: '最深部への接近', guide: '最も危険な場所へ近づいていく' },
          { title: '最大の試練', guide: '死と再生。最も大きな代償を払う' },
          { title: '報酬', guide: '試練の果てに求めていたものを手にする' },
        ],
      },
      {
        title: '帰還',
        beats: [
          { title: '帰路', guide: '追手や未練が帰り道を阻む' },
          { title: '復活', guide: '最後の試練で本当の変化を証明する' },
          { title: '宝を持っての帰還', guide: '得たものを携えて日常へ戻る' },
        ],
      },
    ],
  },
}

/** テンプレートからプロットを組み立てる（純関数）。custom は空プロット＋1幕。 */
export function createPlotFromTemplate(
  id: string,
  workId: string,
  at: number,
  template: PlotTemplate,
  genId: () => string,
  title = '本編プロット',
): Plot {
  if (template === 'custom') {
    const base = emptyPlot(id, workId, at, title)
    return {
      ...base,
      template,
      sections: [{ id: genId(), title: '第一幕', beatIds: [] }],
    }
  }
  const def = PLOT_TEMPLATES[template]
  const sections: PlotSection[] = []
  const beats: PlotBeat[] = []
  for (const s of def.sections) {
    const beatIds: string[] = []
    for (const b of s.beats) {
      const beatId = genId()
      beatIds.push(beatId)
      beats.push({
        id: beatId,
        title: b.title,
        guide: b.guide,
        castRefs: [],
        placeRefs: [],
        lineRefs: [],
        status: 'idea',
      })
    }
    sections.push({ id: genId(), title: s.title, beatIds })
  }
  return { ...emptyPlot(id, workId, at, title), template, sections, beats }
}

/** ビートを幕へ追加する（index 省略時は末尾）。幕が見つからなければそのまま返す。 */
export function addBeat(plot: Plot, sectionId: string, beat: PlotBeat, index?: number): Plot {
  const section = plot.sections.find((s) => s.id === sectionId)
  if (!section) return plot
  const at =
    index === undefined
      ? section.beatIds.length
      : Math.max(0, Math.min(index, section.beatIds.length))
  const beatIds = [...section.beatIds.slice(0, at), beat.id, ...section.beatIds.slice(at)]
  return {
    ...plot,
    beats: [...plot.beats, beat],
    sections: plot.sections.map((s) => (s.id === sectionId ? { ...s, beatIds } : s)),
  }
}

/** ビートのフィールドを部分更新する（id は不変）。 */
export function updateBeat(plot: Plot, id: string, patch: Partial<Omit<PlotBeat, 'id'>>): Plot {
  return { ...plot, beats: plot.beats.map((b) => (b.id === id ? { ...b, ...patch } : b)) }
}

/**
 * ビートを削除する。幕の beatIds からも外す。
 * 伏線の参照はあえて残す＝導出で「根なし」警告に落ち、消えたことが見える（黙って消さない）。
 */
export function removeBeat(plot: Plot, id: string): Plot {
  return {
    ...plot,
    beats: plot.beats.filter((b) => b.id !== id),
    sections: plot.sections.map((s) =>
      s.beatIds.includes(id) ? { ...s, beatIds: s.beatIds.filter((x) => x !== id) } : s,
    ),
  }
}

/** ビートを別の幕・位置へ移す（同一幕内の並べ替えにも使う）。 */
export function moveBeat(plot: Plot, beatId: string, toSectionId: string, index: number): Plot {
  if (!plot.sections.some((s) => s.id === toSectionId)) return plot
  const removed = plot.sections.map((s) =>
    s.beatIds.includes(beatId) ? { ...s, beatIds: s.beatIds.filter((x) => x !== beatId) } : s,
  )
  return {
    ...plot,
    sections: removed.map((s) => {
      if (s.id !== toSectionId) return s
      const at = Math.max(0, Math.min(index, s.beatIds.length))
      return { ...s, beatIds: [...s.beatIds.slice(0, at), beatId, ...s.beatIds.slice(at)] }
    }),
  }
}

/** 幕を追加する（index 省略時は末尾）。 */
export function addSection(plot: Plot, section: PlotSection, index?: number): Plot {
  const at =
    index === undefined ? plot.sections.length : Math.max(0, Math.min(index, plot.sections.length))
  return {
    ...plot,
    sections: [...plot.sections.slice(0, at), section, ...plot.sections.slice(at)],
  }
}

/** 幕のフィールドを部分更新する（id・beatIds は対象外）。 */
export function updateSection(
  plot: Plot,
  id: string,
  patch: Partial<Pick<PlotSection, 'title' | 'note'>>,
): Plot {
  return { ...plot, sections: plot.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
}

/**
 * 幕を削除する。中のビートは隣の幕（前優先・先頭なら次）の末尾へ逃がす＝ビートを黙って消さない。
 * 幕が1つしか無いときは削除しない（ビートの行き場が無くなるため）。
 */
export function removeSection(plot: Plot, id: string): Plot {
  const idx = plot.sections.findIndex((s) => s.id === id)
  if (idx < 0 || plot.sections.length <= 1) return plot
  const victim = plot.sections[idx]
  if (!victim) return plot
  const neighborIdx = idx > 0 ? idx - 1 : idx + 1
  const sections = plot.sections
    .map((s, i) => (i === neighborIdx ? { ...s, beatIds: [...s.beatIds, ...victim.beatIds] } : s))
    .filter((s) => s.id !== id)
  return { ...plot, sections }
}

/** プロットラインを追加する。 */
export function addLine(plot: Plot, line: PlotLine): Plot {
  return { ...plot, lines: [...plot.lines, line] }
}

/** プロットラインを部分更新する。 */
export function updateLine(plot: Plot, id: string, patch: Partial<Omit<PlotLine, 'id'>>): Plot {
  return { ...plot, lines: plot.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
}

/** プロットラインを削除する。ビート側の lineRefs からも外す。 */
export function removeLine(plot: Plot, id: string): Plot {
  return {
    ...plot,
    lines: plot.lines.filter((l) => l.id !== id),
    beats: plot.beats.map((b) =>
      b.lineRefs.includes(id) ? { ...b, lineRefs: b.lineRefs.filter((x) => x !== id) } : b,
    ),
  }
}

/** 伏線を追加/更新する（id 一致で置換、無ければ追加）。 */
export function upsertForeshadow(plot: Plot, f: Foreshadow): Plot {
  return {
    ...plot,
    foreshadows: plot.foreshadows.some((x) => x.id === f.id)
      ? plot.foreshadows.map((x) => (x.id === f.id ? f : x))
      : [...plot.foreshadows, f],
  }
}

/** 伏線を削除する。 */
export function removeForeshadow(plot: Plot, id: string): Plot {
  return { ...plot, foreshadows: plot.foreshadows.filter((f) => f.id !== id) }
}

/** 秘密を追加/更新する（id 一致で置換、無ければ追加）。 */
export function upsertSecret(plot: Plot, s: Secret): Plot {
  return {
    ...plot,
    secrets: plot.secrets.some((x) => x.id === s.id)
      ? plot.secrets.map((x) => (x.id === s.id ? s : x))
      : [...plot.secrets, s],
  }
}

/** 秘密を削除する。 */
export function removeSecret(plot: Plot, id: string): Plot {
  return { ...plot, secrets: plot.secrets.filter((s) => s.id !== id) }
}

/**
 * 秘密の状態（導出）。
 * revealed   = 明かすビートが決まっている
 * kept       = 最後まで明かさないと決めた（点検対象外）
 * unrevealed = 開示未定＝点検対象
 * 削除済みビートへの参照は「無い」ものとして扱う（伏線と同じ規約）。
 */
export type SecretStatus = 'revealed' | 'kept' | 'unrevealed'
export function secretStatus(s: Secret, plot: Plot): SecretStatus {
  if (s.revealBeatId !== undefined && plot.beats.some((b) => b.id === s.revealBeatId)) {
    return 'revealed'
  }
  return s.keepHidden ? 'kept' : 'unrevealed'
}

/** 開示未定の秘密数（タブのバッジ用）。 */
export function countUnrevealedSecrets(plot: Plot): number {
  return plot.secrets.filter((s) => secretStatus(s, plot) === 'unrevealed').length
}

/**
 * 指定ビートの時点で、読者がまだ知らない秘密（＝そのビートより後で明かされる／
 * 最後まで明かさない秘密）。「いまの読者は何を知らないか」を執筆中に確かめるための導出。
 * 物語順（幕→幕内の並び）で位置を比べる。
 */
export function secretsHiddenAt(plot: Plot, beatId: string): Secret[] {
  const order = plot.sections.flatMap((s) => s.beatIds)
  const here = order.indexOf(beatId)
  if (here < 0) return []
  return plot.secrets.filter((s) => {
    const st = secretStatus(s, plot)
    if (st !== 'revealed') return true // 開示未定・最後まで伏せる＝この時点でも未開示
    const at = order.indexOf(s.revealBeatId ?? '')
    return at < 0 || at > here
  })
}

/**
 * 伏線の状態（導出）。
 * planted   = 張ってあるが未回収
 * resolved  = 張って回収済み
 * orphan    = 回収だけがある（張り忘れ or 張ったビートの削除）＝警告
 * unplaced  = どちらも未配置
 * 削除済みビートへの参照は「無い」ものとして扱う＝ビート削除で自然に orphan/unplaced へ落ちる。
 */
export type ForeshadowStatus = 'planted' | 'resolved' | 'orphan' | 'unplaced'
export function foreshadowStatus(f: Foreshadow, plot: Plot): ForeshadowStatus {
  const exists = (beatId: string | undefined) =>
    beatId !== undefined && plot.beats.some((b) => b.id === beatId)
  const plant = exists(f.plantBeatId)
  const payoff = exists(f.payoffBeatId)
  if (plant && payoff) return 'resolved'
  if (plant) return 'planted'
  if (payoff) return 'orphan'
  return 'unplaced'
}

/** 未回収＋根なしの伏線数（ビュー切替タブのバッジ用）。 */
export function countOpenForeshadows(plot: Plot): number {
  return plot.foreshadows.filter((f) => {
    const st = foreshadowStatus(f, plot)
    return st === 'planted' || st === 'orphan'
  }).length
}

/** 幕内のビートを並び順で返す（beatIds に無い/重複 id は無視）。 */
export function beatsOfSection(plot: Plot, sectionId: string): PlotBeat[] {
  const section = plot.sections.find((s) => s.id === sectionId)
  if (!section) return []
  const byId = new Map(plot.beats.map((b) => [b.id, b]))
  return section.beatIds.map((id) => byId.get(id)).filter((b): b is PlotBeat => b != null)
}

/** 幕の予定文字数の小計（未設定ビートは 0 扱い）。 */
export function sectionTargetTotal(plot: Plot, sectionId: string): number {
  return beatsOfSection(plot, sectionId).reduce((sum, b) => sum + (b.targetLength ?? 0), 0)
}

/** status をワンタップで循環させる順序。 */
export function nextBeatStatus(status: PlotBeatStatus): PlotBeatStatus {
  const order: PlotBeatStatus[] = ['idea', 'fixed', 'writing', 'done']
  return order[(order.indexOf(status) + 1) % order.length] ?? 'idea'
}

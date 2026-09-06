import { z } from 'zod'
import { PERSON_CATEGORY, resolveRef } from '../glossary'
import type { Block, Episode, GlossaryEntry, Inline } from '../schema'

/**
 * ノベルゲーム化（サウンドノベル書き出し）のドメイン層。設計は docs/requirement/07-novel-game.md。
 *
 * 演出（Staging）は正本 `Work` の**外**に置き、`Block.id` をアンカーに本文へ張り付く
 * （D-GAME-STAGING）。正本はゲーム化によって一切変更されない。
 *
 * **アンカーの寿命**: 保存経路（editorStore の save・MCP の set_episode）は
 * `reconcileBlockIds`（src/core/parser/）で旧 blocks から id を引き継ぐため、
 * 内容が変わらない段落の id は編集をまたいで安定する。詳細は 07 §2.3。
 */

// ---------------------------------------------------------------------------
// スキーマ（演出譜）
// ---------------------------------------------------------------------------

/** 正体を伏せた話者の表示名（名前枠に ？？？ と出し、立ち絵も出さない）。 */
export const MASKED_SPEAKER = '？？？'

/**
 * `Cue.bgm` の予約キー＝鳴っている BGM をこの行で止める（実体は持たない）。
 * 効果音の `SE_STOP` と同じ字面。BGM は場面の切れ目では止まらず、次の曲かこれまで続く。
 */
export const BGM_STOP = 'stop'

/** 立ち絵の席（左・中央・右）。舞台に立てるのは 3 人まで（席の数）。 */
export const SPRITE_POSITIONS = ['l', 'c', 'r'] as const
export type SpritePosition = (typeof SPRITE_POSITIONS)[number]

/**
 * 1 つの席への立ち絵の指示（D-GAME-SPRITE-FREE）。**話者とは独立**で、地の文でもセリフでも付けられる。
 * - `character` を渡す＝その席にその人物を立たせる（既に別の席にいれば移す）。
 *   `pos` を省略すると空いている席（中央→左→右）へ。満席なら一番前から立っている人と交代。
 * - `character` が空で `pos` がある＝その席を下げる。
 * - `expression` は省略＝その人物が既に立っていればいまの表情のまま、初めて立つなら「通常」。
 * 席は次の指示か「下げる」か場面の切れ目（hideSprite 含む）まで続く。
 */
export const SpriteCueSchema = z.object({
  pos: z.enum(['l', 'c', 'r']).optional(),
  character: z.string().optional(),
  expression: z.string().optional(),
})
export type SpriteCue = z.infer<typeof SpriteCueSchema>

export const CueSchema = z.object({
  /** 張り付き先の Block.id。本文は一切書き換えない（アンカーのみ） */
  blockId: z.string(),
  /**
   * 話者名（名前枠に出す・セリフの行だけ）。辞書 entry の name（= [[名前]] の解決キーと同一）。
   * **立ち絵は出さない**（立ち絵は `sprites` で別に指示する・D-GAME-SPRITE-FREE）。
   * 話者が舞台に立っていれば、その人物だけ明るく出る。
   */
  speaker: z.string().optional(),
  /**
   * この行での立ち絵の指示（席ごと）。省略＝変えない。
   * 旧式の `appear` / `expression` を持つ cue は `spriteCuesOf` が同じ形に読み替える。
   */
  sprites: z.array(SpriteCueSchema).optional(),
  /**
   * @deprecated 旧式（2026-09-06 以前）。話者の付いた行ではその話者の、そうでなければ登場（appear）
   * する人物の表情。いまは `sprites[].expression` を使う。旧データのために読み続ける。
   */
  expression: z.string().optional(),
  /**
   * @deprecated 旧式。立ち絵の登場（人物名）。いまは `sprites`（席の指定つき）を使う。
   * 旧データは「空いている席へ立たせる」指示として読む。
   */
  appear: z.string().optional(),
  /**
   * この行で立ち絵を全員下げ、**次の場面の切れ目まで**出さない区間にする。人物ごと描いた一枚絵の
   * 背景に立ち絵が重なるのを止めるための欄。話者名（名前枠）は出る。`sprites` で明示すれば戻る。
   */
  hideSprite: z.boolean().optional(),
  /** ここで場面が変わる（背景・BGM の切り替え点）。正本に区切りは復活させない（D-GAME-SCENE-MANUAL） */
  sceneBreak: z.boolean().optional(),
  /** アセットキー（'preset:bg/room-day' 等）。実体は持たない（D-GAME-ASSET-STORE） */
  bg: z.string().optional(),
  /**
   * BGM のキー（`preset:bgm/<slug>`＝運営テンプレの曲）。この行から次の曲か `'stop'`（BGM_STOP）まで
   * 鳴り続ける。**場面の切れ目では止まらない**（背景と同じ扱い＝曲は場面をまたぐことが多い）
   */
  bgm: z.string().optional(),
  /** 効果音のキー。`'stop'`（SE_STOP）＝鳴っているループをここで止める */
  se: z.string().optional(),
  /** 鳴らし方（省略＝1回）。'loop' は次の場面の切れ目か「止める」まで続く */
  seRepeat: z.union([z.literal(2), z.literal('loop')]).optional(),
  transition: z.enum(['cut', 'fade', 'flash']).optional(),
})
export type Cue = z.infer<typeof CueSchema>

/** 1話ぶんの演出譜。`workId + episodeId` がキー（正本とは別レコード）。 */
export const StagingSchema = z.object({
  workId: z.string(),
  episodeId: z.string(),
  cues: z.array(CueSchema),
  updatedAt: z.number(),
})
export type Staging = z.infer<typeof StagingSchema>

/**
 * 素材への参照。BGM のループ点は**最初からスキーマに持つ**（後付けすると全曲の
 * 作り直しになるため。D-GAME-BGM-LOOP）。Web Audio API の loopStart / loopEnd へ流す。
 */
export const AssetRefSchema = z.object({
  /** 'preset:bg/room-night' | 'user:<hash>' */
  key: z.string(),
  kind: z.enum(['bg', 'bgm', 'se', 'sprite']),
  /** シームレスループの開始・終了（秒）。BGM のみ意味を持つ */
  loopStart: z.number().optional(),
  loopEnd: z.number().optional(),
})
export type AssetRef = z.infer<typeof AssetRefSchema>

// ---------------------------------------------------------------------------
// 演出譜の編集（純関数。UI・MCP が使う）
// ---------------------------------------------------------------------------

export function emptyStaging(workId: string, episodeId: string, now: number): Staging {
  return { workId, episodeId, cues: [], updatedAt: now }
}

/**
 * 1つの block の演出を部分更新する。パッチ方式（MCP の upsert と同じ流儀）:
 * 渡した項目だけ書き換える・省略＝据え置き・`undefined` を明示的に渡すと削除。
 * 全項目が空になった cue は cues から落とす（ゴミを残さない）。
 */
export function patchCue(
  staging: Staging,
  blockId: string,
  patch: Partial<Omit<Cue, 'blockId'>>,
  now: number,
): Staging {
  const current = staging.cues.find((c) => c.blockId === blockId) ?? { blockId }
  const merged: Cue = { ...current }
  for (const key of [
    'speaker',
    'sprites',
    'expression',
    'appear',
    'hideSprite',
    'sceneBreak',
    'bg',
    'bgm',
    'se',
    'seRepeat',
    'transition',
  ] as const) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === undefined) delete merged[key]
    else (merged as Record<string, unknown>)[key] = value
  }
  const isEmpty = Object.keys(merged).length === 1 // blockId だけ
  const cues = isEmpty
    ? staging.cues.filter((c) => c.blockId !== blockId)
    : insertCue(staging.cues, merged)
  return { ...staging, cues, updatedAt: now }
}

/** cue を元の位置（同じ blockId があればそこ）へ置き換え、無ければ末尾に足す。 */
function insertCue(cues: Cue[], cue: Cue): Cue[] {
  const index = cues.findIndex((c) => c.blockId === cue.blockId)
  if (index === -1) return [...cues, cue]
  return cues.map((c, i) => (i === index ? cue : c))
}

/** 1つの block の演出を丸ごと外す。 */
export function removeCue(staging: Staging, blockId: string, now: number): Staging {
  return {
    ...staging,
    cues: staging.cues.filter((c) => c.blockId !== blockId),
    updatedAt: now,
  }
}

// ---------------------------------------------------------------------------
// 判別（セリフ・地の文・間）
// ---------------------------------------------------------------------------

export type BlockKind = 'dialogue' | 'narration' | 'gap'

/**
 * inline 列 → 純本文（ルビは親文字だけ・読みは落とす）。
 * toPlainText の「親（よみ）」展開とは別物で、文字送りの拍数・共有カードなど
 * 「画面に出る文字と 1:1」であってほしい場所で使う。
 */
function plainTextOfInline(inline: Inline): string {
  switch (inline.type) {
    case 'text':
      return inline.text
    case 'ruby':
      return inline.base
    case 'emphasisDots':
      return inline.text
    case 'ref':
      return inline.children ? plainTextOfInlines(inline.children) : inline.name
  }
}

export function plainTextOfInlines(inlines: Inline[]): string {
  return inlines.map(plainTextOfInline).join('')
}

export function plainTextOfBlock(block: Block): string {
  return plainTextOfInlines(block.inlines)
}

/**
 * セリフ/地の文/間 の判別（07-novel-game.md §3.1）。
 * - 空 block・空白だけの block ＝ gap（間・改ページ候補）
 * - 字下げ（行頭の空白）を除いた先頭が 「 か 『 ＝ dialogue
 * - それ以外 ＝ narration
 */
export function classifyBlock(block: Block): BlockKind {
  // \s は全角空白（U+3000）も含む
  const lead = plainTextOfBlock(block).replace(/^\s+/, '')
  if (lead === '') return 'gap'
  return lead.startsWith('「') || lead.startsWith('『') ? 'dialogue' : 'narration'
}

// ---------------------------------------------------------------------------
// ページ化と演出の突き合わせ
// ---------------------------------------------------------------------------

/** プレイヤーの1メッセージ（クリック1回で進む単位）。gap は beat に畳む。 */
export interface GamePage {
  blockId: string
  kind: 'dialogue' | 'narration'
  /** 直前の空行数（間の長さ。0=続けて、1=一拍、2以上=大きな間） */
  beat: number
}

/** 本文 block 列 → ページ列。gap は次ページの beat に畳む（末尾の空行は落ちる）。 */
export function toPages(blocks: Block[]): GamePage[] {
  const pages: GamePage[] = []
  let beat = 0
  for (const block of blocks) {
    const kind = classifyBlock(block)
    if (kind === 'gap') {
      beat++
      continue
    }
    pages.push({ blockId: block.id, kind, beat })
    beat = 0
  }
  return pages
}

export interface StagedPage extends GamePage {
  speaker?: string
  sprites?: SpriteCue[]
  expression?: string
  appear?: string
  hideSprite?: boolean
  sceneBreak?: boolean
  bg?: string
  bgm?: string
  se?: string
  seRepeat?: 2 | 'loop'
  transition?: 'cut' | 'fade' | 'flash'
}

/**
 * cue を blockId でページへ突き合わせる。同じ blockId の cue は後勝ち。
 * Staging なし＝素のページ（**演出ゼロでもプレイできる**、が G0 の不変条件）。
 */
export function applyCues(pages: GamePage[], staging?: Staging): StagedPage[] {
  const byBlock = new Map((staging?.cues ?? []).map((c) => [c.blockId, c]))
  return pages.map((page): StagedPage => {
    const cue = byBlock.get(page.blockId)
    if (!cue) return { ...page }
    const { blockId: _anchor, ...effects } = cue
    return { ...page, ...effects }
  })
}

/**
 * この行の立ち絵の指示。新式の `sprites` があればそれ、無ければ旧式の `appear`（＋話者の無い行の
 * `expression`）を「空いている席へ立たせる」指示に読み替える。書き出し・続きレーン・MCP の要約が
 * 同じ読み方をするための 1 箇所。
 */
export function spriteCuesOf(
  cue: Pick<Cue, 'sprites' | 'appear' | 'expression' | 'speaker'>,
): SpriteCue[] {
  if (cue.sprites) return cue.sprites
  if (cue.appear && cue.appear !== MASKED_SPEAKER) {
    const expression = cue.speaker ? undefined : cue.expression
    return [{ character: cue.appear, ...(expression ? { expression } : {}) }]
  }
  return []
}

/**
 * 行き先（blockId）を失った cue の列挙。**自動削除はしない**——plot の伏線 orphan と
 * 同じ扱いで、UI が「行き先を失った演出」として提示する（D-GAME-STAGING）。
 */
export function findOrphanCues(staging: Staging, episode: Episode): Cue[] {
  const ids = new Set(episode.blocks.map((b) => b.id))
  return staging.cues.filter((c) => !ids.has(c.blockId))
}

// ---------------------------------------------------------------------------
// 提案（確定はユーザー。Staging を書き換えない）
// ---------------------------------------------------------------------------

/**
 * 場面区切りの自動提案（D-GAME-SCENE-MANUAL）。空行が2つ以上続いた直後の本文 block を
 * 候補として返す。冒頭の空行は場面の始まりであって区切りではないので除く。
 */
export function suggestSceneBreaks(blocks: Block[]): string[] {
  const ids: string[] = []
  let gaps = 0
  let seenContent = false
  for (const block of blocks) {
    if (classifyBlock(block) === 'gap') {
      gaps++
      continue
    }
    if (seenContent && gaps >= 2) ids.push(block.id)
    seenContent = true
    gaps = 0
  }
  return ids
}

/**
 * 話者候補の提案（07-novel-game.md §3.2）。外れてよい・自前の推論エンジンは持たない
 * （D-GAME-SPEAKER-MCP）。blocks[index] のセリフに対し、直前の**地の文**を新しい順に
 * たどり、辞書で人物に解決される直近の [[参照]] の正式名（entry.name）を返す。
 */
export function suggestSpeaker(
  blocks: Block[],
  index: number,
  entries: GlossaryEntry[],
): string | undefined {
  const target = blocks[index]
  if (!target || classifyBlock(target) !== 'dialogue') return undefined
  for (let i = index - 1; i >= 0; i--) {
    const block = blocks[i]
    if (!block || classifyBlock(block) !== 'narration') continue
    for (let j = block.inlines.length - 1; j >= 0; j--) {
      const inline = block.inlines[j]
      if (inline?.type !== 'ref') continue
      const entry = resolveRef(inline.name, entries)
      if (entry && PERSON_CATEGORY.test(entry.category ?? '')) return entry.name
    }
  }
  return undefined
}

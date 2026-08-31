import { applyCues, MASKED_SPEAKER, plainTextOfBlock, type Staging, toPages } from '../game'
import { pickSprite } from '../game/assets'
import { buildGameCredits, DEFAULT_BG_KEY, presetBackground, presetBgSvg } from '../game/presets'
import type { Episode, Inline, Work } from '../schema'
import type { ZipInput } from '../zip'
import { buildPlayerHtml, type GameScenario, type ScenarioPage } from './novelGamePlayer'

/**
 * 正本 → ブラウザで遊べるサウンドノベル（zip の中身）。設計は docs/requirement/07-novel-game.md。
 * 単位は1話（D-GAME-EPISODE）。zip 梱包（zipStore）は UI 層に委ね、core は純生成
 * （buildEpubFiles と同じ作法）。Staging が無くても成立する＝演出ゼロでプレイできる。
 */

const FONT_PATH = 'assets/fonts/shippori-mincho-b1.woff2'
const FONT_LICENSE_PATH = 'assets/fonts/LICENSE.txt'

export interface NovelGameFont {
  /** woff2 のバイト列（UI 層が fetch して渡す） */
  data: Uint8Array
  /** OFL 全文。再配布 zip にフォントを入れる以上、ライセンス文も一緒に入れる */
  licenseText: string
}

/** 持ち込み素材（画像）。UI 層が data URL をバイト列へ落として渡す。 */
export interface NovelGameUserAsset {
  /** 'user:<id>'（Cue.bg / defaultBg が指すキー） */
  key: string
  id: string
  label: string
  tone: [string, string, string]
  /** image/webp など。zip 内の拡張子に使う */
  mime: string
  data: Uint8Array
  /** 省略は 'bg'（持ち込み背景しか無かったころの呼び出しと互換） */
  kind?: 'bg' | 'sprite'
  /** 立ち絵のみ：この立ち絵の人物（Cue.speaker と突き合わせ） */
  character?: string
  /** 立ち絵のみ：表情名（省略は「通常」扱い） */
  expression?: string
  /** 立ち絵の既定（同じ人物の最初の1枚）を決める登録時刻 */
  createdAt?: number
}

export interface NovelGameOptions {
  /** 既定背景のキー。未指定・未知キーは DEFAULT_BG_KEY に倒す */
  defaultBg?: string
  /** 同梱フォント。無ければシステムの明朝で動く（書き出しは失敗させない） */
  font?: NovelGameFont
  /** 手元にある持ち込み素材。cue / defaultBg が指す分だけ zip へ同梱される */
  userAssets?: NovelGameUserAsset[]
}

/** zip に入れる背景 1 枚（テンプレ SVG か持ち込み画像かを吸収する内部表現）。 */
interface BgEntry {
  key: string
  label: string
  tone: [string, string, string]
  path: string
  data: string | Uint8Array
  /** クレジット画面に載せるか（運営テンプレのみ。持ち込みは作者自身の素材） */
  credit: boolean
}

const IMAGE_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  )
}

type Unit = string | [string, string]

function pushText(units: Unit[], text: string): void {
  // for..of＝コードポイント単位。サロゲートペアを割らない
  for (const ch of text) {
    const h = escapeHtml(ch)
    units.push(h === ch ? ch : [h, ch])
  }
}

/**
 * inline 列 → 文字送りの1コマ列。ルビは1コマ（親文字と読みを同時に出す）、
 * 傍点は1文字ずつ点付きで出す。HTML は全てここでエスケープ済みにする。
 */
export function unitsOfInlines(inlines: Inline[]): Unit[] {
  const units: Unit[] = []
  for (const inline of inlines) {
    switch (inline.type) {
      case 'text':
        pushText(units, inline.text)
        break
      case 'ruby':
        units.push([
          `<ruby>${escapeHtml(inline.base)}<rp>（</rp><rt>${escapeHtml(inline.reading)}</rt><rp>）</rp></ruby>`,
          inline.base,
        ])
        break
      case 'emphasisDots':
        for (const ch of inline.text) units.push([`<em class="dots">${escapeHtml(ch)}</em>`, ch])
        break
      case 'ref':
        // ゲームでは用語集リンクにしない＝プレーンへ degrade（EPUB と同じ辞書非依存）
        if (inline.children) units.push(...unitsOfInlines(inline.children))
        else pushText(units, inline.name)
        break
    }
  }
  return units
}

function buildReadme(work: Work, episode: Episode, fontEmbedded: boolean): string {
  const lines = [
    `${work.title}「${episode.title}」 — サウンドノベル`,
    '',
    'index.html をブラウザで開くと、そのまま読み始められます。',
    'フォルダごと Web サーバに置いても、このまま人に渡しても動きます。',
    '',
    '同梱素材のクレジットは、ゲーム内のメニュー →「クレジット」にあります。',
  ]
  if (fontEmbedded) {
    lines.push(`フォント（しっぽり明朝 B1）のライセンス全文は ${FONT_LICENSE_PATH} にあります。`)
  }
  lines.push('', 'このゲームは、コトノハ-leaf- の「サウンドノベル書き出し」で作られました。', '')
  return lines.join('\n')
}

/**
 * 1話ぶんの zip の中身を組み立てる（index.html ＋ assets/）。
 * 参照キーに対応する実体（背景 SVG・フォント）は必ず同梱される（不変条件）。
 * G0 に存在しない素材（user:* や bgm 等）を指す cue は落とさず無視する＝壊さない。
 */
export function buildNovelGameFiles(
  work: Work,
  episode: Episode,
  staging: Staging | undefined,
  opts: NovelGameOptions = {},
): ZipInput[] {
  const pages = applyCues(toPages(episode.blocks), staging)
  const blockById = new Map(episode.blocks.map((b) => [b.id, b]))

  // 背景キー → zip に入れる実体。テンプレ（SVG 生成）と持ち込み（画像バイト列）を同じ形へ。
  // 立ち絵（kind 'sprite'）は背景として解決しない（cue.bg が指しても無視＝壊さない）。
  const userByKey = new Map(
    (opts.userAssets ?? []).filter((a) => (a.kind ?? 'bg') === 'bg').map((a) => [a.key, a]),
  )
  const resolveBg = (key: string): BgEntry | undefined => {
    const preset = presetBackground(key)
    if (preset) {
      return {
        key: preset.key,
        label: preset.label,
        tone: preset.tone,
        path: `assets/bg/${preset.slug}.svg`,
        data: presetBgSvg(preset),
        credit: true,
      }
    }
    const user = userByKey.get(key)
    if (user) {
      return {
        key: user.key,
        label: user.label,
        tone: user.tone,
        path: `assets/bg/user-${user.id}.${IMAGE_EXT[user.mime] ?? 'img'}`,
        data: user.data,
        credit: false,
      }
    }
    return undefined
  }

  const fallback = resolveBg(DEFAULT_BG_KEY)
  if (!fallback) throw new Error('既定背景プリセットが見つからない')
  const defaultEntry = resolveBg(opts.defaultBg ?? '') ?? fallback

  // 立ち絵：話者に自動で紐づく（cue.expression は表情の指定だけ）。sceneBreak で消え、
  // **話者が明示された**セリフで交代する——立ち絵の無い話者・？？？なら消える（名前枠と
  // 立っている人物の食い違いを作らない）。話者未設定のセリフ・地の文は据え置き（ちらつかせない）。
  const spriteAssets = (opts.userAssets ?? []).filter((a) => a.kind === 'sprite')
  const spritePathOf = (a: NovelGameUserAsset) =>
    `assets/sprite/user-${a.id}.${IMAGE_EXT[a.mime] ?? 'img'}`

  // 使った背景・立ち絵だけを同梱する（キー→実体の整合は used が単一の真実）
  const used = new Map<string, BgEntry>([[defaultEntry.key, defaultEntry]])
  const usedSprites = new Map<string, NovelGameUserAsset>()
  let current = ''
  let currentSprite = ''
  const scenarioPages = pages.map((page, index): ScenarioPage => {
    const block = blockById.get(page.blockId)
    const cueEntry = page.bg ? resolveBg(page.bg) : undefined
    const target = cueEntry?.key ?? (index === 0 ? defaultEntry.key : undefined)
    let bg: string | undefined
    if (target && target !== current) {
      bg = target
      current = target
      if (cueEntry) used.set(cueEntry.key, cueEntry)
    }
    let sprite: string | undefined // '' ＝ 立ち絵を消す
    if (spriteAssets.length > 0) {
      let desired = page.sceneBreak ? '' : currentSprite
      if (page.kind === 'dialogue' && page.speaker) {
        const chosen =
          page.speaker !== MASKED_SPEAKER
            ? pickSprite(spriteAssets, page.speaker, page.expression)
            : undefined
        desired = chosen?.key ?? ''
        if (chosen) usedSprites.set(chosen.key, chosen)
      }
      if (desired !== currentSprite) {
        sprite = desired
        currentSprite = desired
      }
    }
    return {
      id: page.blockId,
      kind: page.kind,
      ...(page.speaker ? { speaker: page.speaker } : {}),
      ...(page.beat > 0 ? { beat: page.beat } : {}),
      ...(page.sceneBreak ? { sceneBreak: true } : {}),
      ...(page.transition ? { transition: page.transition } : {}),
      ...(bg ? { bg } : {}),
      ...(sprite !== undefined ? { sprite } : {}),
      units: unitsOfInlines(block?.inlines ?? []),
      text: block ? plainTextOfBlock(block) : '',
    }
  })

  const usedList = [...used.values()]
  const usedSpriteList = [...usedSprites.values()]
  const scenario: GameScenario = {
    v: 1,
    workTitle: work.title,
    episodeTitle: episode.title,
    ...(work.author ? { author: work.author } : {}),
    saveKey: `kotonoha:novel-game:${work.id}:${episode.id}`,
    defaultBg: defaultEntry.key,
    bgs: Object.fromEntries(
      usedList.map((e) => [e.key, { src: e.path, label: e.label, tone: e.tone }]),
    ),
    ...(usedSpriteList.length > 0
      ? {
          sprites: Object.fromEntries(
            usedSpriteList.map((a) => [a.key, { src: spritePathOf(a), label: a.label }]),
          ),
        }
      : {}),
    ...(opts.font ? { fontSrc: FONT_PATH } : {}),
    credits: buildGameCredits({
      bgLabels: usedList.filter((e) => e.credit).map((e) => e.label),
      fontEmbedded: Boolean(opts.font),
    }),
    pages: scenarioPages,
  }

  return [
    { path: 'index.html', data: buildPlayerHtml(scenario) },
    { path: 'readme.txt', data: buildReadme(work, episode, Boolean(opts.font)) },
    ...(opts.font
      ? [
          { path: FONT_PATH, data: opts.font.data },
          { path: FONT_LICENSE_PATH, data: opts.font.licenseText },
        ]
      : []),
    ...usedList.map((e) => ({ path: e.path, data: e.data })),
    ...usedSpriteList.map((a) => ({ path: spritePathOf(a), data: a.data })),
  ]
}

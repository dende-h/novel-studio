import { applyCues, plainTextOfBlock, type Staging, toPages } from '../game'
import {
  buildGameCredits,
  DEFAULT_BG_KEY,
  type PresetBackground,
  presetBackground,
  presetBgSvg,
} from '../game/presets'
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

export interface NovelGameOptions {
  /** 既定背景のキー。未指定・未知キーは DEFAULT_BG_KEY に倒す */
  defaultBg?: string
  /** 同梱フォント。無ければシステムの明朝で動く（書き出しは失敗させない） */
  font?: NovelGameFont
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

  const fallback = presetBackground(DEFAULT_BG_KEY)
  if (!fallback) throw new Error('既定背景プリセットが見つからない')
  const defaultPreset = presetBackground(opts.defaultBg ?? '') ?? fallback

  // 使った背景だけを同梱する（キー→実体の整合は used が単一の真実）
  const used = new Map<string, PresetBackground>([[defaultPreset.key, defaultPreset]])
  let current = ''
  const scenarioPages = pages.map((page, index): ScenarioPage => {
    const block = blockById.get(page.blockId)
    const cuePreset = page.bg ? presetBackground(page.bg) : undefined
    const target = cuePreset?.key ?? (index === 0 ? defaultPreset.key : undefined)
    let bg: string | undefined
    if (target && target !== current) {
      bg = target
      current = target
      if (cuePreset) used.set(cuePreset.key, cuePreset)
    }
    return {
      id: page.blockId,
      kind: page.kind,
      ...(page.speaker ? { speaker: page.speaker } : {}),
      ...(page.beat > 0 ? { beat: page.beat } : {}),
      ...(page.sceneBreak ? { sceneBreak: true } : {}),
      ...(page.transition ? { transition: page.transition } : {}),
      ...(bg ? { bg } : {}),
      units: unitsOfInlines(block?.inlines ?? []),
      text: block ? plainTextOfBlock(block) : '',
    }
  })

  const usedList = [...used.values()]
  const scenario: GameScenario = {
    v: 1,
    workTitle: work.title,
    episodeTitle: episode.title,
    ...(work.author ? { author: work.author } : {}),
    saveKey: `kotonoha:novel-game:${work.id}:${episode.id}`,
    defaultBg: defaultPreset.key,
    bgs: Object.fromEntries(
      usedList.map((p) => [
        p.key,
        { src: `assets/bg/${p.slug}.svg`, label: p.label, tone: p.tone },
      ]),
    ),
    ...(opts.font ? { fontSrc: FONT_PATH } : {}),
    credits: buildGameCredits({
      bgLabels: usedList.map((p) => p.label),
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
    ...usedList.map((p) => ({ path: `assets/bg/${p.slug}.svg`, data: presetBgSvg(p) })),
  ]
}

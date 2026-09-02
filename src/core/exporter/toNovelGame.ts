import { applyCues, MASKED_SPEAKER, plainTextOfBlock, type Staging, toPages } from '../game'
import { gameAssetKey, pickSprite, type UserGameAsset } from '../game/assets'
import { buildGameCredits, DEFAULT_BG_KEY, presetBackground, presetBgSvg } from '../game/presets'
import { presetSe, SE_STOP, type SeStep } from '../game/sePresets'
import { presetSprite } from '../game/spritePresets'
import { parseTemplateKey } from '../game/templates'
import { dataUrlMime } from '../image'
import type { Episode, Inline, Work } from '../schema'
import type { ZipInput } from '../zip'
import {
  buildPlayerHtml,
  type GameScenario,
  type ScenarioPage,
  type ScenarioStageEntry,
} from './novelGamePlayer'

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
  /** image/webp・audio/mpeg など。zip 内の拡張子に使う */
  mime: string
  data: Uint8Array
  /**
   * 省略は 'bg'（持ち込み背景しか無かったころの呼び出しと互換）。
   * 'se' は運営テンプレの効果音ファイル（目録の実体・`preset` 必須・キーは `preset:se/<slug>`）
   */
  kind?: 'bg' | 'sprite' | 'se'
  /** 立ち絵のみ：この立ち絵の人物（Cue.speaker と突き合わせ） */
  character?: string
  /** 立ち絵のみ：表情名（省略は「通常」扱い） */
  expression?: string
  /** テンプレ立ち絵由来ならそのキー（クレジットに運営素材として載せる） */
  preset?: string
  /** 立ち絵の既定（同じ人物の最初の1枚）を決める登録時刻 */
  createdAt?: number
  /** インライン（単一 HTML）ビルド用の data URL。inline 指定時はこちらが実体になる */
  dataUrl?: string
}

export interface NovelGameOptions {
  /** 既定背景のキー。未指定・未知キーは DEFAULT_BG_KEY に倒す */
  defaultBg?: string
  /** 同梱フォント。無ければシステムの明朝で動く（書き出しは失敗させない） */
  font?: NovelGameFont
  /** 手元にある持ち込み素材。cue / defaultBg が指す分だけ zip へ同梱される */
  userAssets?: NovelGameUserAsset[]
  /**
   * 単一 HTML ビルド（grove 埋め込み・契約 v4）。素材をファイルではなく data URL で
   * シナリオに内包し、返り値は index.html の 1 件だけになる。フォントは配信側の
   * URL（fontHref）を参照する（HTML へ埋めると話ごとに MB 単位で太るため）。
   */
  inline?: {
    fontHref?: string
    /**
     * 持ち込み素材を実体（data URL）ではなく `asset:<id>` の参照で書く（契約 v5）。
     * 実体は**作品ぶん1回だけ**送り、配信側が話ごとの HTML へ埋め戻す＝
     * 同じ立ち絵を話数ぶん送り直さない（投稿1回の上限 20MB に早々に当たっていた）。
     */
    externalAssets?: boolean
  }
  /**
   * 開いた瞬間に始めるページ番号（**アプリ内プレビュー専用**）。
   * 書き出し・投稿では渡さない＝読者はいつもタイトル画面から始める。
   */
  startAt?: number
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

/** zip に入れる効果音 1 つ（合成レシピか音声ファイル）。 */
interface SeEntry {
  key: string
  label: string
  /** 合成レシピ（組み込み・ファイルが無いときの控え）と、ループの周期（秒・省略＝長さ） */
  steps?: SeStep[]
  period?: number
  /** 音声ファイル（目録の実体）。path はシナリオの src、data は zip に入れる実体 */
  path?: string
  data?: Uint8Array
}

const IMAGE_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
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
  // inline（単一 HTML）ビルドでは path をファイルパスではなく data URL にする。
  const inline = opts.inline
  const userByKey = new Map(
    (opts.userAssets ?? []).filter((a) => (a.kind ?? 'bg') === 'bg').map((a) => [a.key, a]),
  )
  // 渡された素材を先に引く：テンプレ背景の**画像**（目録から取った実体・`preset` 付き）は
  // 組み込み SVG と同じキーで来るので、画像があればそちらを使い、無ければ SVG に倒す
  const resolveBg = (key: string): BgEntry | undefined => {
    const user = userByKey.get(key)
    if (user) {
      if (inline && !user.dataUrl) return undefined // 内包できない実体は無視（壊さない）
      const tplSlug = user.preset ? parseTemplateKey(user.preset)?.slug : undefined
      return {
        key: user.key,
        label: user.label,
        tone: user.tone,
        path: inline
          ? inline.externalAssets
            ? `asset:${user.id}`
            : (user.dataUrl ?? '')
          : `assets/bg/${tplSlug ?? `user-${user.id}`}.${IMAGE_EXT[user.mime] ?? 'img'}`,
        data: user.data,
        // 運営素材（テンプレ由来）だけクレジットに載せる
        credit: Boolean(user.preset),
      }
    }
    const preset = presetBackground(key)
    if (preset) {
      const svg = presetBgSvg(preset)
      return {
        key: preset.key,
        label: preset.label,
        tone: preset.tone,
        path: inline
          ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
          : `assets/bg/${preset.slug}.svg`,
        data: svg,
        credit: true,
      }
    }
    return undefined
  }

  // 効果音：目録の音声ファイル（`preset` 付き）があればそれ、無ければ組み込みの合成レシピ
  const seByKey = new Map(
    (opts.userAssets ?? []).filter((a) => a.kind === 'se').map((a) => [a.key, a]),
  )
  const resolveSe = (key: string): SeEntry | undefined => {
    const file = seByKey.get(key)
    if (file && (!inline || file.dataUrl)) {
      const tplSlug = file.preset ? parseTemplateKey(file.preset)?.slug : undefined
      return {
        key: file.key,
        label: file.label,
        path: inline
          ? inline.externalAssets
            ? `asset:${file.id}`
            : (file.dataUrl ?? '')
          : `assets/se/${tplSlug ?? `user-${file.id}`}.${IMAGE_EXT[file.mime] ?? 'bin'}`,
        data: file.data,
      }
    }
    const preset = presetSe(key)
    return preset
      ? {
          key: preset.key,
          label: preset.label,
          steps: preset.steps,
          ...(preset.period !== undefined ? { period: preset.period } : {}),
        }
      : undefined
  }

  const fallback = resolveBg(DEFAULT_BG_KEY)
  if (!fallback) throw new Error('既定背景プリセットが見つからない')
  const defaultEntry = resolveBg(opts.defaultBg ?? '') ?? fallback

  // 立ち絵：話者に自動で紐づく舞台（最大2人・1人=中央/2人=左右。cue.expression は表情の指定だけ）。
  //  - 初登場は中央。2人目が来たら先客が左へ寄り、右に入る。3人目は「最近話していない方」と
  //    交代し、席（左右）を引き継ぐ。同じ話者の表情替えはその場で差し替え。
  //  - いま話している人物だけ明るい（a=1）。立ち絵の無い話者・？？？のセリフは**退場させず**
  //    全員減光（画面外の声として扱う）。話者未設定のセリフ・地の文は据え置き（ちらつかせない）。
  //  - 場面の切れ目（sceneBreak）で全員退場。
  const spriteAssets = (opts.userAssets ?? []).filter(
    (a) => a.kind === 'sprite' && (!inline || a.dataUrl),
  )
  const spritePathOf = (a: NovelGameUserAsset) =>
    inline
      ? inline.externalAssets
        ? `asset:${a.id}`
        : (a.dataUrl ?? '')
      : `assets/sprite/user-${a.id}.${IMAGE_EXT[a.mime] ?? 'img'}`

  // 使った背景・立ち絵だけを同梱する（キー→実体の整合は used が単一の真実）
  const used = new Map<string, BgEntry>([[defaultEntry.key, defaultEntry]])
  const usedSprites = new Map<string, NovelGameUserAsset>()
  const usedSes = new Map<string, SeEntry>()
  let current = ''
  interface Standing {
    key: string
    char: string
    pos: 'l' | 'c' | 'r'
    lastSpoke: number
  }
  let standing: Standing[] = []
  let activeChar: string | null = null
  /** 立ち絵を出さない区間か（hideSprite で入り、場面の切れ目か明示の登場で出る）。 */
  let spritesHidden = false
  let lastStageMark = '[]'
  /** 舞台へ入れる（席の割り当て共通則）。既に立っている人物は表情（key）だけ差し替える。 */
  const enterStage = (key: string, char: string, at: number): void => {
    const already = standing.find((s) => s.char === char)
    if (already) {
      already.key = key
      already.lastSpoke = at
      return
    }
    if (standing.length === 0) {
      standing.push({ key, char, pos: 'c', lastSpoke: at })
    } else if (standing.length === 1) {
      const first = standing[0]
      if (first) first.pos = 'l'
      standing.push({ key, char, pos: 'r', lastSpoke: at })
    } else {
      const out = standing.reduce((a, b) => (a.lastSpoke <= b.lastSpoke ? a : b))
      out.key = key
      out.char = char
      out.lastSpoke = at
    }
  }
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
    let stage: ScenarioStageEntry[] | undefined
    if (spriteAssets.length > 0) {
      if (page.sceneBreak) {
        standing = []
        activeChar = null
        spritesHidden = false
      }
      // 立ち絵を出さない（hideSprite）：いま立っている人物も下ろす。人物ごと描いた一枚絵の
      // 背景に立ち絵を重ねないための欄で、**次の場面の切れ目まで**話者の自動表示も止める。
      if (page.hideSprite) {
        standing = []
        activeChar = null
        spritesHidden = true
      }
      // 登場（appear）：セリフの前から立ち絵を出す。名前枠は出さず、明るくもしない。
      // 既に立っている人物への appear は据え置き（表情は speaker+expression の領分）。
      // 明示の指定なので、出さない区間もここで終わる（同じ場面でまた出したいときの戻り道）。
      if (page.appear && page.appear !== MASKED_SPEAKER) {
        spritesHidden = false
        if (!standing.some((s) => s.char === page.appear)) {
          const chosen = pickSprite(spriteAssets, page.appear)
          if (chosen) {
            usedSprites.set(chosen.key, chosen)
            enterStage(chosen.key, page.appear, index)
          }
        }
      }
      if (page.kind === 'dialogue' && page.speaker) {
        const chosen =
          !spritesHidden && page.speaker !== MASKED_SPEAKER
            ? pickSprite(spriteAssets, page.speaker, page.expression)
            : undefined
        if (!chosen) {
          activeChar = null
        } else {
          usedSprites.set(chosen.key, chosen)
          enterStage(chosen.key, page.speaker, index)
          activeChar = page.speaker
        }
      }
      const mark = standing.map(
        (s): ScenarioStageEntry => ({
          k: s.key,
          p: s.pos,
          ...(s.char === activeChar ? { a: 1 as const } : {}),
        }),
      )
      const serialized = JSON.stringify(mark)
      if (serialized !== lastStageMark) {
        stage = mark
        lastStageMark = serialized
      }
    }
    // 効果音：ページ表示の瞬間に 1 回鳴らす。未知キーは無視（壊さない）
    // 「止める」はレシピを持たない予約キー。実体が無くてもページには載せる（ループを終わらせる合図）
    const stopSe = page.se === SE_STOP
    const se = page.se && !stopSe ? resolveSe(page.se) : undefined
    if (se) usedSes.set(se.key, se)
    return {
      id: page.blockId,
      kind: page.kind,
      ...(page.speaker ? { speaker: page.speaker } : {}),
      ...(page.beat > 0 ? { beat: page.beat } : {}),
      ...(page.sceneBreak ? { sceneBreak: true } : {}),
      ...(page.transition ? { transition: page.transition } : {}),
      ...(bg ? { bg } : {}),
      ...(stage !== undefined ? { stage } : {}),
      ...(stopSe ? { se: SE_STOP } : se ? { se: se.key } : {}),
      ...(se && page.seRepeat ? { seRepeat: page.seRepeat } : {}),
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
    ...(opts.startAt !== undefined ? { start: opts.startAt } : {}),
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
    ...(usedSes.size > 0
      ? {
          ses: Object.fromEntries(
            [...usedSes.values()].map((s) => [
              s.key,
              s.steps
                ? {
                    label: s.label,
                    steps: s.steps,
                    ...(s.period !== undefined ? { period: s.period } : {}),
                  }
                : { label: s.label, src: s.path ?? '' },
            ]),
          ),
        }
      : {}),
    ...(opts.font ? { fontSrc: FONT_PATH } : inline?.fontHref ? { fontSrc: inline.fontHref } : {}),
    credits: buildGameCredits({
      bgLabels: usedList.filter((e) => e.credit).map((e) => e.label),
      // テンプレ立ち絵だけ運営素材としてクレジットに載せる（重複は畳む）
      spriteLabels: [
        ...new Set(
          usedSpriteList
            .filter((a) => a.preset)
            .map((a) => (a.preset ? (presetSprite(a.preset)?.label ?? 'シルエット') : '')),
        ),
      ].filter(Boolean),
      seLabels: [...usedSes.values()].filter((s) => s.steps).map((s) => s.label),
      seFileLabels: [...usedSes.values()].filter((s) => !s.steps).map((s) => s.label),
      fontEmbedded: Boolean(opts.font) || Boolean(inline?.fontHref),
    }),
    pages: scenarioPages,
  }

  // inline ビルドは素材を data URL で内包済み＝index.html の 1 件だけ返す
  if (inline) return [{ path: 'index.html', data: buildPlayerHtml(scenario) }]

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
    ...[...usedSes.values()].flatMap((s) =>
      s.path && s.data ? [{ path: s.path, data: s.data }] : [],
    ),
  ]
}

/**
 * 1話ぶんの**自己完結プレイヤー HTML**（grove 埋め込み・契約 v4）。
 * 素材（背景・立ち絵・効果音レシピ）をすべて内包し、外部参照はフォント（fontHref・
 * 配信側が /game-assets/fonts/ で持つ契約）だけ。プレイヤーは iframe に埋められると
 * 親へ postMessage（type: 'kotonoha-novel-game'）で進捗と読了を知らせる。
 */
export function buildNovelGameHtml(
  work: Work,
  episode: Episode,
  staging: Staging | undefined,
  opts: {
    defaultBg?: string
    fontHref?: string
    gameAssets?: UserGameAsset[]
    /** アプリ内プレビュー専用：この行から始める（書き出し・投稿では渡さない） */
    startAt?: number
    /** 持ち込み素材を実体ではなく `asset:<id>` で書く（契約 v5・`buildNovelGamePlayer` から） */
    externalAssets?: boolean
  } = {},
): string {
  const userAssets: NovelGameUserAsset[] = (opts.gameAssets ?? []).map((a) => ({
    key: gameAssetKey(a),
    id: a.id,
    label: a.name,
    tone: a.tone,
    mime: dataUrlMime(a.dataUrl) ?? 'image/webp', // inline では実体は dataUrl（拡張子は未使用）
    data: new Uint8Array(0),
    kind: a.kind,
    ...(a.character ? { character: a.character } : {}),
    ...(a.expression ? { expression: a.expression } : {}),
    ...(a.preset ? { preset: a.preset } : {}),
    createdAt: a.createdAt,
    dataUrl: a.dataUrl,
  }))
  const files = buildNovelGameFiles(work, episode, staging, {
    defaultBg: opts.defaultBg,
    userAssets,
    inline: {
      ...(opts.fontHref ? { fontHref: opts.fontHref } : {}),
      ...(opts.externalAssets ? { externalAssets: true } : {}),
    },
    ...(opts.startAt !== undefined ? { startAt: opts.startAt } : {}),
  })
  const html = files.find((f) => f.path === 'index.html')?.data
  if (typeof html !== 'string') throw new Error('プレイヤー HTML を生成できなかった')
  return html
}

/**
 * 契約 v5 用：持ち込み素材を `asset:<id>` の参照で書いたプレイヤー HTML と、
 * **その話が実際に使った素材の id**（実体は作品ぶん1回だけ送る側で集める）。
 *
 * 同じ立ち絵・背景を話数ぶん送り直すと、投稿1回の上限（20MB）に十数話で当たっていた。
 * 参照にすると 1 話ぶんは数十 KB に収まり、話数を増やしても投稿が通る。
 */
export function buildNovelGamePlayer(
  work: Work,
  episode: Episode,
  staging: Staging | undefined,
  opts: { defaultBg?: string; fontHref?: string; gameAssets?: UserGameAsset[] } = {},
): { html: string; assetIds: string[] } {
  const html = buildNovelGameHtml(work, episode, staging, { ...opts, externalAssets: true })
  // 実際に埋まった参照だけを拾う（使わなかった素材は送らない）
  const assetIds = (opts.gameAssets ?? [])
    .map((a) => a.id)
    .filter((id) => html.includes(`asset:${id}`))
  return { html, assetIds }
}

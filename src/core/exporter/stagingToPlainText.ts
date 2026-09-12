import {
  type Cue,
  classifyBlock,
  findOrphanCues,
  plainTextOfBlock,
  type Staging,
  suggestSceneBreaks,
  suggestSpeaker,
} from '../game'
import type { UserGameAsset } from '../game/assets'
import { DEFAULT_EXPRESSION, spriteExpressionsOf, userAssetKey } from '../game/assets'
import { GAME_FEATURES } from '../game/features'
import { BLACKOUT_BG_KEY, BLACKOUT_BG_LABEL } from '../game/presets'
import { SPRITE_POSITION_LABELS } from '../game/stage'
import {
  isBgmReady,
  mergeBackgroundCatalog,
  mergeBgmCatalog,
  mergeSeCatalog,
  type TemplateManifest,
  visibleTemplates,
} from '../game/templates'
import type { Episode, Work } from '../schema'

/**
 * 演出譜（Staging）を MCP 向けのプレーンテキストにする。
 *
 * 行ごとに [block_id] を添える＝ set_staging の対象指定に使う（plotToPlainText の
 * [beat_id] と同じ流儀）。確定済みの演出は 【…】、自動の提案は 〔提案: …〕 で区別する
 * （提案は Staging を書き換えない。D-GAME-SCENE-MANUAL / D-GAME-SPEAKER-MCP）。
 * 末尾に使える背景キーの一覧を載せ、AI が bg を選べるようにする。
 */
export function stagingToPlainText(
  work: Work,
  episode: Episode,
  staging: Staging | undefined,
  gameAssets: UserGameAsset[],
  /** 運営テンプレの目録（無ければ組み込みの 18 枚だけを案内する） */
  templates: TemplateManifest | null = null,
): string {
  const cueByBlock = new Map((staging?.cues ?? []).map((c) => [c.blockId, c]))
  const sceneBreakSuggestions = new Set(suggestSceneBreaks(episode.blocks))
  const orphans = staging ? findOrphanCues(staging, episode) : []

  const lines: string[] = []
  let pendingGaps = 0
  for (const [index, block] of episode.blocks.entries()) {
    const kind = classifyBlock(block)
    if (kind === 'gap') {
      pendingGaps++
      continue
    }
    if (pendingGaps > 0) {
      lines.push(`（空行 ${pendingGaps}）`)
      pendingGaps = 0
    }
    const cue = cueByBlock.get(block.id)
    const marks: string[] = []
    if (cue) marks.push(`【${cueSummary(cue)}】`)
    const hints: string[] = []
    if (kind === 'dialogue' && !cue?.speaker) {
      const candidate = suggestSpeaker(episode.blocks, index, work.glossary ?? [])
      if (candidate) hints.push(`話者候補=${candidate}`)
    }
    if (sceneBreakSuggestions.has(block.id) && !cue?.sceneBreak) hints.push('場面の切れ目？')
    if (hints.length > 0) marks.push(`〔提案: ${hints.join('／')}〕`)
    const label = kind === 'dialogue' ? 'セリフ' : '地の文'
    const suffix = marks.length > 0 ? ` ${marks.join(' ')}` : ''
    lines.push(`[block_id: ${block.id}] ${label}: ${plainTextOfBlock(block)}${suffix}`)
  }

  const head = [
    `「${episode.title}」の演出譜（付いている演出 ${staging?.cues.length ?? 0} 件）。`,
    '各行の [block_id] を set_staging に渡して、話者・場面の切れ目・背景・BGM を付ける。本文は変わらない。',
  ].join('\n')

  const sections: string[] = [head]
  sections.push(lines.length > 0 ? lines.join('\n') : '（この話にはまだ本文がありません）')

  if (orphans.length > 0) {
    sections.push(
      [
        '行き先を失った演出（本文の変更で行が無くなった。set_staging の clear: true で外せる）:',
        ...orphans.map((c) => `- [block_id: ${c.blockId}] ${cueSummary(c)}`),
      ].join('\n'),
    )
  }

  const bgAssets = gameAssets.filter((a) => a.kind === 'bg')
  const userLines =
    bgAssets.length > 0
      ? bgAssets.map((a) => `- ${userAssetKey(a.id)} … ${a.name}（持ち込み画像）`)
      : ['- 持ち込み画像はまだありません（アプリの「演出」画面で追加できます）']
  sections.push(
    [
      '使える背景（bg）キー:',
      `- ${BLACKOUT_BG_KEY} … ${BLACKOUT_BG_LABEL}（真っ黒にする予約キー）`,
      ...visibleTemplates(mergeBackgroundCatalog(templates)).map((p) => `- ${p.key} … ${p.label}`),
      ...userLines,
    ].join('\n'),
  )

  // BGM は運営テンプレの曲だけ。組み込みの枠（22 曲）は曲が入るまで「準備中」＝選べるが鳴らない。
  // 次の曲か bgm: "stop" まで続く
  const bgms = visibleTemplates(mergeBgmCatalog(templates))
  sections.push(
    [
      '使える BGM（bgm）キー（この行から鳴り始め、次の曲か bgm: "stop" まで続く。場面の切れ目では止まらない。',
      '「準備中」の曲は選べるが、曲が入るまで書き出し・投稿では鳴らない）:',
      ...(bgms.length > 0
        ? bgms.map(
            (b) =>
              `- ${b.key} … ${b.label}${b.builtin ? `（${b.builtin.note}）` : ''}${isBgmReady(b) ? '' : '【準備中】'}`,
          )
        : ['- 使える曲はまだありません（運営がテンプレとして用意した曲だけ選べます）']),
      '- stop … 鳴っている BGM をここで止める（予約キー）',
    ].join('\n'),
  )

  // 効果音を出さない版（GAME_FEATURES.se＝false）では一覧を出さない（AI に無い欄を勧めない）
  if (GAME_FEATURES.se) {
    sections.push(
      [
        '使える効果音（se）キー（その行の表示と同時に鳴る。',
        'se_repeat: once（既定）/ twice / loop。loop は次の場面の切れ目か se: "stop" まで続く）:',
        ...visibleTemplates(mergeSeCatalog(templates)).map((p) => `- ${p.key} … ${p.label}`),
        '- stop … 鳴っている環境音をここで止める（レシピは持たない予約キー）',
      ].join('\n'),
    )
  }

  // 立ち絵は話者とは独立に、席ごとの指示（sprites）で出す
  const spriteCharacters = [
    ...new Set(
      gameAssets.filter((a) => a.kind === 'sprite' && a.character).map((a) => a.character),
    ),
  ] as string[]
  const spriteLines =
    spriteCharacters.length > 0
      ? spriteCharacters.map(
          (c) => `- ${c} … 表情: ${spriteExpressionsOf(gameAssets, c).join('／')}`,
        )
      : ['- 立ち絵はまだありません（アプリの「演出」画面で追加できます）']
  sections.push(
    [
      '立ち絵（話者とは独立。sprites に席ごとの指示を渡す＝',
      '[{ position: left / center / right / auto, character: 人物名, expression: 表情名 }]。',
      `3 人まで。指示した席だけ変わり、次の指示か場面の切れ目・hide_sprite まで立ち続ける。`,
      `表情は省略＝立っていればそのまま、初めてなら「${DEFAULT_EXPRESSION}」。character を空にして position を渡すとその席を下げる。`,
      '話者を付けても立ち絵は出ない。話者が舞台に立っていればその人だけ明るくなる）:',
      ...spriteLines,
    ].join('\n'),
  )

  return sections.join('\n\n')
}

/** cue の中身を短い日本語で言う（一覧・orphan 表示用）。 */
function cueSummary(cue: Cue): string {
  const parts: string[] = []
  if (cue.speaker) parts.push(`話者=${cue.speaker}`)
  if (cue.sprites) {
    parts.push(
      cue.sprites.length === 0
        ? '立ち絵=指示なし'
        : `立ち絵=${cue.sprites
            .map((sp) => {
              const seat = sp.pos ? SPRITE_POSITION_LABELS[sp.pos] : '自動'
              if (!sp.character) return `${seat}:なし`
              return `${seat}:${sp.character}${sp.expression ? `（${sp.expression}）` : ''}`
            })
            .join('・')}`,
    )
  }
  if (cue.expression) parts.push(`表情=${cue.expression}`)
  if (cue.appear) parts.push(`登場=${cue.appear}`)
  if (cue.hideSprite) parts.push('立ち絵なし')
  if (cue.sceneBreak) parts.push('場面の切れ目')
  if (cue.bg) parts.push(`背景=${cue.bg}`)
  if (cue.bgm) parts.push(`BGM=${cue.bgm}`)
  if (GAME_FEATURES.se && cue.se) parts.push(`効果音=${cue.se}`)
  if (GAME_FEATURES.se && cue.seRepeat) {
    parts.push(`鳴らし方=${cue.seRepeat === 'loop' ? 'ずっと' : '2回'}`)
  }
  if (cue.transition) parts.push(`切り替え=${cue.transition}`)
  return parts.length > 0 ? parts.join('／') : '（内容なし）'
}

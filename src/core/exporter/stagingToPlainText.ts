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
import { PRESET_BACKGROUNDS } from '../game/presets'
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
    '各行の [block_id] を set_staging に渡して、話者・場面の切れ目・背景を付ける。本文は変わらない。',
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
      ...PRESET_BACKGROUNDS.map((p) => `- ${p.key} … ${p.label}`),
      ...userLines,
    ].join('\n'),
  )

  // 立ち絵は話者から自動で出る。AI が選べるのは表情（expression）だけ
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
      `立ち絵（話者を付けると自動で表示。表情は expression で指定・省略は「${DEFAULT_EXPRESSION}」）:`,
      ...spriteLines,
    ].join('\n'),
  )

  return sections.join('\n\n')
}

/** cue の中身を短い日本語で言う（一覧・orphan 表示用）。 */
function cueSummary(cue: Cue): string {
  const parts: string[] = []
  if (cue.speaker) parts.push(`話者=${cue.speaker}`)
  if (cue.expression) parts.push(`表情=${cue.expression}`)
  if (cue.sceneBreak) parts.push('場面の切れ目')
  if (cue.bg) parts.push(`背景=${cue.bg}`)
  if (cue.bgm) parts.push(`BGM=${cue.bgm}`)
  if (cue.se) parts.push(`効果音=${cue.se}`)
  if (cue.transition) parts.push(`切り替え=${cue.transition}`)
  return parts.length > 0 ? parts.join('／') : '（内容なし）'
}

import { plainTextOfBlock } from '../game'
import type { Block } from '../schema'
import { classifyScriptBlock } from './index'

export interface ScriptNotice {
  blockIndex: number
  code:
    | 'missing-slug'
    | 'empty-slug'
    | 'missing-speaker'
    | 'unrecognized-speaker'
    | 'unclosed-bracket'
    | 'dialogue-period'
    | 'arabic-numeral'
    | 'camera-direction'
    | 'unknown-cast'
  message: string
}

export interface ProofreadOptions {
  /**
   * 登場人物表に載る名前（用語集の「人物」の名前と別名）。渡したときだけ、
   * 表に無い話者を知らせる。undefined なら確認しない。
   */
  cast?: string[]
}

/** 話者名から（補足）を外す：「ユイ（声）」→「ユイ」。 */
export const speakerBaseName = (speaker: string) => speaker.replace(/（[^（）]*）$/u, '').trim()

/** ト書きに書かないのが一般的な、カメラワーク・演出の指示語。 */
const CAMERA_WORDS =
  /(カメラ|ズーム|クローズアップ|アップで|ＵＰ|\bUP\b|Ｃ[・．.]Ｕ|C\.U\.|パンして|ティルト|ドリー|フェードイン|フェードアウト|Ｆ[・．.]Ｉ|Ｆ[・．.]Ｏ|F\.I\.|F\.O\.)/u

/** 書式上の確認候補。本文の修正や保存・書き出しの制限は行わない。 */
export function proofreadScript(blocks: Block[], opts: ProofreadOptions = {}): ScriptNotice[] {
  const notices: ScriptNotice[] = []
  const lines = blocks.map((block) => ({
    text: plainTextOfBlock(block),
    ...classifyScriptBlock(block),
  }))
  const first = lines.findIndex((line) => line.kind !== 'blank')
  if (first >= 0 && !lines.some((line) => line.kind === 'slug')) {
    notices.push({
      blockIndex: first,
      code: 'missing-slug',
      message: '場面の柱がありません。場面を示す場合は「○場所（時間）」を入れます。',
    })
  }
  const cast = opts.cast ? new Set(opts.cast.map((n) => n.trim()).filter(Boolean)) : null
  const reported = new Set<string>()
  for (const [blockIndex, line] of lines.entries()) {
    if (line.kind === 'blank') continue
    const add = (code: ScriptNotice['code'], message: string) =>
      notices.push({ blockIndex, code, message })
    if (line.kind === 'slug' && !line.text.trim().slice(1).trim()) {
      add('empty-slug', '柱の場所が空です。「○公園（夕方）」のように場所を書きます。')
    }
    if (line.kind === 'dialogue' && !line.speaker) {
      add('missing-speaker', '話者名のないセリフです。必要なら鉤括弧の前に名前を書きます。')
    }
    if (line.kind === 'dialogue' && line.speaker && cast) {
      const name = speakerBaseName(line.speaker)
      if (name && !cast.has(name) && !reported.has(name)) {
        reported.add(name)
        add(
          'unknown-cast',
          `「${name}」は用語集の人物にありません。登場人物表に載せるには、用語集に人物として登録します。`,
        )
      }
    }
    if (line.kind === 'dialogue' && /[。．]\s*[」』]\s*$/u.test(line.text)) {
      add('dialogue-period', 'セリフの最後に句点（。）は付けないのが一般的です。')
    }
    if (line.kind === 'direction' && !/^\s/u.test(line.text) && /[「『]/u.test(line.text)) {
      add(
        'unrecognized-speaker',
        'この行はト書きとして表示されます。セリフなら、話者名の空白や長さ、括弧を確認してください。',
      )
    }
    if (line.kind === 'direction' && CAMERA_WORDS.test(line.text)) {
      add(
        'camera-direction',
        'カメラワークや演出の指示はト書きに書かないのが一般的です。目に見える動きに置き換えます。',
      )
    }
    if (/[0-9０-９]/u.test(line.text)) {
      add('arabic-numeral', '縦書きでは数字を漢数字（一、二、十）で書くのが一般的です。')
    }
    const stack: string[] = []
    const pairs: Record<string, string> = { '「': '」', '『': '』', '（': '）', '【': '】' }
    let mismatch = false
    for (const ch of line.text) {
      if (pairs[ch]) stack.push(pairs[ch])
      else if ('」』）】'.includes(ch) && stack.pop() !== ch) mismatch = true
    }
    if (mismatch || stack.length)
      add(
        'unclosed-bracket',
        '括弧の対応を確認してください。この行で開き括弧と閉じ括弧が揃っていません。',
      )
  }
  return notices
}

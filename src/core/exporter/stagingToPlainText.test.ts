import { describe, expect, it } from 'vitest'
import type { Staging } from '../game'
import type { UserGameAsset } from '../game/assets'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Episode, Work } from '../schema'
import { stagingToPlainText } from './stagingToPlainText'

// b1=地の文（[[灯]] 参照つき）/ b2=セリフ / b3,b4=空行 / b5=地の文
const episode = (): Episode => ({
  id: 'e1',
  title: '第一話',
  blocks: parseEpisodeBody('　[[灯]]が振り返った。\n「まだ書いてるんだね」\n\n\n　場面が変わる。'),
})

const work = (): Work => ({
  id: 'w1',
  title: '夜の物語',
  episodes: [episode()],
  glossary: [{ id: 'g1', name: '灯', aliases: [], category: '人物', createdAt: 0, updatedAt: 0 }],
})

describe('stagingToPlainText（MCP 向け演出譜テキスト）', () => {
  it('行ごとに block_id・種別・本文が並び、空行は畳まれる', () => {
    const text = stagingToPlainText(work(), episode(), undefined, [])
    expect(text).toContain('「第一話」の演出譜（付いている演出 0 件）')
    expect(text).toContain('[block_id: b1] 地の文: 　灯が振り返った。')
    expect(text).toContain('[block_id: b2] セリフ: 「まだ書いてるんだね」')
    expect(text).toContain('（空行 2）')
    expect(text).toContain('[block_id: b5] 地の文: 　場面が変わる。')
  })

  it('保存済みの演出は【…】、提案は〔提案: …〕で区別される', () => {
    const staging: Staging = {
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '？？？', bg: 'preset:bg/room-night', transition: 'fade' }],
      updatedAt: 1,
    }
    const text = stagingToPlainText(work(), episode(), staging, [])
    expect(text).toContain('【話者=？？？／背景=preset:bg/room-night／切り替え=fade】')
    // b2 は話者確定済みなので候補は出ない。b5 に場面の切れ目の提案が出る
    expect(text).not.toContain('話者候補')
    expect(text).toMatch(/\[block_id: b5\][^\n]*〔提案: 場面の切れ目？〕/)
  })

  it('話者未設定のセリフには直前の地の文からの候補が提案される', () => {
    const text = stagingToPlainText(work(), episode(), undefined, [])
    expect(text).toMatch(/\[block_id: b2\][^\n]*〔提案: 話者候補=灯[^\n]*〕/)
  })

  it('行き先を失った演出が列挙される', () => {
    const staging: Staging = {
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b99', speaker: '灯', sceneBreak: true }],
      updatedAt: 1,
    }
    const text = stagingToPlainText(work(), episode(), staging, [])
    expect(text).toContain('行き先を失った演出')
    expect(text).toContain('- [block_id: b99] 話者=灯／場面の切れ目')
  })

  it('使える背景キーの一覧（テンプレ24種と持ち込み）が載る', () => {
    const asset: UserGameAsset = {
      id: 'abc',
      kind: 'bg',
      name: '海辺の夕暮れ',
      dataUrl: 'data:image/webp;base64,SGk=',
      tone: ['#111111', '#222222', '#333333'],
      createdAt: 0,
    }
    const text = stagingToPlainText(work(), episode(), undefined, [asset])
    expect(text).toContain('使える背景（bg）キー:')
    expect(text).toContain('- preset:bg/room-day … 室内（昼）')
    expect(text).toContain('- preset:bg/abstract-night … 抽象（夜）')
    expect(text).toContain('- user:abc … 海辺の夕暮れ（持ち込み画像）')
    // 持ち込みが無いときは案内だけ
    expect(stagingToPlainText(work(), episode(), undefined, [])).toContain(
      '持ち込み画像はまだありません',
    )
  })
})

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { handleMcpMessage } from './mcp-server'
import { callMsg, fixtureSnapshot, makeReadDeps, resultText } from './mcp-test-util'

/**
 * ゴールデン：**work_id だけで呼んだときの読み取り出力を全文で凍結する**。
 *
 * 読み取りに索引・絞り込み・応答予算を足す改修は、「既存の利用者（今この MCP を
 * ChatGPT / Claude から使っている作者）の呼び出し結果を 1 バイトも変えない」ことが前提。
 * 既存テストは toContain 中心で全文を押さえていないので、改修の前にここで固定する。
 *
 * **このスナップショットが変わる差分は、原則として通してはいけない。**
 * 意図して出力を変えるときだけ、変更理由をコミットメッセージに書いて更新すること。
 */

const read = async (name: string, args?: Record<string, unknown>) => {
  const { deps } = makeReadDeps(fixtureSnapshot())
  return resultText(await handleMcpMessage(callMsg(name, args), deps))
}

describe('読み取りの既定出力（ゴールデン）', () => {
  it('list_works', async () => {
    expect(await read('list_works')).toMatchInlineSnapshot(`
      "作品が 1 件あります。
      - 星のない空（著者: 灯） — 2話 [work_id: w1]
          - 第一話 灯台 [episode_id: e1]
          - 第二話 海 [episode_id: e2]"
    `)
  })

  it('get_work', async () => {
    expect(await read('get_work', { work_id: 'w1' })).toMatchInlineSnapshot(`
      "※ この作品には世界観設定（作者専用の決め事）が 3 項目あります。編集の前に get_world で必ず確認してください。

      # 星のない空
      著者: 灯

      灯台守の少女が、消えた星を探しに行く話。

      ## 第一話 灯台

      　夜が明けた。
      アカリは灯台（とうだい）の階段をのぼる。

      ## 第二話 海

      星が落ちてきた。"
    `)
  })

  it('get_glossary', async () => {
    expect(await read('get_glossary', { work_id: 'w1' })).toMatchInlineSnapshot(`
      "※ この作品には世界観設定（作者専用の決め事）が 3 項目あります。編集の前に get_world で必ず確認してください。

      # 用語集

      ## アカリ [entry_id: g1]
      分類: 人物 ・ よみ: あかり ・ 別名: 灯の子

      灯台守の少女。

      ### 作者メモ（非公開）
      実は星の欠片から生まれた。

      ## 灯台 [entry_id: g2]
      分類: 場所

      岬の先に立つ古い灯台。

      百年前から光を絶やしたことがない。

      ## 星狩り [entry_id: g3]"
    `)
  })

  it('get_world', async () => {
    expect(await read('get_world', { work_id: 'w1' })).toMatchInlineSnapshot(`
      "# 世界観設定（作者専用・読者には公開されません）

      この作品の決め事です。用語集・プロット・本文を書き換える前に、必ずここに従ってください。

      ## 時代と場所 [slot: stage, note_id: wn1]
      星の消えた海辺の町。時代は近代に近い。

      ## 語り手と文体 [slot: style, note_id: wn2]
      三人称一元視点。アカリの見たものだけを書く。

      ## 色の決め事 [slot: custom, note_id: wn3]
      青は喪失、金は継承を表す。"
    `)
  })

  it('get_plot', async () => {
    expect(await read('get_plot', { work_id: 'w1' })).toMatchInlineSnapshot(`
      "# 世界観設定（作者専用・読者には公開されません）

      この作品の決め事です。用語集・プロット・本文を書き換える前に、必ずここに従ってください。

      ## 時代と場所 [slot: stage, note_id: wn1]
      星の消えた海辺の町。時代は近代に近い。

      ## 語り手と文体 [slot: style, note_id: wn2]
      三人称一元視点。アカリの見たものだけを書く。

      ## 色の決め事 [slot: custom, note_id: wn3]
      青は喪失、金は継承を表す。

      【プロット】星のない空 [plot_id: p1]
      ログライン: 星を失った世界で、少女が最後の光を灯す。
      テーマ: 喪失と継承
      プロットライン: アカリの成長 [line_id: ln1]

      ## 第一幕 出発 [section_id: s1]（2ビート・予定 5,000字）
      日常が壊れるまで。
      1. [済] 灯台の朝 [beat_id: bt1]
         要約: アカリが空から星が消えたことに気づく。
         視点: アカリ ／ 登場: アカリ ／ 舞台: 灯台 ／ 作中時間: 一日目の朝
         ライン: アカリの成長 ／ 予定: 5,000字 ／ 対応話: 第一話 灯台 [episode_id: e1]
         メモ: 静かに始める。
      2. [執筆中] 訪問者 [beat_id: bt2]
         （ガイド: ここで外の世界が入ってくる）

      ## 第二幕 航海 [section_id: s2]（1ビート・予定 3,000字）
      1. [検討中] 海へ [beat_id: bt3]
         要約: 船を出す。
         登場: アカリ
         予定: 3,000字

      伏線:
      - [未回収] 灯台の光が一度だけ揺れる [foreshadow_id: f1]（張る: 灯台の朝 → 回収: 未定） ／ メモ: 第一話の描写

      秘密（読者に伏せる情報）:
      - [開示予定] アカリの出自 [secret_id: sc1]（読者に明かす: 海へ） ／ 真相: 星の欠片から生まれた"
    `)
  })

  it('get_structures', async () => {
    expect(await read('get_structures', { work_id: 'w1' })).toMatchInlineSnapshot(`
      "※ この作品には世界観設定（作者専用の決め事）が 3 項目あります。編集の前に get_world で必ず確認してください。

      【アウトライン】
      1. 第一話 灯台（21字） [episode_id: e1]
         - 星が消える
            - 灯台の描写を厚く
      2. 第二話 海（8字） [episode_id: e2]
         - 船出

      【相関図】
      登場人物: アカリ、灯台
      - アカリ —（守る）→ 灯台"
    `)
  })
})

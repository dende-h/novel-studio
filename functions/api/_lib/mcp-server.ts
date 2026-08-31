/**
 * リモート MCP のプロトコル核（Streamable HTTP の JSON-RPC 2.0 部分）。
 *
 * R2/暗号化/認証から切り離した純ロジック。ライブスナップショットの読み書き I/O を注入するだけで
 * `initialize` / `tools/list` / `tools/call` を処理する（テスト可能・stateless）。
 * 読み取り（list/get 系）に加え、書き込み（set/add/upsert/delete）とクラウドバックアップ操作を公開する。
 * 書き込みはライブスナップショットを更新するだけで、ブラウザ側で「AIの変更を取り込む」で反映される。
 */

import type { CloudBackup } from '../../../src/core/backup'
import {
  plotToPlainText,
  worldPointerLine,
  worldToPlainText,
} from '../../../src/core/exporter/plotToPlainText'
import { stagingToPlainText } from '../../../src/core/exporter/stagingToPlainText'
import { structuresToPlainText } from '../../../src/core/exporter/structureToPlainText'
import { glossaryToPlainText, workToPlainText } from '../../../src/core/exporter/toPlainText'
import { userAssetKey } from '../../../src/core/game/assets'
import {
  addEpisode,
  createWork,
  deleteGlossaryEntry,
  deletePlotBeat,
  deletePlotItem,
  deletePlotWorldNote,
  McpEditError,
  parseStagingCueInputs,
  parseStructure,
  setEpisode,
  setOutlineNotes,
  setPlotMeta,
  setPlotWorldNote,
  setStagingCues,
  setWorkMeta,
  upsertGlossaryEntry,
  upsertPlotBeat,
  upsertPlotForeshadow,
  upsertPlotLine,
  upsertPlotSecret,
  upsertPlotSection,
  upsertStructure,
} from '../../../src/core/mcp-edit'
import { pickPrimaryPlot, WORLD_CUSTOM_SLOT, WORLD_SLOTS } from '../../../src/core/plot'

/** クライアントが未指定のときに名乗る MCP プロトコル版（十分に新しい安定版）。 */
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'novel-studio', version: '1.5.0' } as const

/**
 * クライアント（AI）へ最初に渡す使い方。MCP の `initialize` が返す標準の instructions。
 *
 * ここの主眼は**器の住み分けを毎回思い出させること**。用語集は読者へ公開される器で、
 * 世界観設定は作者だけの器。これを知らないと、AI は設定やネタバレを用語集へ書いてしまう
 * （実際にそうなった）。加えて「書く前に決め事を読む」を促し、毎回の精度を底上げする。
 */
const SERVER_INSTRUCTIONS = [
  'コトノハは小説の執筆アプリです。作品ごとに次の器があります。',
  '',
  '- 本文（get_work / set_episode）… 読者が読む小説そのもの。',
  '- 用語集（get_glossary / upsert_glossary_entry）… 人物・場所・組織・用語・アイテム・生物の事典。',
  '  **公開サイトへ投稿され、読者にも見えます**（その用語が出てくる話まで読んだ読者に開きます）。',
  '  各項目の「作者メモ」欄だけは公開されません。',
  '- 世界観設定（get_world / set_world_note）… 作品の決め事・設定ルール・執筆方針を置く',
  '  **作者だけの場所。公開されません。**',
  '- プロット（get_plot / upsert_plot_beat 等）… 幕とビート、プロットライン、伏線、秘密。公開されません。',
  '- 演出譜（get_staging / set_staging）… サウンドノベル書き出し用の話者・場面の切れ目・背景。',
  '  本文には一切触れない別レコードで、公開されません。',
  '',
  '守ってほしい手順：',
  '1. 用語集・プロット・本文のいずれかを書き換える前に、まず get_world でこの作品の決め事を読む。',
  '   世界観設定は作品ごとの前提であり、そこに書かれたルールに従って書く。',
  '2. 設定のルール・執筆の決め事・世界の仕組み・読者への開示方針は、',
  '   **用語集ではなく set_world_note へ書く**。用語集は読者に見える器なので、',
  '   そこへ書くとネタバレが公開されます。',
  '3. 特定の項目にだけ紐づく内緒の情報（この人物の正体など）は、',
  '   upsert_glossary_entry の author_note に書く（この欄は公開時に取り除かれます）。',
  '4. 読者にいつ何を明かすかの管理は upsert_secret（秘密）を使う。',
].join('\n')

/** 書き込み系の結果に添える案内（ブラウザで取り込むまでローカルには反映されない）。 */
const PULL_HINT = 'アプリの「AIの変更を取り込む」でこの変更をローカルに反映してください。'

const workIdProp = { work_id: { type: 'string', description: 'list_works が返す作品 id' } }

/**
 * set_world_note の slot 説明。枠の定義（WORLD_SLOTS）から組み立てる＝
 * 画面に出す案内と AI に渡す選択肢が食い違わない。
 */
const WORLD_SLOT_DESCRIPTION = [
  '枠：',
  [
    ...WORLD_SLOTS.map((slot) => `${slot.key}（${slot.label}）`),
    `${WORLD_CUSTOM_SLOT}（自由枠・title 必須）`,
  ].join(' / '),
].join('')

/** 公開ツール定義。inputSchema はクライアントの引数検証に使われる。 */
export const MCP_TOOLS = [
  {
    name: 'list_works',
    description:
      '作品の一覧（id・タイトル・著者・話数）を返す。他ツールに渡す work_id / episode_id を得るため最初に呼ぶ。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_work',
    description:
      '1 作品の本文全体をプレーンテキスト（タイトル・各話見出し付き）で返す。書き換える前に get_world でこの作品の決め事（語り手・言葉づかい・やらないこと等）を確認すること。',
    inputSchema: {
      type: 'object',
      properties: workIdProp,
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_glossary',
    description:
      '1 作品の用語集（人物・場所・組織・用語・アイテム・生物の事典）を各項目の [entry_id: …] 付きで返す。この entry_id を upsert_glossary_entry の id / delete_glossary_entry の entry_id に渡す。用語集は公開サイトで読者にも見える器なので、書き換える前に get_world で作品の決め事を確認すること。',
    inputSchema: {
      type: 'object',
      properties: workIdProp,
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_structures',
    description:
      '1 作品の構造データ（アウトライン・相関図・マインドマップ）をプレーンテキストで返す。書き換える前に get_world で作品の決め事を確認すること。',
    inputSchema: {
      type: 'object',
      properties: workIdProp,
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_work_meta',
    description:
      '作品のメタ情報（タイトル・著者名・あらすじ）を更新する。渡した項目だけ書き換える。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        title: { type: 'string', description: '作品タイトル' },
        author: { type: 'string', description: '作者名（空文字で未設定）' },
        description: { type: 'string', description: 'あらすじ（空文字で未設定）' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_episode',
    description:
      '既存の話のタイトル・本文を更新する。body はプレーンテキスト（改行で段落・行頭「＊」でシーン区切り・｜漢字《かんじ》でルビ）。渡した項目だけ書き換える。**書く前に get_world で作品の決め事（語り手と文体・言葉づかい・開示方針・やらないこと）を読み、それに従うこと。**',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        episode_id: { type: 'string', description: 'list_works の各話 id' },
        title: { type: 'string', description: '話のタイトル' },
        body: { type: 'string', description: '本文（プレーンテキスト）' },
      },
      required: ['work_id', 'episode_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_episode',
    description:
      '作品に新しい話を末尾に追加する。作成した episode_id を返す。**書く前に get_world で作品の決め事を読み、それに従うこと。**',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        title: { type: 'string', description: '話のタイトル' },
        body: { type: 'string', description: '本文（プレーンテキスト・任意）' },
      },
      required: ['work_id', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_work',
    description:
      '新しい作品（空の作品）を作成する。作成した work_id を返す。話は add_episode で追加する。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '作品タイトル（必須）' },
        author: { type: 'string', description: '著者名（任意）' },
        description: { type: 'string', description: 'あらすじ（任意）' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_outline',
    description:
      '1 つの話の構成メモ（アウトライン）を丸ごと書き換える。notes は 1 行 1 メモのプレーンテキストで、行頭のインデント（タブ 1 個または半角スペース 2 個で 1 段・最大 3 段）が階層になる。行頭の「- 」は無視される。空文字でその話のメモを全消去。現状は get_structures で確認できる。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        episode_id: { type: 'string', description: 'list_works の各話 id' },
        notes: {
          type: 'string',
          description: '構成メモ（1 行 1 メモ・行頭インデントで階層）',
        },
      },
      required: ['work_id', 'episode_id', 'notes'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_glossary_entry',
    description:
      '用語集の項目（人物・場所・組織・用語・アイテム・生物）を追加または更新する。id を渡すと更新、無ければ新規作成。既存を更新するときは先に get_glossary で [entry_id: …] を確認して id に渡す。更新は**渡した項目だけ書き換える**（省略した項目は据え置き・空文字を渡すとその項目を削除）。name を変えると改名になり、旧名は自動で別名に残る＝本文の [[旧名]] は解決され続ける。name／別名が他項目と重複する書き込みはエラーになる。【重要】name/summary は公開サイトで読者にも見える。設定ルール・執筆の決め事・世界の仕組みはここではなく set_world_note へ書く。項目に紐づく非公開の情報は author_note へ書く。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: {
          type: 'string',
          description: '更新する既存エントリの id（get_glossary の [entry_id: …]。新規なら省略）',
        },
        name: { type: 'string', description: '名称（必須）' },
        aliases: { type: 'array', items: { type: 'string' }, description: '別名' },
        category: { type: 'string', description: '分類（キャラ/用語/場所 等）' },
        reading: { type: 'string', description: 'よみ' },
        summary: {
          type: 'string',
          description:
            '公開情報（読者にも見える説明文。一行要約〜詳しい本文までここに 1 本で書く。空文字で削除）',
        },
        body: {
          type: 'string',
          description:
            '【非推奨・旧フィールド】渡すと summary の末尾に結合される。summary を使うこと',
        },
        author_note: {
          type: 'string',
          description:
            '作者メモ。この項目に紐づく非公開の情報（正体・後の展開など）。公開時に取り除かれる（空文字で削除）',
        },
      },
      required: ['work_id', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_glossary_entry',
    description: '用語集の項目を削除する。先に get_glossary で対象の [entry_id: …] を確認する。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        entry_id: {
          type: 'string',
          description: '用語集の項目の id（get_glossary の [entry_id: …]）',
        },
      },
      required: ['work_id', 'entry_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_structure',
    description:
      '構造データ（アウトライン/相関図/マインドマップ）を JSON で追加・更新する。get_structures で現状を把握し、Structure の JSON（id・workId・kind・nodes・edges）を渡す。id 一致で置換。',
    inputSchema: {
      type: 'object',
      properties: {
        structure_json: { type: 'string', description: 'Structure 1 件の JSON 文字列' },
      },
      required: ['structure_json'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_plot',
    description:
      '1 作品のプロット（幕×ビート・プロットライン・伏線・秘密）を各要素の id 付きプレーンテキストで返す。先頭にこの作品の世界観設定（作者だけの決め事）が付くので、書き換えの前にそれに従うこと。upsert/delete 系プロットツールの対象 id はここで確認する。伏線は回収状態（未回収/回収済/根なし）、秘密は開示状態（開示予定/開示未定/明かさない）付き。',
    inputSchema: {
      type: 'object',
      properties: workIdProp,
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_plot_meta',
    description:
      'プロットのメタ（タイトル・ログライン・テーマ）を更新する。渡した項目だけ書き換える（空文字で未設定に戻す）。プロットが無い作品では新規作成を兼ねる（幕は upsert_plot_section で作る）。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        title: { type: 'string', description: 'プロットのタイトル（例：本編プロット）' },
        premise: { type: 'string', description: 'ログライン（一行で言うと何の話か）' },
        theme: { type: 'string', description: 'テーマ' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_plot_section',
    description:
      '幕（プロットの大きな区切り）を追加または更新する。id を渡すと更新、無ければ新規作成して section_id を返す。index（0 始まり）で並び位置を指定できる。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: { type: 'string', description: '更新する幕の id（get_plot の [section_id: …]）' },
        title: { type: 'string', description: '幕のタイトル（例：第一幕）。新規では必須' },
        note: { type: 'string', description: '幕のメモ（空文字で削除）' },
        index: { type: 'number', description: '並び位置（0 始まり）' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_plot_beat',
    description:
      'ビート（出来事カード）を追加または更新する。id を渡すと更新（渡した項目だけ書き換え・空文字で未設定に戻す）、無ければ新規作成して beat_id を返す。新規は title 必須、section_id は幕が 1 つだけなら省略可。section_id / index を渡すと移動・並べ替えになる。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: { type: 'string', description: '更新するビートの id（get_plot の [beat_id: …]）' },
        section_id: { type: 'string', description: '所属させる幕の id' },
        index: { type: 'number', description: '幕内の位置（0 始まり）' },
        title: { type: 'string', description: 'ビートのタイトル（新規では必須）' },
        summary: {
          type: 'string',
          description:
            '何が起きるか（数行の要約）。本文と同じ記法が使える：[[用語]] で用語集とつながり、｜漢字《かんじ》でルビ、《《強調》》で傍点',
        },
        note: {
          type: 'string',
          description: '狙い・代案などの自由メモ（要約と同じ記法が使える）',
        },
        time_label: { type: 'string', description: '作中時間の自由記述（例：三日後の夜）' },
        pov: { type: 'string', description: '視点キャラ（get_glossary の entry_id）' },
        cast: {
          type: 'array',
          items: { type: 'string' },
          description: '登場キャラ（entry_id の配列・丸ごと置換）',
        },
        place: {
          type: 'array',
          items: { type: 'string' },
          description: '舞台（entry_id の配列・丸ごと置換）',
        },
        line_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '属するプロットライン（get_plot の [line_id: …] の配列・丸ごと置換）',
        },
        episode_id: { type: 'string', description: '対応する本文の話 id（list_works の各話 id）' },
        status: {
          type: 'string',
          description: '進行状態：idea（検討中）/ fixed（確定）/ writing（執筆中）/ done（済）',
        },
        target_length: { type: 'number', description: '予定文字数（0 で未設定に戻す）' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_plot_beat',
    description:
      'ビートを削除する。伏線が参照していた場合、その伏線は get_plot で [根なし] 警告として残る。先に get_plot で [beat_id: …] を確認する。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        beat_id: { type: 'string', description: 'ビートの id（get_plot の [beat_id: …]）' },
      },
      required: ['work_id', 'beat_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_plot_line',
    description:
      'プロットライン（メイン・サブプロット・キャラアークなどの筋）を追加または更新する。id を渡すと更新、無ければ新規作成して line_id を返す。ビートへの割り当ては upsert_plot_beat の line_ids で行う。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: { type: 'string', description: '更新するラインの id（get_plot の [line_id: …]）' },
        title: { type: 'string', description: 'ラインの名前（例：ユキの正体）。新規では必須' },
        note: { type: 'string', description: 'ラインのメモ（空文字で削除）' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_foreshadow',
    description:
      '伏線を追加または更新する。plant_beat_id＝張るビート、payoff_beat_id＝回収するビート（空文字で解除）。回収漏れは get_plot の伏線一覧に [未回収]/[根なし] として出る。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: { type: 'string', description: '更新する伏線の id（get_plot の [foreshadow_id: …]）' },
        title: { type: 'string', description: '伏線の名前（新規では必須）' },
        note: { type: 'string', description: 'メモ（空文字で削除）' },
        plant_beat_id: { type: 'string', description: '張るビートの id（空文字で解除）' },
        payoff_beat_id: { type: 'string', description: '回収するビートの id（空文字で解除）' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_secret',
    description:
      '秘密（読者に伏せている情報）を追加または更新する。伏線が「布石を張って回収したか」なのに対し、秘密は「読者がいつ真相を知るか」を管理する。truth＝真相（作者用メモ・本文には出ない）、reveal_beat_id＝読者に明かすビート（空文字で解除）。明かし忘れは get_plot に [開示未定] として出る。最後まで明かさないと決めた秘密は keep_hidden: true で点検対象から外す。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: { type: 'string', description: '更新する秘密の id（get_plot の [secret_id: …]）' },
        title: {
          type: 'string',
          description: '伏せている事柄の呼び名（例：ユキの正体。新規では必須）',
        },
        truth: { type: 'string', description: '真相（読者に伏せている中身・空文字で削除）' },
        reveal_beat_id: {
          type: 'string',
          description: '読者に明かすビートの id（空文字で解除）',
        },
        keep_hidden: {
          type: 'boolean',
          description: '最後まで明かさない（true で点検対象から外す）',
        },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_plot_item',
    description:
      '幕・プロットライン・伏線・秘密を削除する。kind に section / line / foreshadow / secret、item_id にその id を渡す。幕の削除では中のビートが隣の幕へ移動する（最後の 1 幕は削除不可）。ビートの削除は delete_plot_beat を使う。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        kind: {
          type: 'string',
          description: '削除する種別：section / line / foreshadow / secret',
        },
        item_id: { type: 'string', description: '対象の id（get_plot で確認）' },
      },
      required: ['work_id', 'kind', 'item_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_staging',
    description:
      '1 つの話の演出譜（サウンドノベル書き出し用の話者・場面の切れ目・背景）を、本文の行ごとの [block_id: …] 付きで返す。話者が未設定のセリフには候補、空行 2 つ以上のあとの行には場面の切れ目の提案が〔提案: …〕として付く（提案は保存されていない）。set_staging の対象 block_id と使える背景キーはここで確認する。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        episode_id: { type: 'string', description: 'list_works の各話 id' },
      },
      required: ['work_id', 'episode_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_staging',
    description:
      '1 つの話の演出（話者・場面の切れ目・背景・切り替え方）を行単位でまとめて付ける。本文は一切変わらない。cues の各要素は get_staging の [block_id: …] を指し、渡した項目だけ書き換える（省略＝据え置き・空文字＝削除・clear: true でその行の演出を丸ごと外す）。話者はセリフの行にだけ付けられ、用語集の人物名／？？？（名前を伏せる）／自由な名前が使える。どれか 1 行でもエラーになると全体が保存されない。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        episode_id: { type: 'string', description: 'list_works の各話 id' },
        cues: {
          type: 'array',
          description: '行ごとの演出パッチ（1 件以上）',
          items: {
            type: 'object',
            properties: {
              block_id: { type: 'string', description: '対象の行（get_staging の [block_id: …]）' },
              speaker: {
                type: 'string',
                description: '話者名（セリフの行のみ。？？？で名前を伏せる。空文字で外す）',
              },
              scene_break: {
                type: 'boolean',
                description: 'ここから場面が変わる（背景の切り替え点。false で外す）',
              },
              bg: {
                type: 'string',
                description: '背景キー（get_staging の「使える背景キー」から。空文字で外す）',
              },
              transition: {
                type: 'string',
                description:
                  '背景の切り替え方: fade（ゆっくり）/ cut（ぱっと）/ flash（白いフラッシュ）。bg と同じ行に付ける（空文字で外す）',
              },
              clear: {
                type: 'boolean',
                description:
                  'true でこの行の演出を丸ごと外す（他の項目と併用不可。行き先を失った演出の掃除にも使う）',
              },
            },
            required: ['block_id'],
            additionalProperties: false,
          },
        },
      },
      required: ['work_id', 'episode_id', 'cues'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_world',
    description:
      '1 作品の世界観設定（作者だけの決め事・設定ルール・執筆方針）を [slot: …, note_id: …] 付きで返す。**用語集・プロット・本文を書き換える前に必ず最初に読むこと。**ここは公開されないので、まだ読者に伏せている情報も書かれている。',
    inputSchema: {
      type: 'object',
      properties: workIdProp,
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_world_note',
    description:
      '世界観設定の枠を書き込む（作者だけの場所・公開されない）。設定のルール・世界の仕組み・読者への開示方針・執筆の決め事はすべてここへ書く（用語集へ書かない）。定型枠は slot 一致で 1 枠に上書きされ、slot: custom は自分で見出しを付ける自由枠。body を空文字にするとその枠を削除する。プロットがまだ無い作品でも書ける。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        slot: { type: 'string', description: WORLD_SLOT_DESCRIPTION },
        id: {
          type: 'string',
          description: '更新する自由枠の note_id（get_world の [note_id: …]）。定型枠では不要',
        },
        title: { type: 'string', description: '自由枠（slot: custom）の見出し。定型枠では不要' },
        body: { type: 'string', description: '本文（空文字でその枠を削除）' },
      },
      required: ['work_id', 'slot', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_world_note',
    description: '世界観設定の枠を削除する。先に get_world で対象の [note_id: …] を確認する。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        note_id: {
          type: 'string',
          description: '世界観設定の note_id（get_world の [note_id: …]）',
        },
      },
      required: ['work_id', 'note_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_backup',
    description:
      '現在の全状態をクラウドに手動バックアップ（版を作る）。有料（cloud 会員）機能。作成した backup_id を返す。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_backups',
    description: 'クラウドバックアップの一覧（id・作成日時、新しい順）を返す。有料機能。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'restore_backup',
    description:
      '指定バックアップの内容をライブスナップショットに戻す（有料機能）。反映にはアプリで「AIの変更を取り込む」が必要。',
    inputSchema: {
      type: 'object',
      properties: { backup_id: { type: 'string', description: 'list_backups が返す id' } },
      required: ['backup_id'],
      additionalProperties: false,
    },
  },
] as const

/** 注入 I/O：ライブスナップショットの読み書きとクラウドバックアップ操作。 */
export interface McpDeps {
  /** ライブスナップショット（会員の最新全状態）。未保存なら null。 */
  loadSnapshot(): Promise<CloudBackup | null>
  /** ライブスナップショットを上書き保存。 */
  saveSnapshot(backup: CloudBackup): Promise<boolean>
  /** 現在のライブを版付きバックアップとして保存。 */
  createBackup(): Promise<{ id: string; createdAt: number } | null>
  listBackups(): Promise<Array<{ id: string; createdAt: number }>>
  /** 指定バックアップの内容をライブに戻す。 */
  restoreBackup(id: string): Promise<boolean>
  now(): number
  genId(): string
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string }
}

const ok = (id: JsonRpcMessage['id'], result: unknown) => ({ jsonrpc: '2.0', id, result })
const err = (id: JsonRpcMessage['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
})
const text = (body: string, isError = false) => ({
  content: [{ type: 'text', text: body }],
  ...(isError ? { isError: true } : {}),
})

const str = (args: Record<string, unknown> | undefined, key: string): string | undefined =>
  typeof args?.[key] === 'string' ? (args[key] as string) : undefined

const strArray = (args: Record<string, unknown> | undefined, key: string): string[] | undefined =>
  Array.isArray(args?.[key])
    ? (args[key] as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined

const num = (args: Record<string, unknown> | undefined, key: string): number | undefined =>
  typeof args?.[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined

const bool = (args: Record<string, unknown> | undefined, key: string): boolean | undefined =>
  typeof args?.[key] === 'boolean' ? (args[key] as boolean) : undefined

function listWorksText(works: CloudBackup['works']): string {
  if (works.length === 0) return '作品はまだありません。'
  const lines = works.map((w) => {
    const author = w.author ? `（著者: ${w.author}）` : ''
    const eps = w.episodes.map((e) => `    - ${e.title} [episode_id: ${e.id}]`).join('\n')
    return `- ${w.title}${author} — ${w.episodes.length}話 [work_id: ${w.id}]${eps ? `\n${eps}` : ''}`
  })
  return `作品が ${works.length} 件あります。\n${lines.join('\n')}`
}

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

/** tools/call の 1 ツールを実行する。ツール側のエラー（未検出等）は isError 結果で返す。 */
async function callTool(
  name: string | undefined,
  args: Record<string, unknown> | undefined,
  deps: McpDeps,
): Promise<ReturnType<typeof text>> {
  // --- バックアップ操作（スナップショット読み込み不要） ---
  if (name === 'create_backup') {
    const res = await deps.createBackup()
    return res
      ? text(`バックアップを作成しました。backup_id: ${res.id}（${fmtDate(res.createdAt)}）`)
      : text('バックアップに失敗しました。まだ保存されたデータが無い可能性があります。', true)
  }
  if (name === 'list_backups') {
    const backups = await deps.listBackups()
    if (backups.length === 0) return text('クラウドバックアップはまだありません。')
    const lines = backups.map((b) => `- ${fmtDate(b.createdAt)} [backup_id: ${b.id}]`)
    return text(`バックアップが ${backups.length} 件あります。\n${lines.join('\n')}`)
  }
  if (name === 'restore_backup') {
    const backupId = str(args, 'backup_id') ?? ''
    const done = await deps.restoreBackup(backupId)
    return done
      ? text(`backup_id "${backupId}" をライブに復元しました。${PULL_HINT}`)
      : text(`backup_id "${backupId}" の復元に失敗しました（見つからない等）。`, true)
  }

  // --- スナップショットに基づく読み書き ---
  const snap = await deps.loadSnapshot()
  const works = snap?.works ?? []

  if (name === 'list_works') return text(listWorksText(works))

  // 書き込みツールはスナップショット必須。
  const writeTools = new Set([
    'set_work_meta',
    'set_episode',
    'add_episode',
    'create_work',
    'set_outline',
    'upsert_glossary_entry',
    'delete_glossary_entry',
    'set_structure',
    'set_plot_meta',
    'upsert_plot_section',
    'upsert_plot_beat',
    'delete_plot_beat',
    'upsert_plot_line',
    'upsert_foreshadow',
    'upsert_secret',
    'delete_plot_item',
    'set_world_note',
    'delete_world_note',
    'set_staging',
  ])
  if (writeTools.has(name ?? '')) {
    if (!snap) {
      return text('ライブスナップショットがありません。先にアプリを開いて保存してください。', true)
    }
    try {
      const now = deps.now()
      let next: CloudBackup = snap
      let message = ''
      const workId = str(args, 'work_id') ?? ''

      if (name === 'set_work_meta') {
        next = {
          ...snap,
          works: setWorkMeta(
            works,
            workId,
            {
              title: str(args, 'title'),
              author: str(args, 'author'),
              description: str(args, 'description'),
            },
            now,
          ),
        }
        message = '作品メタを更新しました。'
      } else if (name === 'set_episode') {
        next = {
          ...snap,
          works: setEpisode(
            works,
            workId,
            str(args, 'episode_id') ?? '',
            { title: str(args, 'title'), body: str(args, 'body') },
            now,
          ),
        }
        message = '話を更新しました。'
      } else if (name === 'add_episode') {
        const episodeId = deps.genId()
        next = {
          ...snap,
          works: addEpisode(
            works,
            workId,
            { title: str(args, 'title') ?? '', body: str(args, 'body') },
            episodeId,
            now,
          ),
        }
        message = `話を追加しました。episode_id: ${episodeId}`
      } else if (name === 'create_work') {
        const newWorkId = deps.genId()
        next = {
          ...snap,
          works: createWork(
            works,
            {
              title: str(args, 'title') ?? '',
              author: str(args, 'author'),
              description: str(args, 'description'),
            },
            newWorkId,
            now,
          ),
        }
        message = `作品を作成しました。work_id: ${newWorkId}`
      } else if (name === 'set_outline') {
        next = {
          ...snap,
          structures: setOutlineNotes(
            snap.structures ?? [],
            works,
            workId,
            str(args, 'episode_id') ?? '',
            str(args, 'notes') ?? '',
            deps.genId,
            now,
          ),
        }
        message = '構成メモを書き換えました。'
      } else if (name === 'upsert_glossary_entry') {
        next = {
          ...snap,
          works: upsertGlossaryEntry(
            works,
            workId,
            {
              id: str(args, 'id'),
              name: str(args, 'name') ?? '',
              aliases: strArray(args, 'aliases'),
              category: str(args, 'category'),
              reading: str(args, 'reading'),
              summary: str(args, 'summary'),
              body: str(args, 'body'),
              authorNote: str(args, 'author_note'),
            },
            deps.genId(),
            now,
          ),
        }
        message = '用語集の項目を保存しました。'
      } else if (name === 'delete_glossary_entry') {
        next = {
          ...snap,
          works: deleteGlossaryEntry(works, workId, str(args, 'entry_id') ?? '', now),
        }
        message = '用語集の項目を削除しました。'
      } else if (name === 'set_structure') {
        const structure = parseStructure(str(args, 'structure_json') ?? '')
        next = { ...snap, structures: upsertStructure(snap.structures, structure) }
        message = '構造データを保存しました。'
      } else if (name === 'set_plot_meta') {
        next = {
          ...snap,
          plots: setPlotMeta(
            snap.plots ?? [],
            works,
            workId,
            {
              title: str(args, 'title'),
              premise: str(args, 'premise'),
              theme: str(args, 'theme'),
            },
            now,
          ),
        }
        message = 'プロットのメタを保存しました。'
      } else if (name === 'upsert_plot_section') {
        const res = upsertPlotSection(
          snap.plots ?? [],
          workId,
          {
            id: str(args, 'id'),
            title: str(args, 'title'),
            note: str(args, 'note'),
            index: num(args, 'index'),
          },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message = `幕を保存しました。section_id: ${res.sectionId}`
      } else if (name === 'upsert_plot_beat') {
        const res = upsertPlotBeat(
          snap.plots ?? [],
          workId,
          {
            id: str(args, 'id'),
            sectionId: str(args, 'section_id'),
            index: num(args, 'index'),
            title: str(args, 'title'),
            summary: str(args, 'summary'),
            note: str(args, 'note'),
            timeLabel: str(args, 'time_label'),
            povRef: str(args, 'pov'),
            castRefs: strArray(args, 'cast'),
            placeRefs: strArray(args, 'place'),
            lineRefs: strArray(args, 'line_ids'),
            episodeRef: str(args, 'episode_id'),
            status: str(args, 'status'),
            targetLength: num(args, 'target_length'),
          },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message = `ビートを保存しました。beat_id: ${res.beatId}`
      } else if (name === 'delete_plot_beat') {
        next = {
          ...snap,
          plots: deletePlotBeat(snap.plots ?? [], workId, str(args, 'beat_id') ?? '', now),
        }
        message = 'ビートを削除しました。'
      } else if (name === 'upsert_plot_line') {
        const res = upsertPlotLine(
          snap.plots ?? [],
          workId,
          { id: str(args, 'id'), title: str(args, 'title'), note: str(args, 'note') },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message = `プロットラインを保存しました。line_id: ${res.lineId}`
      } else if (name === 'upsert_foreshadow') {
        const res = upsertPlotForeshadow(
          snap.plots ?? [],
          workId,
          {
            id: str(args, 'id'),
            title: str(args, 'title'),
            note: str(args, 'note'),
            plantBeatId: str(args, 'plant_beat_id'),
            payoffBeatId: str(args, 'payoff_beat_id'),
          },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message = `伏線を保存しました。foreshadow_id: ${res.foreshadowId}`
      } else if (name === 'upsert_secret') {
        const res = upsertPlotSecret(
          snap.plots ?? [],
          workId,
          {
            id: str(args, 'id'),
            title: str(args, 'title'),
            truth: str(args, 'truth'),
            revealBeatId: str(args, 'reveal_beat_id'),
            keepHidden: bool(args, 'keep_hidden'),
          },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message = `秘密を保存しました。secret_id: ${res.secretId}`
      } else if (name === 'set_world_note') {
        const res = setPlotWorldNote(
          snap.plots ?? [],
          works,
          workId,
          {
            id: str(args, 'id'),
            slot: str(args, 'slot') ?? '',
            title: str(args, 'title'),
            body: str(args, 'body') ?? '',
          },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message =
          res.noteId === null
            ? '世界観設定の枠を削除しました。'
            : `世界観設定を保存しました。note_id: ${res.noteId}`
      } else if (name === 'delete_world_note') {
        next = {
          ...snap,
          plots: deletePlotWorldNote(snap.plots ?? [], workId, str(args, 'note_id') ?? '', now),
        }
        message = '世界観設定の枠を削除しました。'
      } else if (name === 'delete_plot_item') {
        const kind = str(args, 'kind') ?? ''
        if (kind !== 'section' && kind !== 'line' && kind !== 'foreshadow' && kind !== 'secret') {
          throw new McpEditError('kind は section / line / foreshadow / secret のいずれかです')
        }
        next = {
          ...snap,
          plots: deletePlotItem(snap.plots ?? [], workId, kind, str(args, 'item_id') ?? '', now),
        }
        message = '削除しました。'
      } else if (name === 'set_staging') {
        const res = setStagingCues(
          snap.stagings ?? [],
          works,
          workId,
          str(args, 'episode_id') ?? '',
          parseStagingCueInputs(args?.cues),
          (snap.gameAssets ?? []).map((a) => userAssetKey(a.id)),
          now,
        )
        next = { ...snap, stagings: res.stagings }
        message = `演出を保存しました（更新 ${res.applied} 行・外した演出 ${res.cleared} 件）。`
      }

      const saved = await deps.saveSnapshot(next)
      if (!saved) return text('保存に失敗しました。', true)
      return text(`${message} ${PULL_HINT}`)
    } catch (e) {
      if (e instanceof McpEditError) return text(e.message, true)
      throw e
    }
  }

  // 読み取り（work 指定）
  const workId = str(args, 'work_id') ?? ''
  const work = works.find((w) => w.id === workId)
  if (
    name === 'get_work' ||
    name === 'get_glossary' ||
    name === 'get_structures' ||
    name === 'get_plot' ||
    name === 'get_world' ||
    name === 'get_staging'
  ) {
    if (!work) return text(`work_id "${workId}" の作品が見つかりません。`, true)
    if (name === 'get_staging') {
      const episodeId = str(args, 'episode_id') ?? ''
      const episode = work.episodes.find((e) => e.id === episodeId)
      if (!episode) return text(`episode_id "${episodeId}" の話が見つかりません。`, true)
      const staging = (snap?.stagings ?? []).find(
        (s) => s.workId === workId && s.episodeId === episodeId,
      )
      return text(stagingToPlainText(work, episode, staging, snap?.gameAssets ?? []))
    }
    // 本文・構造も「書き換える前に決め事を読む」の対象。1 行の導線を先頭に置く
    // （本体を載せると本文が長いので、取りに行かせる形にする）。
    const primaryPlot = () =>
      pickPrimaryPlot((snap?.plots ?? []).filter((p) => p.workId === workId))
    if (name === 'get_work') {
      return text(`${worldPointerLine(primaryPlot())}\n\n${workToPlainText(work)}`)
    }
    if (name === 'get_world') {
      return text(
        worldToPlainText(primaryPlot()) ||
          'この作品にはまだ世界観設定がありません。set_world_note で書けます（作者だけの場所で、公開はされません）。',
      )
    }
    if (name === 'get_glossary') {
      // 用語集は公開される器。器の住み分けを見失わないよう、世界観設定への導線を先頭に置く。
      const body =
        // 各エントリに entry_id を添える＝ upsert（更新）/ delete の対象を AI が指定できる。
        glossaryToPlainText(work.glossary ?? [], { withIds: true }) ||
        '（この作品の用語集は空です）'
      return text(`${worldPointerLine(primaryPlot())}\n\n${body}`)
    }
    if (name === 'get_plot') return text(plotToPlainText(snap?.plots ?? [], work))
    return text(
      `${worldPointerLine(primaryPlot())}\n\n${structuresToPlainText(snap?.structures ?? [], work)}`,
    )
  }
  return text(`未知のツール: ${name}`, true)
}

/**
 * JSON-RPC メッセージ 1 件を処理する。通知（id 無し）には応答しないので null を返す。
 * 対応: initialize / notifications/initialized / ping / tools/list / tools/call。
 */
export async function handleMcpMessage(msg: JsonRpcMessage, deps: McpDeps): Promise<object | null> {
  const { id, method, params } = msg
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      })
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null // 通知には応答しない
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: MCP_TOOLS })
    case 'tools/call':
      return ok(id, await callTool(params?.name, params?.arguments, deps))
    default:
      if (isNotification) return null
      return err(id, -32601, `Method not found: ${method}`)
  }
}

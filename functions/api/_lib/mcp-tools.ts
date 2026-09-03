import { WORLD_CUSTOM_SLOT, WORLD_SLOTS } from '../../../src/core/plot'

/**
 * リモート MCP の公開ツール定義。`inputSchema` はクライアントの引数検証に使われる。
 *
 * 読み取りは「索引（軽い）→ 中身（重い）」の二段構え。作品が育つとホスト側の応答サイズ上限に
 * 当たって**中身を一度も見られない**（Genspark で実測：世界観設定 140,000 バイト・用語集
 * 210,000 バイトが破棄された）ため、`list_*` で id を得てから `get_*` に絞り込み引数を渡す道を
 * 用意してある。既存ツールの引数はすべて任意で、**渡さなければ従来どおりの全量**を返す。
 */

const workIdProp = { work_id: { type: 'string', description: 'list_works が返す作品 id' } }

/**
 * 応答サイズの上限。**渡さなければ既定**（本文 300,000 バイト／設定系の全量 120,000 バイト／
 * 索引 60,000 バイト）。0 を渡すと無制限＝この改修より前とまったく同じ全量が返る
 * （利用者の逃げ道なので必ず残す）。
 */
const maxBytesProp = {
  max_bytes: {
    type: 'integer',
    description:
      '応答の上限バイト数。省略時は既定（本文 300,000／用語集・世界観・プロット等 120,000／索引 60,000）。超えると索引に切り替わる。0 を渡すと無制限（従来どおりの全量）。',
  },
}

/** 索引ツール共通のページング引数。 */
const pagingProps = {
  limit: { type: 'integer', description: '返す件数（既定 200・最大 1000）' },
  offset: { type: 'integer', description: '何件目から返すか（0 起点。既定 0）' },
}

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
      '作品の一覧（id・タイトル・著者・話数・各話の episode_id）を返す。他ツールに渡す work_id / episode_id を得るため最初に呼ぶ。作品や話が多くて上限を超える場合は各話の行を落とした一覧になる（話の一覧は get_work_map で取れる）。',
    inputSchema: { type: 'object', properties: { ...maxBytesProp }, additionalProperties: false },
  },
  {
    name: 'get_work_map',
    description:
      '1 作品の全体像（話数・用語集・世界観設定・プロット・構造データの件数と概算サイズ、次に呼ぶツールの実例）を 8,000 バイト以内で返す。**応答が大きすぎて読めなかったときは、まずこれを呼ぶ。**本文・設定の中身は含まない。',
    inputSchema: {
      type: 'object',
      properties: workIdProp,
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_work',
    description:
      '1 作品の本文全体をプレーンテキスト（タイトル・各話見出し付き）で返す。episode_id を渡すとその 1 話だけ返す（話の id は list_works が返す）。書き換える前に get_world でこの作品の決め事（語り手・言葉づかい・やらないこと等）を確認すること。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        episode_id: { type: 'string', description: 'この話だけ返す（省略時は全話）' },
        ...maxBytesProp,
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_glossary_entries',
    description:
      '用語集の索引（名前・entry_id・分類・よみ・別名・字数）を返す。**公開情報と作者メモの本文は含まない**ので軽い。ここで得た entry_id を get_glossary(work_id, entry_id) に渡すと、その項目の全文が読める。query（名前・別名・よみの部分一致）と category で絞り込める。項目数が多い作品はまずこれを呼ぶ。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        query: { type: 'string', description: '名前・別名・よみの部分一致で絞り込む' },
        category: { type: 'string', description: '分類で絞り込む（例: 人物）' },
        ...pagingProps,
        ...maxBytesProp,
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_glossary',
    description:
      '1 作品の用語集（人物・場所・組織・用語・アイテム・生物の事典）を各項目の [entry_id: …] 付きで返す。entry_id / entry_ids を渡すとその項目だけ、query・category を渡すと絞り込んだぶんだけ返す（省略時は全項目）。**limit か offset を渡すと、1 回の応答は既定 200 件までの窓になる。**窓のときは応答の先頭に total と next_offset が出るので、続きは offset をずらして読む。全項目を一度に読むなら limit も offset も渡さないこと。この entry_id を upsert_glossary_entry の id / delete_glossary_entry の entry_id に渡す。全項目が上限を超える作品では list_glossary_entries で索引を見てから id 指定で読むこと。用語集は公開サイトで読者にも見える器なので、書き換える前に get_world で作品の決め事を確認すること。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        entry_id: { type: 'string', description: 'この項目だけ返す' },
        entry_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '複数の項目をまとめて返す（1 往復で済む）',
        },
        query: { type: 'string', description: '名前・別名・よみの部分一致で絞り込む' },
        category: { type: 'string', description: '分類で絞り込む（例: 人物）' },
        ...pagingProps,
        ...maxBytesProp,
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_structures',
    description:
      '1 作品の構造データ（アウトライン・相関図・マインドマップ）をプレーンテキストで返す。kind を渡すとその種別だけ返す。書き換える前に get_world で作品の決め事を確認すること。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        kind: {
          type: 'string',
          enum: ['outline', 'chart', 'mindmap'],
          description: 'この種別だけ返す（省略時は全種別）',
        },
        ...maxBytesProp,
      },
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
      '1 作品のプロット（幕×ビート・プロットライン・伏線・秘密）を各要素の id 付きプレーンテキストで返す。先頭にこの作品の世界観設定（作者だけの決め事）が付くので、書き換えの前にそれに従うこと。section_id / beat_ids を渡すとその幕・そのビートだけ返す（省略時は全量）。**絞り込むと世界観設定は索引（見出し・slot・note_id・字数）に切り替わる**（全文は get_world で読む。絞り込んだうえで全文も要るときは include_world: true）。upsert/delete 系プロットツールの対象 id はここで確認する。ビートが多い作品では list_plot_beats で索引を見てから絞り込むこと。伏線は回収状態（未回収/回収済/根なし）、秘密は開示状態（開示予定/開示未定/明かさない）付き。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        section_id: { type: 'string', description: 'この幕だけ返す' },
        beat_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'これらのビートだけ返す（1 往復で複数件）',
        },
        include_world: {
          type: 'boolean',
          description:
            '先頭に世界観設定をどう載せるか。既定は「絞り込みなしなら全文・section_id / beat_ids で絞ったら索引」。true で絞り込み中も全文、false で索引も外す（件数の 1 行だけ残る）',
        },
        ...maxBytesProp,
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_plot_beats',
    description:
      'プロットの索引（幕の見出しと section_id、各ビートの beat_id・状態・タイトル・字数、伏線と秘密の件数、世界観設定の枠一覧）を返す。**要約・メモ・世界観の本文は含まない**ので軽い。ここで得た section_id / beat_id を get_plot(work_id, section_id) や get_plot(work_id, beat_ids) に渡すと中身が読める。ビートが多い作品はまずこれを呼ぶ。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        section_id: { type: 'string', description: 'この幕だけの索引にする' },
        ...maxBytesProp,
      },
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
    name: 'get_world',
    description:
      '1 作品の世界観設定（作者だけの決め事・設定ルール・執筆方針）を [slot: …, note_id: …] 付きで返す。**用語集・プロット・本文を書き換える前に必ず最初に読むこと。**note_id / slots を渡すとその枠だけ返す（省略時は全枠）。項目が多い作品では list_world_notes で枠の一覧を見てから slots で絞ること。ここは公開されないので、まだ読者に伏せている情報も書かれている。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        note_id: { type: 'string', description: 'この枠だけ返す' },
        slots: {
          type: 'array',
          items: { type: 'string' },
          description: `これらの枠だけ返す。${WORLD_SLOT_DESCRIPTION}`,
        },
        ...maxBytesProp,
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_world_notes',
    description:
      '世界観設定の索引（枠の見出し・slot・note_id・字数・冒頭 60 字と、まだ書かれていない枠）を返す。**本文は含まない**ので軽い。ここで得た note_id / slot を get_world(work_id, slots) に渡すと中身が読める。項目が多い作品はまずこれを呼ぶ。',
    inputSchema: {
      type: 'object',
      properties: { ...workIdProp, ...pagingProps, ...maxBytesProp },
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

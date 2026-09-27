# 敵対的レビューの記録 — COT-6

## Round 1 — verdict: FAIL（major 5・minor 8）

| ID | 重大度 | 指摘（要約） | 対応 |
|---|---|---|---|
| A-1 | major | 字下げしたト書きの冒頭に「」が出ると話者付きセリフに化ける（`　看板に「立入禁止」とある。`） | **対応**：判別順に「行頭が空白の行＝ト書き（固定）」を追加。脚本の慣習（ト書き＝字下げ・セリフ＝行頭）に合わせる。受け入れ条件に例を追加 |
| A-2 | major | `ユイ（声）「…」` `ケン（回想）「…」` がト書き扱いになるのに要件にも対象外にも無い | **対応**：名前の直後に `（…）` を 1 つ許す。`SPEAKER_RE` と受け入れ条件を更新。話者 span は括弧まで含む |
| A-3 | major | grove が v7 未対応のとき 409 の案内文が音声素材向けのまま | **対応**：`publish.ts:376-385` を変更範囲に追加。`format` があり `supported < 7` のとき脚本向けの案内を返す分岐とテストを追加 |
| A-4 | major | `workFolderZipExport` にト書き正規化を通すとロスレス往復が壊れる。`src/core/folder/index.ts` が表に無い | **対応**：フォルダ書き出しを FR-5 から外す。manifest は author・表紙も載せない既存設計（正本往復は bundle）に倣い `format` も載せない。要件に明記 |
| A-5 | major | 「小説の出力は 1 バイトも変わらない」を固定する既存スナップショットが無い | **対応**：テスト計画を「opts 無し／`{script:false}` の文字列一致」＋「脚本の例文を小説形式で通して `sc-` を含まない」に書き換え |
| A-6 | minor | `WorkMetaDialog` の呼び出しは 2 箇所（`App.tsx:852` `library.tsx:610`）。publish-route は部分パッチ | **対応**：表を修正 |
| A-7 | minor | `NotationBar` は `EditorPane` 内部で描かれ、items を渡すには prop が要る | **対応**：`EditorPaneProps.scriptMode?: boolean` を追記 |
| A-8 | minor | `screens/preview-desktop.png` が存在しない | **対応**：`write-desktop.png`（右ペインがプレビュー）に参照を直す |
| A-9 | minor | 「脚本」バッジの色が design（緑）と prototype（wheat）で食い違う | **対応**：wheat（`bg-secondary-container text-on-secondary-container`）に統一し design に明記。「N話」（緑）と区別がつく |
| A-10 | minor | 「話者は前行を継ぐ」は実装に無い振る舞い | **対応**：「名前を省いた行は話者なしのセリフ」に言い換え（要件・ヘルプ・プロトタイプ） |
| A-11 | minor | `list_works` の出力は `listWorksText`（`mcp-server.ts:722-730`）で範囲に無い | **対応**：範囲に追記 |
| A-12 | minor | ダイアログ説明文が EPUB 限定のままで「形式」欄の説明として不正確 | **対応**：「作品の情報を編集します。EPUB やコトノハ-grove- に反映されます。」に変更 |
| A-13 | minor | `＊` 行の記述修正は要求外 | **対応**：「要求外の小修正・併せて直す」と明記（実装時に触る同じ行なので分けない） |

## Round 2 — verdict: FAIL（major 2・minor 5）／A-1〜A-13 はすべて解消と判定

| ID | 重大度 | 指摘（要約） | 対応 |
|---|---|---|---|
| B-1 | major | design.md のⓘ本文が A-1 反映前の文言で、prototype と食い違う | **対応**：design.md のⓘ本文を prototype と同じ文に差し替え |
| B-2 | major | 字下げなしのト書き（`ベンチに座る。`）を書き出しでどう扱うか未定 | **対応**：FR-5 を「ト書き行は行頭空白を取り除いてから全角空白 3 つを付ける（字下げの有無によらず）」に明確化し、受け入れ条件とテスト計画に例を追加 |
| B-3 | minor | `[[ユイ]]（声）「…」` やルビ名で `sc-speaker` の範囲が classify の speaker とずれる | **対応**：`splitSpeaker` を「純テキスト上の match 長で inline 列の先頭から切る。切れ目が ruby/ref の内部に落ちるときはその inline 全体を話者側に含める」と定義し直し、受け入れ条件に落とす |
| B-4 | minor | FR-2 の表見出し「行頭の空白を除いた純テキスト」が字下げ判定と矛盾 | **対応**：見出しを改める |
| B-5 | minor | `project-row.tsx` の Badge は :52-57 | **対応**：修正 |
| B-6 | minor | `BundleWork` は `Omit<Work,…>` なので `format` が自動で入る | **対応**：`Omit` に `'format'` を足し `format?: 'script'` と明記 |
| B-7 | minor | 空白だけの行を script でどう描くか未定 | **対応**：「`p.blank` は inlines 空のときだけ。空白だけの行は classify が blank を返しクラスを付けず現状どおり」と明記 |

## Round 3 — verdict: **PASS**（blocker 0・major 0・minor 3）／B-1〜B-7 はすべて解消と判定

| ID | 重大度 | 指摘（要約） | 対応 |
|---|---|---|---|
| C-1 | minor | ⓘ本文の語尾が design と prototype で 1 語ずれ | **対応**：design を「そのままです。」に揃えた |
| C-2 | minor | `splitSpeaker` の ref の数え方が `plainTextOfInline`（children 優先）とずれ得る | **対応**：「各 inline は `plainTextOfInline` の長さで数える」に改めた |
| C-3 | minor | `blocksToPlainText` の script オプションは利用者向け出口が無く死にオプション | **対応**：FR-5 の対象を EPUB・なろう・カクヨムに絞り、`blocksToPlainText` は変えないと明記 |

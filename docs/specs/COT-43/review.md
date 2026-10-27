# レビュー記録 — COT-43

## Round 1（FAIL：major 6・minor 10）

| ID | 重大度 | 指摘 | 対応 |
|---|---|---|---|
| A-1 | major | `listWorks` は自動保存のたびに呼ばれ（`editorStore.ts:550`→`refreshList`）、全作品の流し込みが毎回走る。サイドバーも描画ごとに数える | 対応：`src/core/manuscript/sheet-cache.ts`（id＋`updatedAt` で前の値を使う）を設計に足し、`WorkRepository` が持つ。サイドバーは `useMemo([work])`、ステータスバーは下書きの parse を1回にまとめる。要件 FR-2 に「保存1回で数え直すのは保存した作品だけ」とテストを足した |
| A-2 | major | B5 で字数 44〜50 は1字の送りが 8pt 未満になり `charSpace` が負 | 対応：用紙ごとの上限（A4 字数 50・B5 字数 43、行数は 50）を式から出し `maxGridOf` に。範囲の案内を用紙に合わせ、全組み合わせで `charSpace ≥ 0` をテストに |
| A-3 | major | 要件は「モバイルでも枚数を出す」、設計は「sm 未満で省く」 | 対応：sm 未満では「◯段落 ・」を省き、枚数は出すに揃えた（要件・設計・プロトタイプ） |
| A-4 | major | 手本の脚本ダイアログのスクショが無い | 対応：`screens/export-script-desktop.png` を撮り、プロトタイプに手本として並べた |
| A-5 | major | 「本文が空」の判定が未定 | 対応：`countWorkChars(work) === 0` を空とする。空の話だけの作品の受け入れ条件を足した |
| A-6 | major | App のサイドバー・ステータスバー、`print-html.ts`、エラー文言のテストが無い。小説だけの条件が設計に無い | 対応：App の統合テスト・`print-html.test.ts`・エラー文言のテストを足し、App.tsx の行に「小説の作品だけ」と書いた |
| A-7 | minor | MCP の `synopsis` の説明と `toPlainText` の扱い | 対応：`mcp-server.ts` の説明文の更新を変更ファイルに足した。`toPlainText` は「変えない」と明記 |
| A-8 | minor | e2e のヘルパが export されていない | 対応：`e2e/helpers.ts` に移す計画を足した |
| A-9 | minor | iOS で iframe の印刷が親ページを印刷する恐れ | 対応：実装の最初に実機で確かめ、だめなら iOS では Word へ案内する受け入れ条件とリスクを足した |
| A-10 | minor | 表紙・あらすじの流用で `normalizeScriptText` がかかる。kind のコメントに `blank` が無い | 対応：整え方を引数で差し替えられる形で export し、小説は「何もしない」を渡す。kind のコメントを直した |
| A-11 | minor | Normal の sz と句詰めの設定が書かれていない | 対応：`sz = fontPt×2`、`characterSpacingControl = doNotCompress` を明記しテストに |
| A-12 | minor | プロトタイプの枚数が場所ごとに違う | 対応：見本の枚数を計算値（59枚／400字詰め 189枚）に揃え、字数÷400（152）より多い理由を添えた |
| A-13 | minor | 「一度だけ案内」の範囲があいまい | 対応：「PDF を選んでいる間、案内を出す」に直した |
| A-14 | minor | 行番号のずれ | 対応：`canExport` 205-210、縦横の切り替え 334 に直した。`toDocx.ts:152` は `pgMar` を含む行で正しいので据え置き |
| A-15 | minor | モバイルの変更後モックが書き出し以外に無い。作品情報のモバイルが未撮影 | 対応：ライブラリのカードとステータスバーのスマホ幅のモックを足し、作品情報のモバイルを撮った |
| A-16 | minor | `[[参照]]` に重ねたルビの扱い | 対応：参照の children も ruby の設定に従うと要件・設計に書き、テストを足した |

## Round 2（FAIL：major 2・minor 4）

| ID | 重大度 | 指摘 | 対応 |
|---|---|---|---|
| A-5 | major | 換算の枚数で、中身が空の話が2つ以上あると題名の行だけで1枚になる | 対応：`countNovelSheets` `countNovelBlocksSheets` は字数 0 なら 0 を返すと設計に書き、FR-1・FR-2 の受け入れ条件とテストを足した |
| B-1 | major | ルビの `w:hps` が 10.5 のような小数になる | 対応：`baseHps = fontPt×2`、`rubyHps = Math.round(fontPt)` の整数にし、4つの属性が整数のテストを足した |
| B-2 | minor | ESM の export を spy で数えられない | 対応：`createSheetCountCache(count = countNovelSheets)` で数える関数を差し替えられる形に |
| B-3 | minor | 393px で1行に収まることを確かめる手段が無い | 対応：`e2e/mobile.spec.ts` にステータスバーの高さのテストを足した |
| B-4 | minor | `ns-onboarded` の初期化がヘルパに入っていない・行番号の抜け | 対応：`skipOnboarding` として移す。行番号を 15・23・27 に |
| B-5 | minor | 行番号のずれ | 対応：`toDocx.ts:227`・`:243`（値は `:62`）・`export-dialog.tsx:778`・`:412-456` に直した |

## Round 3（PASS：minor 1）

| ID | 重大度 | 指摘 | 対応 |
|---|---|---|---|
| B-3 | minor | バーの高さは固定（`max-lg:h-7`）なので、28px を測っても折り返しを見つけられない | 対応：字数を出す span の高さが1行の行送り以下であることを見る形に直した |

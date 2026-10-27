# 小説の原稿用紙換算と、公募の書式での書き出し 仕様書（COT-43）

- 要件: COT-66 ／ 設計: COT-67 ／ プロトタイプ: https://claude.ai/artifact/QUz2s3CNFjszo6L7SM7Y9n
- 状態: レビュー通過（Round 3）

## 何を作るか

小説の本文を原稿用紙に流し込む関数を1つ作り、そこから3つを出す。400字詰めの枚数（ライブラリ・サイドバー・ステータスバー）、公募の書式の Word、同じ組版の印刷用ページ（PDF に保存）。スキーマは変えない。

## 振る舞い

- **FR-1 流し込み**：段落ごとに、打ってあるとおりに組む（字下げを足さない・空行を畳まない・半角も1マス）。禁則は脚本の `wrapLine` と同じ3つ（追い出し・送り・句読点のぶら下げ）。ルビは親文字だけ、`[[参照]]` は表示名。話の末尾の空行は数えない。字数 0 の作品・話は 0 枚
- **FR-2 枚数の表示（小説だけ）**：カード「◯字 ・ N枚」、行「◯字 ・ N枚 ・ ◯前に編集」、サイドバー「◯話 ・ ◯字 ・ N枚」、ステータスバー「◯段落 ・ ◯文字 ・ N枚 ・ 今日 +◯字」。`sm` 未満では「◯段落 ・」を省く。数え直すのは本文が変わったときだけ（一覧は `updatedAt` が変わった作品だけ）
- **FR-3 応募原稿（Word）**：書き出しダイアログに「応募原稿」（小説だけ）。書式は 20×20・40×30・40×34・42×34 か指定（A4 は字数 10〜50、B5 は字数 10〜43、行数はどちらも 10〜50）。用紙 A4／B5、横置き・縦書き・ページ番号は本文の1頁目から。文字の大きさは書式と用紙から自動（8〜14pt）。字数 0 の作品は押せず「本文がありません」
- **FR-4 表紙とあらすじ**：表紙（題名・著者名）とあらすじ（`Work.synopsis`）をオン／オフ。小説の作品情報にも「梗概」の欄を出す。枚数は本文だけ
- **FR-5 PDF（印刷）**：同じ流し込みの頁を、ページ内の iframe で印刷する。枚数と PDF の頁数（前付けを除く）は一致する。PDF を選んでいる間は印刷の設定を案内する。iOS は実装の最初に実機で確かめ、だめなら Word へ案内する
- **FR-6 ルビ**：振る（Word は `w:ruby`、印刷は `<ruby>`）／親文字だけ。参照に重ねたルビも同じ。枚数は変わらない
- **FR-7 話の題名と改ページ**：題名を見出しに（既定オン・1話だけの作品では出さない）、話ごとに改ページ（既定オフ）
- **FR-8 設定を覚える**：localStorage `ns-manuscript-prefs`。読めない値は既定へ

## 画面

- 書き出しダイアログ：EPUB の次に「応募原稿」。設定欄は書式・用紙（文字の大きさ）・出力・ルビ・付けるもの・枚数（「本文 N枚（40字×34行）・400字詰め換算 M枚」）。見た目は脚本の「脚本（提出用）」に揃える（`screens/export-script-desktop.png`）
- ライブラリのカード・行、サイドバー、ステータスバー：字数の後ろに「・N枚」
- 作品情報（小説）：「形式」の下に「梗概」の欄

## 実装の骨格

| パス | 責務 |
|---|---|
| `src/core/manuscript/index.ts` | `layoutNovelBlocks` `composeNovelManuscript` `countNovelSheets` `countNovelBlocksSheets` `maxGridOf` |
| `src/core/manuscript/sheet-cache.ts` | `createSheetCountCache(count)`（id＋`updatedAt` で前の値を使う） |
| `src/core/script/layout.ts` | `paginate` の総称化、`titlePageLines` `synopsisPageLines` を整え方を差し替えられる形で export |
| `src/core/exporter/docxPackage.ts` | `toDocx.ts` の共通パーツ（脚本の .docx の出力は変えない） |
| `src/core/exporter/toManuscriptDocx.ts` | グリッドの計算・段落・ルビ・節 |
| `src/core/exporter/toManuscriptHtml.ts` | 印刷用 HTML |
| `src/ui/_utils/print-html.ts` | iframe で印刷 |
| `src/ui/components/ExportDialog/manuscript-panel.tsx` | 設定欄 |
| `src/ui/hooks/use-manuscript-prefs.ts` | 設定を覚える |

グリッド（縦書き）：`linePitch = floor((pageW − 1985 − 1701) / rows)`、`charPitchPt = (pageH − 3402) / cols / 20`、`fontPt = clamp(半ポイント刻みで切り下げ(min(charPitchPt, linePitch/20×0.75)), 8, 14)`、`charSpace = floor((charPitchPt − fontPt) × 4096)`。20×20 A4 は脚本 A4 の値と一致する。`Normal` の `w:sz = fontPt×2`、ルビは `hps = round(fontPt)`（すべて整数）、`characterSpacingControl = doNotCompress`。

データモデル：Zod スキーマの変更なし。`WorkSummary.sheetCount?` は画面用の派生値で、保存しない。

## テスト

- unit：流し込みの受け入れ条件・字数 0 で 0 枚・総当たりの `charSpace ≥ 0`・hps が整数・脚本の .docx が切り出し前後で同じ・キャッシュの数え直し回数・印刷用 HTML の頁数とエスケープ
- integration：書き出しダイアログ（範囲外・空・エラー文言・設定を覚える）、App（小説だけ・下書きで更新・`sm` 未満）、作品情報の梗概、`print-html`
- e2e：応募原稿の Word の中身、スマホ幅で字数の span が折り返さない
- 手動：Word・LibreOffice で開く、Chrome・Safari・iOS で PDF に保存

## 守ること

- スキーマを変えない。梗概は既存の `Work.synopsis`
- 脚本の書き出し（`toDocx.ts` の出力・前付け・正規化）を変えない
- MCP の `synopsis` は説明文だけ直す（入力の型は変えない）

## やらないこと

- 横書き、応募者情報（本名・住所）、.txt の応募原稿、判型 PDF（COT-55）、PDF をファイルとして直接作る

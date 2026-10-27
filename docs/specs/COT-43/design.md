# 設計 — COT-43 小説の原稿用紙換算と、公募の書式での書き出し（Word・PDF）

プロトタイプ: https://claude.ai/artifact/QUz2s3CNFjszo6L7SM7Y9n

## 方針

- 小説の流し込みを `src/core/manuscript/` に新設し、折り返し・禁則は脚本の `wrapLine`、頁割りは `paginate` をそのまま使う。小説は「打ってあるとおり」に組む（字下げを足さない・空行を畳まない・！？の後ろを空けない）ので、脚本の `layoutScriptBlocks` は使わない。
- 400字詰め換算（20字×20行）と、選んだ書式での枚数・PDF の頁は、すべて同じ流し込みの関数から出す。数字がずれる場所を1つにする。
- Word は脚本の `toDocx.ts` と同じ作り（依存なし・必要な XML パートだけ・自前の zip）。共通のパッケージ部品を `docxPackage.ts` に切り出し、脚本の .docx は中身を変えない。行グリッドは字数×行数と用紙から計算する（脚本 A4 の固定値を同じ式で再現できることをテストで固める）。
- PDF は依存を足さず、組んだ頁を1マス1文字で並べた印刷用 HTML を作り、ページ内の見えない iframe で印刷ダイアログを開く。
- 捨てた案：
  - PDF ライブラリ（pdf-lib・jsPDF）を足す：和文フォントの埋め込み（数 MB〜十数 MB）が要り、Pages の配信と PWA のプリキャッシュ方針（和文フォントは入れない）に合わない。COT-55 で判型 PDF を作るときに改めて決める。
  - 脚本の `layoutScriptBlocks` を小説にも使う：柱・ト書きの判別と空行の畳み込みが小説の作法と合わない。
  - 枚数をスキーマに保存する：派生値で、保存すると本文と食い違う。毎回数える。

## 変更ファイル

| 種別 | パス | 責務 / 変更内容 | 要件ID |
|---|---|---|---|
| 新規 | `src/core/manuscript/index.ts` | 書式の型と既定（`ManuscriptGrid` `MANUSCRIPT_GRID_PRESETS` `KOUBO_COUNT_GRID`＝20×20 `isValidGrid`）、小説の流し込み（`layoutNovelBlocks`）、話をまたぐ組み（`composeNovelManuscript`）、枚数（`countNovelSheets` `countNovelBlocksSheets`） | FR-1, FR-4, FR-6, FR-7 |
| 新規 | `src/core/manuscript/index.test.ts` | FR-1・FR-4・FR-7 の受け入れ条件 | FR-1, FR-4, FR-7 |
| 変更 | `src/core/script/layout.ts` | `paginate` と `SheetPage` を行の型で総称化する（`<L extends SheetLine>`）。振る舞いは変えない。小説の行は `kind: 'text'` で空行も `text` にする（`paginate` の頁頭の空行の読み飛ばし `layout.ts:204,212` は `kind === 'blank'` だけを見るので、小説の空行は詰まらない） | FR-1 |
| 新規 | `src/core/exporter/docxPackage.ts` | `toDocx.ts` から共通部品を移す：`[Content_Types].xml`・`_rels/.rels`・`document.xml.rels`・`fontTable.xml`・`docProps/core.xml`・`docProps/app.xml`・フッター（`buildFooterXml`）・`escapeXml`。`buildDocxPackage({ documentXml, stylesXml, settingsXml, title, author, now })` が `ZipInput[]` を返す | FR-3 |
| 変更 | `src/core/exporter/toDocx.ts` | 上の共通部品を `docxPackage.ts` から使う。`escapeXml` `buildFooterXml` は再 export して既存の import を壊さない。出力のバイト列は変えない | FR-3 |
| 新規 | `src/core/exporter/toManuscriptDocx.ts` | 応募原稿の .docx：`manuscriptPageSetup(grid, paper)`（用紙・余白・`linePitch`・`charSpace`・文字の大きさ）、`novelBlocksToDocxParagraphs(blocks, { ruby })`（段落・ルビ `w:ruby`・傍点 `w:em`）、`buildManuscriptDocxFiles(source, opts)` | FR-3, FR-4, FR-6, FR-7 |
| 新規 | `src/core/exporter/toManuscriptDocx.test.ts` | グリッドの計算（20×20 A4 が脚本の値と一致・40×34 A4・B5）、段落とルビの XML、前付けとページ番号の節 | FR-3, FR-4, FR-6 |
| 新規 | `src/core/exporter/toManuscriptHtml.ts` | 印刷用 HTML：`buildManuscriptPrintHtml(pages, { grid, paper, ruby })`。`@page { size: A4 landscape }`・縦書き・1マス1文字の頁・下中央のノンブル・ルビ | FR-5, FR-6 |
| 新規 | `src/core/exporter/toManuscriptHtml.test.ts` | 頁要素の数＝`pages.length`、行数・字数の上限、エスケープ、ルビ | FR-5 |
| 変更 | `src/core/exporter/toHtml.ts` | `escapeHtml` を export する（印刷用 HTML で使う。中身は変えない） | FR-5 |
| 変更 | `src/core/storage/workRepository.ts` | `WorkSummary` に `sheetCount?: number`（小説だけ）を足す（`listWorks` `workRepository.ts:64-80`）。数えるのは `sheetCountCache`（下記）経由。型だけの派生値で保存しない | FR-2 |
| 新規 | `src/core/manuscript/sheet-cache.ts` | `createSheetCountCache(count = countNovelSheets)`（数える関数を引数で差し替えられる。テストでは数え役の関数を渡して回数を数える）：作品 id → `{ updatedAt, count }` の Map。`updatedAt` が同じなら前の値を返し、違えば数え直す（`updatedAt` が無い旧作品は id と話数・字数の組で比べる）。消えた作品の行は `prune(ids)` で落とす。`WorkRepository` が1つ持つ | FR-2 |
| 変更 | `src/core/schema/index.ts` | `synopsis` のコメントを「脚本の提出用と、小説の応募原稿が使う」に直す（`schema/index.ts:238-239`）。スキーマは変えない | FR-4 |
| 変更 | `functions/api/_lib/mcp-server.ts` | `set_work_meta` の `synopsis` の説明（`mcp-server.ts:180-184`）を「梗概（結末まで書いた提出用のあらすじ。脚本の書き出しと、小説の応募原稿に載る。空文字で未設定）」に直す。入力の型は変えない（契約は狭めない） | FR-4 |
| 変えない | `src/core/exporter/toPlainText.ts` | AI に渡す平文に梗概を出すのは脚本だけ（`toPlainText.ts:54`）。今回は変えない（小説の梗概を AI に渡すかは別の判断） | — |
| 変更 | `src/ui/_utils/exporters.ts` | `workManuscriptDocxExport(work, prefs)`（ファイル名の規則つき）と `manuscriptSourceOf(work)`（題名・筆名・梗概・話。人物表は付けない） | FR-3, FR-4 |
| 新規 | `src/ui/_utils/print-html.ts` | `printHtml(html)`：見えない iframe に `srcdoc` で入れ、読み込み後に `contentWindow.print()`、`afterprint`（無ければ 60 秒）で iframe を外す。`isIosWebKit()`（iOS で iframe の印刷が効かないときの出し分け用。実機で確かめてから使うか決める） | FR-5 |
| 新規 | `src/ui/_utils/print-html.test.ts` | iframe を足して `srcdoc` を入れる・`print` を呼ぶ・`afterprint` で外す・`print` が無いと reject | FR-5 |
| 新規 | `e2e/helpers.ts` | `e2e/smoke.spec.ts:15,23,27` の `createWork` `openWriter` `addEpisode` と、初回の案内を出さない初期化（`smoke.spec.ts:6-12` の `ns-onboarded` を立てる `addInitScript`）を `skipOnboarding(page)` として移して export する（新しい spec は `beforeEach` でこれを呼ぶ）（smoke はそこから import する。先例 `e2e/work-search-helpers.ts`） | — |
| 新規 | `src/ui/hooks/use-manuscript-prefs.ts` | 書き出しの設定を localStorage `ns-manuscript-prefs` に覚える。読めない値は既定へ（Zod の `safeParse`） | FR-8 |
| 新規 | `src/ui/components/ExportDialog/manuscript-panel.tsx` | 「応募原稿」の設定欄（書式・用紙・出力・ルビ・表紙・あらすじ・話の題名・改ページ・枚数） | FR-3〜FR-8 |
| 変更 | `src/ui/components/ExportDialog/export-dialog.tsx` | `FORMATS` に `manuscript`（`only: 'novel'`・アイコン `FileText`）を足し、設定欄に `ManuscriptPanel` を出す。`canExport` と `handleExport` に分岐を足す（`export-dialog.tsx:95-136,205-210,303-322`） | FR-3, FR-5 |
| 変更 | `src/ui/components/Library/project-card.tsx` / `project-row.tsx` | 小説で `sheetCount` があれば「・N枚」を足す（`title` に説明） | FR-2 |
| 変更 | `src/ui/App.tsx` | **小説の作品だけ**（`isNovel` `App.tsx:328`）。サイドバーの `workMeta` に枚数を足す（`App.tsx:502-505`。いまは描画ごとにその場で数えているので、`useMemo(() => countNovelSheets(work), [work])` に出す）。ステータスバーにいまの話の枚数を足す（`App.tsx:995-1000`）。下書きの `parseEpisodeBody` は1回の `useMemo([state.draft])` にまとめ、`draftChars`（`App.tsx:279-282`）と枚数で共用する。`sm` 未満では「◯段落 ・」の span を `max-sm:hidden` にする | FR-2 |
| 変更 | `src/ui/components/WorkMetaDialog/work-meta-dialog.tsx` | 梗概の欄を小説でも出す（`work-meta-dialog.tsx:184`）。説明（`FieldHelp`）を形式で出し分ける | FR-4 |
| 変更 | `src/ui/components/HelpPage/help-page.tsx` | 「書き出す」の説明に応募原稿と枚数の一文を足す（`help-page.tsx:89-92`） | FR-2, FR-3 |
| 変更 | `docs/CODEMAP.md` | §1 に「小説の原稿用紙換算・応募原稿」の行、§2 の変換に `manuscript/`・`toManuscriptDocx.ts`・`toManuscriptHtml.ts`・`docxPackage.ts` | — |

## データモデル

- Zod スキーマの差分：なし。
- 新しい型（`src/core/manuscript/index.ts`。保存しない）

```ts
export interface ManuscriptGrid { cols: number; rows: number }          // 10〜50
export const KOUBO_COUNT_GRID: ManuscriptGrid = { cols: 20, rows: 20 }  // 400字詰め換算
export const MANUSCRIPT_GRID_PRESETS = [
  { cols: 20, rows: 20, label: '20字×20行（400字詰め）' },
  { cols: 40, rows: 30, label: '40字×30行' },
  { cols: 40, rows: 34, label: '40字×34行' },
  { cols: 42, rows: 34, label: '42字×34行' },
] as const

export interface RubySpan { from: number; to: number; reading: string } // 行内の文字位置（親文字）
export interface ManuscriptLine extends SheetLine { ruby?: RubySpan[] }  // kind は 'text' | 'heading' | 'title' | 'blank' | 'pageBreak'（本文の空行は 'text' の ''、表紙・あらすじの組みが出す空行は 'blank'）
export const maxGridOf = (paper: 'a4' | 'b5'): ManuscriptGrid  // A4 { cols: 50, rows: 50 }、B5 { cols: 43, rows: 50 }（1字の送り ≥ 8pt・行の送り ≥ 8pt/0.75 から出した値。式はロジック節）

export interface ManuscriptOptions {
  headings: boolean          // 話の題名を見出しにする（既定 true）
  breakPerEpisode: boolean   // 話ごとに改ページ（既定 false）
}
export interface ManuscriptSource {
  title: string; author?: string; synopsis?: string
  episodes: { title: string; blocks: Block[] }[]
}
export interface ManuscriptFront { cover: boolean; synopsis: boolean }
```

- 端末の設定（localStorage `ns-manuscript-prefs`・作品に入れない・同期しない）

```ts
{ grid: { cols, rows }, custom: boolean, paper: 'a4' | 'b5', output: 'docx' | 'print',
  ruby: 'keep' | 'base', cover: boolean, synopsis: boolean, headings: boolean, breakPerEpisode: boolean }
```

- `WorkSummary.sheetCount?: number`（`src/core/storage/workRepository.ts:19`）。TS の型だけで、IndexedDB・同期・バックアップ・publish・MCP には載らない。
- 旧レコード：`synopsis` が無い作品は梗概なし。`format` が無い作品は小説として扱う（既存の判定 `App.tsx:328` と同じ）。

## UI

### 画面: 書き出しダイアログ（執筆画面・ライブラリのメニューから。ルートなし）
- 現状: `screens/export-novel-desktop.png`・`screens/export-novel-mobile.png`（小説）、`screens/export-script-desktop.png`（脚本の「脚本（提出用）」の設定欄＝見た目を揃える手本）
- 変更点:
  - ① 左の形式一覧の「EPUB / 電子書籍」の次に「応募原稿」（既定で選ばれる形式は EPUB のまま＝`export-dialog.tsx:148`）（`FileText`）。説明「公募の書式（字数×行数・用紙）で、縦書きの Word か PDF に組んで」。小説の作品だけ
  - ② 設定の見出し「応募原稿 設定」と、短い説明（`Note`）：「縦書き・横置きの用紙に、本文を打ってあるとおりに組みます。字下げや空行は書いたままです。ページ番号は本文の1頁目から入ります。」
  - ③ 書式：チップ（脚本の出力チップと同じ見た目 `export-dialog.tsx:394-419`）で 20字×20行（400字詰め）／40字×30行／40字×34行／42字×34行／指定する。「指定する」のときだけ「字数」「行数」の数字欄を2つ並べる（範囲外は欄の下にエラー）
  - ④ 用紙：チップ A4／B5。右に「文字の大きさ 10.5pt」
  - ⑤ 出力：チップ Word（.docx）／PDF（印刷）。PDF を選んでいる間、下に印刷の案内（FR-5）
  - ⑥ ルビ：チップ 振る／親文字だけ
  - ⑦ 付けるもの（脚本の前付けの枠 `export-dialog.tsx:412-456` と同じ見た目）：表紙（題名・著者名）／あらすじ（梗概）／話の題名を見出しにする／話ごとに改ページする。各行の下に補足（著者名が無い・梗概が無い・話が1つだけ、など）
  - ⑧ 情報の枠（`MetaRow`）：タイトル・著者・枚数「本文 N枚（40字×34行）・400字詰め換算 M枚」。下に「Word で開くと、Word の組み直しで数枚ずれることがあります」
  - ⑨ フッターのボタン：Word なら既存の「書き出し」のまま、PDF なら「印刷して PDF に保存」（`export-dialog.tsx:778`）
- 状態:
  - 空（`countWorkChars(work) === 0`＝話が無い・話はあるが字数 0）：ボタンを押せず、⑧の下に「本文がありません」。`canExport` に `fmt === 'manuscript'` の分岐を足し、字数と書式の範囲（用紙ごとの上限 `maxGridOf(paper)`）の両方を見る
  - 読み込み中：なし（同期で組む。重い作品でもボタンを押した瞬間に組む）
  - エラー：Word の組み立てで例外 → ダイアログを開いたまま「書き出せませんでした。もう一度お試しください」（サウンドノベルの `gameError` と同じ出し方）。印刷の iframe が作れない → 「印刷の画面を開けませんでした。Word で書き出してください」
  - オフライン：影響なし
  - ゲスト・無料会員：全員使える
- モバイル: ダイアログは既存どおり形式一覧が上・設定が下（`export-dialog.tsx:334`）。字数・行数の欄は横に2つ並べたまま（幅 393px で収まる）。PDF（印刷）もモバイルで出す（iOS は FR-5 の実機確認しだい）
- 使う共通部品: `Dialog` 一式・`Switch`・`Label`・`Button`（`src/ui/components/ui/`）、ダイアログ内の `Section` `Note` `MetaRow`（`export-dialog.tsx:788-824`。`manuscript-panel.tsx` から使うため同ファイル内で export する）、チップは脚本の出力チップと同じクラス
- 文言: 上記（toc-copy の作法：です・ます、短く、専門語を避ける。「グリッド」「twip」は出さない）

### 画面: ライブラリ（`#/`）
- 現状: `screens/library-desktop.png`・`screens/library-mobile.png`
- 変更点: ⑩ カードの字数の後ろに「・N枚」、⑪ 行の「◯字」の後ろに「・N枚」。脚本の作品には出さない
- 状態: 本文が空の小説は「0字 ・ 0枚」
- モバイル: カードの表示は同じ（文字が増えるのは数文字）
- 文言: `title="400字詰め原稿用紙に換算した枚数です"`

### 画面: 執筆画面（作品を開いた画面）
- 現状: `screens/editor-novel-desktop.png`・`screens/editor-novel-mobile.png`
- 変更点: ⑫ サイドバーの作品情報「3話 ・ 12,345字 ・ 41枚」、⑬ ステータスバー「24段落 ・ 3,456文字 ・ 12枚 ・ 今日 +120字」
- モバイル: ステータスバーは高さ 28px（`max-lg:h-7`）の1行。`sm` 未満では「◯段落 ・」を省き、「◯文字 ・ ◯枚 ・ 今日 +◯字」を出す（`screens/editor-novel-mobile.png` の幅 393px で1行に収まる）
- 文言: 枚数の span に `title="いまの話を400字詰め原稿用紙に換算した枚数です"`

### 画面: 作品情報ダイアログ
- 現状: `screens/work-meta-novel-desktop.png`・`screens/work-meta-novel-mobile.png`
- 変更点: ⑭ 小説でも「梗概」の欄を出す。`FieldHelp` の説明は小説なら「応募原稿に付ける、結末まで書いたあらすじです。募集要項の指定に合わせ、400〜1200 字が目安です。上の『あらすじ』は読者向け（コトノハ-grove- や EPUB に出ます）で、梗概は応募原稿（Word・PDF）にだけ載ります。」、脚本はいまのまま

## ロジック・API

### 流し込み（`src/core/manuscript/index.ts`）

```ts
export function layoutNovelBlocks(blocks: Block[], grid: ManuscriptGrid): ManuscriptLine[]
// 1段落ごとに：
//  - 親文字の並びとルビの位置を作る（ruby inline → base を本文に、{from,to,reading} を控える）
//  - wrapLine(text, grid.cols, 0, 0) で折り返す（字下げは text の先頭の空白として含まれる）
//  - 折り返した各行に、その行にかかるルビを行内の位置へ写す（行をまたぐルビは、読みを親文字の字数の比で前後に分ける）
//  - 空の段落は { kind: 'text', text: '' }
// 末尾の空の段落は落とす

export function composeNovelManuscript(
  source: ManuscriptSource,
  front: ManuscriptFront,
  grid: ManuscriptGrid,
  opts: ManuscriptOptions,
): SheetPage<ManuscriptLine>[]
// 表紙（題名・筆名を中央に＝script/layout の titlePage と同じ組み方）→ あらすじ（見出し「あらすじ」・段落は1字下げで折り返し）→ 本文
// 本文：話ごとに、opts.headings かつ話が2つ以上なら題名を heading 行＋空行。opts.breakPerEpisode なら2話目以降の前に pageBreak
// paginate(lines, grid, frontLength) でノンブルは本文の1頁目から

export const countNovelBlocksSheets = (blocks: Block[], grid = KOUBO_COUNT_GRID): number
export const countNovelSheets = (work: Work, grid = KOUBO_COUNT_GRID): number
// どちらも、字数が 0（`countWorkChars(work) === 0`／ブロックの字数が 0）なら流し込まずに 0 を返す（中身が空の話が2つ以上あると、題名の行だけで1枚になるのを防ぐ）
// = composeNovelManuscript(本文だけ, {cover:false, synopsis:false}, grid, {headings:true, breakPerEpisode:false}).length
```

- 表紙の組み方（`titlePage`）とあらすじの組み方（`synopsisPage`）は `script/layout.ts:242-298` にあり非公開で、文字を `normalizeScriptText`（半角→全角・！？の後ろを空ける `layout.ts:244,252,289`）で整える。`layout.ts` から `titlePageLines(source, opts, normalize = normalizeScriptText)` `synopsisPageLines(synopsis, opts, normalize = normalizeScriptText)` として、整え方を差し替えられる形で export する。小説は `normalize` に「何もしない（前後の空白だけ落とす）」を渡す。脚本は既定のままで振る舞いを変えない。
- `[[参照]]` の `children`（`schema/index.ts:20-38`）は展開して、中の `ruby` は ruby の設定（振る／親文字だけ）に従う。字数・枚数は `plainTextOfInline`（`game/index.ts:195-206`）と同じく親文字で数える。

### Word（`src/core/exporter/toManuscriptDocx.ts`）

- 用紙と余白は脚本と同じ（A4 横 16838×11906・B5 横 14572×10319、余白 上下 1701・右 1985・左 1701 twip＝`toDocx.ts:152` の `pgMar`）。
- `Normal` スタイルの `w:sz` は `fontPt × 2`（half-point。脚本は `toDocx.ts:227` でプリセットの値）。グリッドの式はこの大きさを前提にする。`settings.xml` の `characterSpacingControl` は `doNotCompress`（句読点を詰めると字詰めがずれるため。脚本 A4 の `compressPunctuation`＝`toDocx.ts:62` のプリセットの値を `buildSettingsXml` `toDocx.ts:243` が書く とは変える）。
- 縦書きでは、1行の字数は「用紙の高さ − 上下の余白」に、行数は「用紙の幅 − 左右の余白」に並ぶ。

```
textH = pageH - 1701*2     // 字の並ぶ長さ（twip）
textW = pageW - 1985 - 1701 // 行の並ぶ長さ（twip）
linePitch = floor(textW / rows)                  // twip
charPitchPt = textH / cols / 20                  // pt
fontPt = clamp(roundDownToHalf(min(charPitchPt, linePitch / 20 * 0.75)), 8, 14)
charSpace = floor((charPitchPt - fontPt) * 4096) // 1/4096 pt
```

  - 20×20・A4 の検算：textH=8504→charPitch 21.26pt、textW=13152→linePitch 657、fontPt=14、charSpace=floor(7.26×4096)=29736。脚本 A4 の値（`toDocx.ts:55-57`）と一致する。
  - 40×34・A4：linePitch 386、charPitch 10.63pt、fontPt 10.5、charSpace 532。
  - 用紙ごとの上限：1字の送り `textH / cols / 20 ≥ 8`（pt）から、A4 は cols ≤ 53、B5 は cols ≤ 43。行の送り `textW / rows / 20 × 0.75 ≥ 8` から、A4 は rows ≤ 61、B5 は rows ≤ 51。画面の範囲はこれと 50 の小さいほう（`maxGridOf`）。範囲内では `fontPt ≤ charPitchPt` なので `charSpace ≥ 0`。
  - 脚本の B5 プリセット（12pt・`charSpace` 27822 `toDocx.ts:71-72`）は Word のテンプレートから写した値で、この式とは一致しない。脚本は固定値のまま触らず、応募原稿の B5 だけ式で出す。
- 段落：本文の段落1つを `<w:p>` 1つに。スタイルは `Normal` だけ（字下げは本文の空白のまま）。ルビ `keep` は `<w:r><w:ruby><w:rubyPr><w:rubyAlign w:val="distributeSpace"/><w:hps w:val="{rubyHps}"/><w:hpsRaise w:val="{baseHps}"/><w:hpsBaseText w:val="{baseHps}"/><w:lid w:val="ja-JP"/></w:rubyPr><w:rt>…</w:rt><w:rubyBase>…</w:rubyBase></w:ruby></w:r>`、`base` は親文字の run。傍点は `<w:em w:val="dot"/>`。`baseHps = fontPt × 2`（half-point・整数。10.5pt なら 21）、`rubyHps = Math.round(fontPt)`（親文字のおよそ半分の大きさを half-point で。10.5pt なら 11）。`w:sz` `w:hps` `w:hpsRaise` `w:hpsBaseText` はすべて整数にする（OOXML の ST_HpsMeasure）。
- 節：表紙（`vAlign center`）・あらすじ・本文の3つ。ページ番号は本文の節だけ（`pgNumType start=1`）。組み方は `toDocx.ts:199-221` と同じ。
- 話の題名は見出しの段落、話ごとの改ページは `<w:br w:type="page"/>`。

### 印刷用 HTML（`src/core/exporter/toManuscriptHtml.ts`）

- 1頁＝`<section class="page">`。中に行＝`<div class="line">`（縦書き `writing-mode: vertical-rl`）。各行は1マス1文字で、マスの大きさは `--cell`（用紙と字数から mm で計算）。ぶら下げの句読点は行の外にはみ出させる（`overflow: visible`）。
- `@page { size: A4 landscape; margin: 0 }`（B5 は `B5 landscape`）。頁ごとに `break-after: page`。ノンブルは頁の下中央に絶対配置。
- 書体 `font-family: "Yu Mincho","YuMincho","Hiragino Mincho ProN","Noto Serif JP",serif`。
- 表紙の頁（`kind: 'title'` の行だけの頁）は、行の位置ではなく CSS で頁の中央に寄せる。`paginate` は頁頭の空行を読み飛ばす（`layout.ts:204`）ので、`titlePage` が上に積む空行は頁に残らないため。
- ルビは `<ruby>親<rt>よみ</rt></ruby>`。`rt` はマスの外（行の右）に小さく出し、マスの送りに影響させない（`ruby-position: over` と `rt { position: absolute }` で親の幅を変えない）。
- 本文はすべて `escapeHtml` を通す。スクリプトは入れない。

### 印刷（`src/ui/_utils/print-html.ts`）

```ts
export function printHtml(html: string): Promise<void>
// document.body に display:none でない 0×0 の iframe を足し、srcdoc に html。
// load で contentWindow.focus(); contentWindow.print()。afterprint か 60 秒後に iframe を外す。
// iframe が作れない・print が無い → reject（ダイアログがエラー文言を出す）
```

### 書き出しの配線（`src/ui/_utils/exporters.ts`）

```ts
export function manuscriptSourceOf(work: Work): ManuscriptSource
export function workManuscriptDocxExport(work: Work, prefs: ManuscriptPrefs): ExportFile
// filename: `${safeName(work.title)}_応募原稿_${cols}x${rows}_${paper.toUpperCase()}.docx`
```

## テスト計画

| 層 | 何を固定するか | 置き場所 |
|---|---|---|
| unit | FR-1 の受け入れ条件（字下げ・折り返し・ぶら下げ・追い出し・空行・末尾の空行・401行→21枚・ルビの親文字・空の作品・入力を書き換えない） | `src/core/manuscript/index.test.ts` |
| unit | FR-4・FR-7（表紙・あらすじ・ノンブルが本文から・題名の見出し・1話なら題名なし・改ページで枚数が増える）、行をまたぐルビの分け方 | `src/core/manuscript/index.test.ts` |
| unit | 10 万字の作品の換算が 50ms 以内の目安（`performance.now()`。CI で不安定なら `it.skip` ではなく閾値を緩める） | `src/core/manuscript/index.test.ts` |
| unit | 脚本の `paginate` の振る舞いが変わらない（既存テストがそのまま通る）・`titlePageLines` `synopsisPageLines` の切り出し | `src/core/script/layout.test.ts`（既存）・`src/core/exporter/script.test.ts`（既存） |
| unit | 共通部品の切り出し前後で脚本の .docx の全パートが同じ文字列（切り出しの前に、現行出力を固定するテストを先に足す） | `src/core/exporter/toDocx.test.ts` |
| unit | グリッドの計算（20×20 A4 が脚本の値と一致・40×34 A4・42×34 B5・文字の大きさの下限上限）、`w:textDirection tbRl`・`w:docGrid linesAndChars`、ルビ keep/base、傍点、前付けとページ番号の節、ファイルが zip のパートとして揃う | `src/core/exporter/toManuscriptDocx.test.ts` |
| unit | 印刷用 HTML の頁数＝`pages.length`、各頁の行数・各行の字数、`@page` の用紙、エスケープ（`<script>` を含む本文）、ルビ | `src/core/exporter/toManuscriptHtml.test.ts` |
| unit | `listWorks` の要約に小説だけ `sheetCount` が付く。20 作品で1作品だけ `updatedAt` を変えて `listWorks` を2回呼ぶと、流し込みは2回目に1回だけ（`createSheetCountCache` に回数を数える関数を渡す）。`sheetCountCache` の `prune` | `src/core/storage/workRepository.test.ts`・`src/core/manuscript/sheet-cache.test.ts` |
| unit | `maxGridOf` と、範囲内の全組み合わせ（A4・B5 × 字数 10〜上限 × 行数 10〜50）で `fontPt` が 8〜14・`charSpace ≥ 0`。B5 の字数 44 は範囲外 | `src/core/exporter/toManuscriptDocx.test.ts` |
| unit | `[[参照]]` に重ねたルビが ruby の設定に従う（Word・印刷用 HTML・枚数） | `toManuscriptDocx.test.ts`・`toManuscriptHtml.test.ts`・`src/core/manuscript/index.test.ts` |
| unit | `Normal` の `w:sz` が `fontPt×2`、`characterSpacingControl` が `doNotCompress`。10.5pt の書式（40×34・A4）で `w:sz`・`w:hps`・`w:hpsRaise`・`w:hpsBaseText` がすべて整数 | `toManuscriptDocx.test.ts` |
| unit | 中身が空の話が2つある小説の `countNovelSheets` が 0、サイドバー・カードは「0字 ・ 0枚」 | `src/core/manuscript/index.test.ts` |
| unit | 表紙・あらすじを小説の整え方で組むと、半角や！？の後ろが打ったまま。脚本の既定は今までどおり（既存テスト） | `src/core/script/layout.test.ts` |
| integration | 書き出しダイアログ：小説に「応募原稿」があり脚本に無い・書式を選ぶと枚数が変わる・範囲外の数字（A4 の 9・B5 の 44）でボタンが押せず案内が出る・話が無い／空の話だけで押せない・Word で `triggerDownload` が呼ばれファイル名が規則どおり・PDF で `printHtml` が呼ばれる・Word の組み立てが例外で「書き出せませんでした。もう一度お試しください」・`printHtml` が reject で「印刷の画面を開けませんでした。Word で書き出してください」・設定を覚える | `src/ui/components/ExportDialog/export-dialog.test.tsx` |
| integration | App：小説の作品でサイドバーとステータスバーに「枚」が出る・脚本の作品では出ない・`draft` を変えるとステータスバーの枚数が保存を待たずに変わる・`sm` 未満で「段落」を省く | `src/ui/App.test.tsx`（既存に追加） |
| integration | カード・行の「N枚」（小説だけ）、作品情報の梗概が小説でも出て保存される | `src/ui/components/Library/project-card.test.tsx`・`library.test.tsx`・`WorkMetaDialog` の既存テスト |
| integration | `use-manuscript-prefs`：壊れた値・localStorage 不可で既定に戻る | `src/ui/hooks/use-manuscript-prefs.test.ts` |
| e2e | 小説を作り本文を入れ、書き出し→応募原稿→40字×34行→Word をダウンロードし、zip の `word/document.xml` に `tbRl` と本文がある。ステータスバーに「枚」が出る | `e2e/manuscript-export.spec.ts`（新規。ヘルパは `e2e/helpers.ts` から import） |
| e2e | スマホ幅（playwright の `mobile` プロジェクト）で、執筆画面のステータスバーに「枚」が出て、字数を出す span の高さ（`boundingBox().height`）が1行の行送り以下（＝折り返していない）。バー自体は `max-lg:h-7` で高さが固定（`App.tsx:990`）なので、バーの高さでは見ない | `e2e/mobile.spec.ts`（既存に追加） |
| 手動 | Word（Microsoft 365）と LibreOffice で .docx を開き、ページ設定の字数・行数・縦書き・ページ番号・ルビ・傍点を確かめる。Chrome・Safari で PDF に保存し、頁数と字の並びを確かめる | リリース前の確認表 |

## リスク・未決事項

- Word の頁数は Word 自身が組み直すので、コトノハの枚数と数枚ずれることがある（禁則の扱いと、ぶら下げの差）。画面で伝える。一致させるのは PDF のほう。
- Word の傍点の種類：`w:em` の `dot` が縦書きでゴマ点に見えるかを Word で確かめ、違えば `comma` に替える（実装時に1回確認）。
- iOS Safari ではページ内の iframe の印刷が、iframe ではなく親のページを印刷することがある（WebKit で知られた挙動・未確認）。実装の最初に実機で確かめ、だめなら FR-5 の受け入れ条件どおり iOS では Word へ案内する。
- 印刷用 HTML の見た目は端末の明朝とブラウザの組版に左右される（字形・ルビの位置）。マスの送りは固定するので、頁数と行の切れ目は変わらない。
- 一覧は自動保存のたびに作り直される（`editorStore.ts:550` → `refreshList` → `listWorks` `editorStore.ts:269`）。`sheetCountCache` で変わった作品だけ数え直すので、保存1回の流し込みは保存した作品の1回だけ。初回の一覧は全作品を数える（10 万字で 50ms の目安。超えるなら初回だけ遅延して数える形へ切り替える）。
- 未決（要件と同じ）：表紙に枚数を載せるか、梗概の上限、PDF を将来ファイルとして直接作るか。

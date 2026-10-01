# 脚本モード 仕様書（COT-6）

- 要件: COT-8 ／ 設計: COT-14 ／ プロトタイプ: https://claude.ai/artifact/VwhcDYmaEEiJ5KZsobEnCc
- 状態: レビュー通過（Round 3）。詳細は `requirements.md` `design.md`、経緯は `review.md`
- 決定事項: 記法＝行頭の書き方で判別／モード単位＝作品ごと／初回範囲＝エディタ・プレビュー・書き出し・grove 公開。演出譜との連携は対象外

## 何を作るか
作品に「形式：小説／脚本」を持たせる。脚本の作品では、本文の各行を行頭の書き方だけで柱・ト書き・セリフとして扱い、プレビューは原稿用紙（既定 20字×20行・縦書き）、書き出しは体裁を整えた提出用テキスト（.txt）、grove は脚本の体裁にする。EPUB・なろう・カクヨムは小説専用（脚本では出さない）。
本文の正本は今までどおり純テキスト → `Block[]`（paragraph のみ）。Block に種類は持たせず、描画・書き出しの直前に判別する。

## 振る舞い

**FR-1 形式** — `Work.format?: 'novel' | 'script'`（optional）。未設定＝小説。「小説」に戻すとキーを消す（`'novel'` は保存しない）。同期・バックアップは Work を丸ごと運ぶので追加対応なし。

**FR-2 判別**（`src/core/script/` の純関数・脚本の作品にだけ適用）。1 行＝1 block を次の順で決める。
1. 空か空白だけ → `blank`。`***` だけの行（前後空白は無視）は `transition`（場面転換）
2. 行頭空白を除いた先頭が `○`／`〇` → `slug`（柱）
3. 行頭が空白（字下げ）→ `direction`（中に「」があってもト書き）
4. `「`／`『` で始まる → `dialogue`（話者なし。前行を継がない）
5. `名前` ＋任意で `（補足）` 1 つ＋任意の空白＋`「`／`『` → `dialogue`（話者＝名前＋補足）。名前 1〜20 文字・空白と括弧を含まない。補足 1〜10 文字
6. それ以外 → `direction`

純テキストは `plainTextOfBlock`（ルビは親文字・`[[名]]` は名前）。例：`○公園（夕方）`→柱／`　看板に「立入禁止」とある。`→ト書き／`ユイ（声）「…」`→セリフ・話者 `ユイ（声）`／`ユイ ケン「…」`・21 文字名・補足 2 つ→ト書き。

**FR-3 プレビュー（原稿用紙）** — 脚本の作品は HTML の流し込みではなく、`src/core/script/layout.ts` が組んだ頁（1マス1文字）を `ScriptSheet` で描く。文字の大きさは設定の読書サイズ（`--reading-font-size`）に従い、紙の寸法は持たない。縦書き＝20字×20行（映像業界の標準ペラ）、横書き＝40字×40行（募集要項で指定されることがある）。ツールバーの縦横切替が用紙の型の切替になる。上に「用紙の型・本編 n 枚」を出す。組版規則：
- ト書き＝3字下げ（折り返しも3字下げ）。本文に字下げが打ってあってもなくても同じ。
- 柱＝行頭。前に空行を1つ置く（本文に空行が打ってあっても増やさない）。頁の最終行には置かず次頁へ送る。
- セリフ＝話者名を行頭に置き、2行目以降は1字下げ（話者の有無によらない）。
- 感嘆符・疑問符の後ろは1マス空ける（閉じ括弧・行末・既に空いている所は空けない。`normalizeScriptText`）。
- 場面転換 `***` ＝ `×　　×　　×` を中央に、前後に空行。連続する空行は1つに畳む。頁頭の空行は捨てる。
- 禁則＝句読点のぶら下げ、閉じ括弧・小書き仮名・長音の追い出し、開き括弧の送り。半角英数・空白は全角に揃える。ルビは親文字、傍点・用語引用は素の文字。
`blocksToHtml` に script opts は持たせない（小説の HTML と同一経路）。

**FR-4 エディタ** — PC ツールバーとスマホ記法バーにルビ・傍点・用語引用・セリフ。脚本では柱・場面転換も表示し、スマホ記法バーだけ「ト書き」「ト書き解除」も出す。セリフ＝`「」`（丸括弧・隅付き括弧のボタンは利用頻度が低いため置かない）。選択があれば囲み、なければキャレットを内側へ。柱＝行頭に `○`（選択があれば `○選択`）。ト書きは PC では Tab で現在行または選択範囲の各行を全角3字下げに揃え、Shift+Tab で外す。字下げした行の Enter は次の行も字下げ（抜けるのは Shift+Tab）。Esc 直後の Tab はフォーカス移動に返す。PC ツールバーの脚本時にはⓘ（`FieldHelp`「脚本の書き方」）を置き、判別・自動字下げ・Tab 操作・自動で揃うもの・プレビューと書き出しを説明する（「ト書き Tab／解除 Shift+Tab」の表記はやめた）。脚本の本文のプレイスホルダーは「柱・セリフ以外の行はト書きとして自動で3字下がる」旨にする。「場面転換」は現在行の前に独立した `***` 行を入れ、選択中の本文も消さない。キーは Ctrl/Cmd+I/B/K（ルビ/傍点/用語引用）、Ctrl+Alt+D/H/S/E/M（セリフ/柱/場面転換/三点リーダー/ダッシュ。MacはCtrl+Option）。三点リーダー「……」とダッシュ「――」は2マス分をまとめて入れる型で、小説でも使える（選択があれば置き換え）。PC ツールバーではラベルの下にキーを表示し、スマホの記法バーには表示しない。IME中には動作させない。

**FR-10 書式チェック** — 脚本の本文下に開閉式の確認候補一覧。柱がない原稿、空の柱、話者名のないセリフ、話者を認識できない鉤括弧入りの行、行内の括弧の不一致、セリフ末尾の句点、算用数字（縦書きは漢数字）、カメラワーク・演出の指示語、用語集の「人物」（名前・別名）に無い話者（話者ごとに1回・補足は外して照合）を示す。候補を押すと該当行を選択する。意図した書き方は許容し、本文の自動変更や保存・書き出しの阻止はしない。ト書きの3字下げは引き続き表示・書き出し側で処理。

**FR-5 書き出し（脚本・提出用）** — 書き出しダイアログの形式一覧は作品の形式で出し分ける。脚本＝「脚本（提出用）」（先頭）・サウンドノベル・フォルダ zip・AI に渡す。出力は Word A4（14pt）／Word B5（12pt）／テキストの3択で、既定は Word A4。小説＝EPUB・Web 投稿形式・サウンドノベル・フォルダ zip・AI に渡す。EPUB・なろう・カクヨムの exporter は script opts を持たず、脚本でも出力は小説と同じ（UI から呼ばない）。
Word は `src/core/exporter/toDocx.ts` が作る `.docx`（`題名_脚本_A4.docx`／`_B5.docx`・自前 zip・依存なし）。提出用テンプレート（横置き・縦書き tbRl・行グリッド 20字×20行・游明朝・柱書き／ト書き（leftChars 300）／セリフ（hangingChars 100）の段落スタイル・フッター中央に PAGE）を写し、用紙・余白・`docGrid` の値はテンプレートと同一。前付け（表紙＝題名 24/20pt を紙の中央（`jc center`＋節の `vAlign center`）・著者名 16/14pt 行末寄せ／【人物一覧表】＝`名前…説明`／【あらすじ】）はそれぞれ独立したページにし（表紙は中央寄せの節、人物一覧表とあらすじは改ページで分けた通常の節）、本文の節にだけフッターと `pgNumType start=1` を付ける。話のタイトルは載せず、話が複数なら改ページで続ける。
テキストは `src/core/exporter/toScriptText.ts` が作る `.txt`（`題名_脚本.txt`）。公募の規定は多様なので、固定レイアウト（PDF）ではなく Word 等へ貼って手直しできる流し込みなしのテキストにする。行頭の規則だけ焼き込む：柱＝行頭 `○`・前に空行1つ（打ってあっても増やさない）／ト書き＝全角空白3つ／セリフ＝話者名から（折り返しが無いので2行目の1字下げは付けない）／`***`＝3字下げの `×　　×　　×`／半角→全角・！？の後ろ1マス。前付け＝表紙（題名・著者名）／登場人物表（用語集の「人物」＝`PERSON_CATEGORY`・名前＋summary）／梗概（`Work.synopsis`）を見出し付きで先頭に置き、区切りは空行2つ。話が複数なら題名を見出しに。ダイアログの設定は前付け3つの有無と、本文の枚数（20字×20行換算）・梗概の字数の表示。
`Work.synopsis?: string`（optional・上限 `MAX_SYNOPSIS_LENGTH`=1200）は結末まで書く提出用の梗概で、読者向けの `description`（grove・EPUB）とは別物。作品情報ダイアログでは脚本のときだけ欄を出し、小説へ戻しても値は保つ。`updateWorkMeta`・MCP `set_work_meta`（`synopsis` 引数）は渡したときだけ更新し、空文字でキーを消す。grove へは送らない（`BundleWork` の `Omit`）。バックアップ・同期・フォルダ zip は Work を丸ごと運ぶので追加対応なし。AI 向けテキスト（`workToPlainText`）は脚本のときだけ `梗概:` を載せる。
プレビューのノンブルは本文の最初の頁を 1 とし、前付けの頁には振らない（`paginate(lines, opts, numberFrom)`）。

**FR-6 grove 公開** — 脚本の作品を送るときだけ `work.format: 'script'` を載せて契約 v7 で名乗る。小説は載せず版も上げない。grove が v7 未対応（`supported < 7`）なら「公開先がまだ脚本の体裁に対応していません。作品情報で形式を小説にしてから、もう一度お試しください。」。**grove（novel-platform）の v7 対応が先。それまで v7 送信を main へ入れない。**

**FR-8 切替口・一覧・ヘルプ** — 新規作品の作成時にもタイトルと一緒に「小説／脚本」を選べる（既定は小説、作成ごとに初期化）。選んだ形式は最初の保存に含める。作品情報ダイアログに「形式」ラジオ（小説／脚本・あらすじの下）＋ⓘ（`FieldHelp`）。説明文を「作品の情報を編集します。EPUB やコトノハ-grove- に反映されます。」に。形式だけ変えて保存しても他欄は据え置き。ライブラリのカード・行に「脚本」バッジ（wheat：`bg-secondary-container text-on-secondary-container`）。ヘルプに「脚本を書く」節。

**FR-9 MCP** — `set_work_meta` に `format`（`'novel'` はキー削除）。`list_works`・`get_work` に脚本の作品だけ `形式: 脚本` 行（`get_work` は判別ルール 1 行も）。`set_episode` の説明文に脚本の書き方を足し、廃止済みの「行頭＊」記述を消す。

## 画面
プロトタイプの ①〜⑧ と対応。現状スクショは `screens/`。
- エディタ ①②：記法ボタンは小説4つ・脚本 PC 6つ／スマホ8つ。キーを併記し、脚本では本文下に書式チェックを表示（追加要望により元プロトタイプから拡張）
- プレビュー ③④⑤：原稿用紙（縦 20×20／横 40×40）。柱＝太字・前に 1 行／ト書き＝3 字下げ／セリフ＝話者の後ろに揃える。上に枚数
- 書き出し：脚本 PDF（用紙・前付けの切替・頁数・印刷へ）
- 作品情報 ⑥：形式ラジオ＋ⓘ
- ライブラリ ⑦：「脚本」バッジ
- ヘルプ ⑧：「脚本を書く」節（判別 3 行・ボタン・書き出し）

## 実装の骨格
| 種別 | パス | 責務 |
|---|---|---|
| 変更 | `src/core/schema/index.ts` | `WorkFormatSchema`・`Work.format` optional |
| 新規 | `src/core/script/index.ts` + test | `classifyScriptBlock`・`splitSpeaker`・`stripLeadingSpace` |
| 新規 | `src/core/script/layout.ts` + test | 原稿用紙の流し込み・禁則・頁割り・前付け（`layoutScriptBlocks` `paginate` `composeScriptSheet`） |
| 新規 | `src/ui/components/ScriptSheet/`（`script-sheet.tsx` `script-sheet-view.tsx`）| 原稿用紙のプレビュー（読書サイズ基準）・用紙プリセット |
| 新規 | `src/core/exporter/toScriptText.ts` + test | 脚本テキスト（前付け＋本文）・`sheetSourceOf` |
| 新規 | `src/core/exporter/toDocx.ts` + test | 脚本 Word（原稿用紙設定のテンプレート互換・A4/B5 プリセット・段落スタイル） |
| 変更 | `src/core/script/proofread.ts` | 句点・算用数字・カメラワーク・登場人物表に無い話者の確認候補 |
| 変更 | `src/core/schema/index.ts` `store/editorStore.ts` `storage/workRepository.ts` `mcp-edit/index.ts` `mcp-server.ts` `_api/publish.ts` | `Work.synopsis`（梗概）の保存・要約・MCP・grove 除外 |
| 変更 | `src/core/exporter/toPlainText.ts`(`workToPlainText` のメタ行のみ) | 形式・梗概のメタ行。EPUB／なろう／カクヨム／HTML は小説専用のまま |
| 変更 | `src/ui/components/ExportDialog/export-dialog.tsx` | 形式の出し分け・脚本テキストの設定 |
| 変更 | `src/ui/App.tsx` `EditorPane/editor-pane.tsx`(`scriptMode` prop) `EditorPane/notation-bar.tsx`(items prop) | ボタン・previewHtml |
| 変更 | `WorkMetaDialog/work-meta-dialog.tsx` `store/editorStore.ts` `storage/workRepository.ts` `Library/{project-card,project-row,library}.tsx` `App.tsx:852` `HelpPage/help-page.tsx` `src/ui/index.css` | 切替口・一覧・ヘルプ・体裁 |
| 変更 | `src/ui/_api/publish.ts` | v7・`BundleWork.format?: 'script'`（`Omit` に `'format'`）・409 案内 |
| 変更 | `src/core/mcp-edit/index.ts` `functions/api/_lib/mcp-server.ts` | `format` パッチ・出力行・説明文 |
| 変更 | `docs/requirement/02-notation-and-format.md` `docs/CODEMAP.md` `e2e/smoke.spec.ts` | 文書・回帰 |

## テスト
- unit：判別表の全例・`splitSpeaker`（text 分割／ref＋補足／ruby）・原稿用紙の折り返し／禁則／字下げ／！？の1マス／頁割り／ノンブル／前付け・`ScriptSheet` の描画・脚本テキストの行と前付け・書式チェックの追加項目・書き出しダイアログの形式出し分けとダウンロード・梗概の保存／MCP／grove 除外・EPUB／なろう／カクヨムが形式で変わらないこと・`WorkSchema.parse`（無し／`script`／不正値）・`setWorkMeta`・`toBundleWork` と v7・409 案内文
- integration：ダイアログの初期値と submit・`updateWorkMeta` の `'novel'` でキー削除・`applyNotation('slug'|'dialogue')` のキャレット・バッジの有無
- e2e：脚本にして例文を打つ → `.sheet` に柱・ト書き（3字下げ）・セリフの行、縦横切替、書き出しに「脚本（提出用）」（Word A4 が既定）だけ

## 守ること
- `format` は optional で足す。削除・必須化なし。未設定＝小説
- `updateWorkMeta`・`setWorkMeta` は渡した項目だけ更新。他欄を落とさない
- 小説の作品の HTML・EPUB・なろう・カクヨム出力は 1 バイトも変えない（テストで固定）。脚本でもこれらの exporter の出力は同じ（UI から呼ばないだけ）
- publish は使うときだけ v7 を名乗る。フォルダ zip・同期・演出譜アンカーは触らない
- 既知リスク：`format` を知らない旧クライアントが同期で保存し直すと `format` が落ちる（`coverImage` 追加時と同じ性質・PWA 更新で解消・リリースノートに書く）

## やらないこと
演出譜の話者判別の変更（後続 issue）／話ごとの形式／Block への種類保存／脚本の EPUB・なろう・カクヨム出力／PDF 出力（公募の規定が多様なので、テキストを Word 等で整える）／柱の `○` 以外の記号／`＊` 行以外の既存記法の変更

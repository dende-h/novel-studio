# テキストの取り込み（.txt を読み込んで話に分ける） 仕様書（COT-31）

- 要件: COT-36 ／ 設計: COT-37 ／ プロトタイプ: https://claude.ai/artifact/BodvdMcJTZYYTCYM54uLKT （ローカル `docs/specs/COT-31/prototype.html`）
- 状態: レビュー通過（Round 2・独立レビュー）
- 詳細: `requirements.md`（受け入れ条件の全文）・`design.md`（関数シグネチャ・テスト計画）

## 何を作るか

作品一覧の「データ管理」メニューに「テキストから作品を作る」を足す。.txt（複数可）か貼り付けた本文を読み込み、「第1話」のような見出し行で話に分け、分かれ方を確かめてから新しい作品を1つ作る。スキーマは変えない。

## 振る舞い

**FR-1 ファイルの読み込み**
- `.txt` だけ受ける。選択・ドロップとも拡張子で判定し、他は「.txt のテキストファイルを選んでください」。
- 文字コードは UTF-8（fatal）→ Shift_JIS の順で復号し、結果に U+FFFD か、タブ・改行以外の制御文字（U+0000〜U+0008, U+000B, U+000C, U+000E〜U+001F）があれば失敗。失敗したファイルだけ「「名前」は読み込めませんでした。UTF-8 か Shift_JIS のテキストファイルを選んでください」と出し、他は残す。
- BOM を除き、CRLF／CR を LF に揃える。
- 複数ファイルはファイル名の自然順（`2.txt` < `10.txt`）。同名ファイルは「同じ名前のファイルはすでにあります」で追加しない。
- 生テキスト合計（ファイル＋貼り付け）が 20MB を超える追加は「合計 20MB までのテキストを取り込めます」で拒否。

**FR-2 貼り付け**
- 「ファイル｜貼り付け」の切り替え。貼り付けは入力停止後 300ms でプレビューに反映。見えている側の入力だけからプレビューを作る。

**FR-3 分け方**（既定は「見出し行で分ける」）
- 見出し行＝trim 後 40 文字以内で、①`第N話／章／節／部／回／幕／夜／日`（半角・全角・漢数字）で始まる ②`プロローグ／エピローグ／序章／終章／幕間／間章／後日談／まえがき／あとがき` で始まる ③数字だけ、または数字＋`.．、:：`＋空白で始まる ④`#`〜`###`＋空白 ⑤`【…】` だけ、`■` で始まる。行途中の語は見出しにしない。
- 見出し行はその話のタイトルになり本文から除く（「見出し行を本文にも残す」オンで残す）。先頭の見出しより前の本文は捨てず1話にする（タイトル＝ファイル名。貼り付けは「序」）。見出しが無いファイルは1話（タイトル＝ファイル名。貼り付けは「第1話」）＋案内「見出しが見つからなかったので、1話にまとめました」。
- 「罫線だけの行（--- や ＊＊＊）でも分ける」は既定オフ。オンのとき、空白を除いて `-=ー―─━＊*※#＃` だけが3文字以上並ぶ行で分け、その行は本文に残さない。タイトルは通し番号の「第N話」。
- 「ファイルごとに1話」（貼り付けでは disabled）、「分けない」（全部を1話・タイトルは作品タイトル）。

**FR-4 プレビュー**
- 「N 話に分かれます・合計 M 字」（この行だけ `aria-live="polite"`）と、話ごとに タイトル欄・冒頭2行・分けた理由（見出し／区切り／ファイル／見出しの前）・元ファイル名・字数。設定変更は即座に反映。空のとき「テキストを読み込むと、ここに話の分かれ方が出ます」。

**FR-5 手直し**
- タイトル欄の編集（空のまま作ると「第N話」）。2話目以降に「前の話とつなげる」。手直しは「元ファイル名＋開始行」のキーで保持し、つなげても他の手直しはずれない。分け方の設定を変えると手直しは解除。

**FR-6 作成**
- 「作品を作る」は 話 0 件・作品タイトル空・作成中 で disabled。作品タイトルの既定はファイルなら先頭ファイル名（拡張子なし）、貼り付けなら「取り込んだ作品」。著者の既定はプロフィールのペンネーム。
- 組み立てた Work の JSON（UTF-8 バイト数）が 20MB 超なら保存せず「本文が大きすぎます。ファイルを分けて取り込んでください」。
- 保存は `store.importWorks([work])`。完了相「N 話で「タイトル」を作りました」→「執筆を始める」（`openWork(id)` → `#/write`）／「閉じる」。
- ゲスト・無料・有料で同じ。既存作品には触れない。

**FR-7 記法**
- ルビ `｜親《よみ》`・傍点 `《《》》`・字下げはそのまま `parseEpisodeBody` に通す。なろう式傍点 `｜字《・》` はルビのまま（変換しない）。

## 画面

- 作品一覧 › データ管理メニュー：「バックアップを取り込み」の直後に「テキストから作品を作る」（`DataMenuItem`・アイコン FileText・ラベルのみ・幅そのまま）。現状 `screens/data-menu-desktop.png`。
- 新規ダイアログ `TextImportDialog`：ヘッダ「テキストから作品を作る」＋「.txt や貼り付けた本文を、見出しの行で話に分けます」。desktop は左（入力元トグル／ドロップ領域＋ファイル一覧／貼り付け欄／分け方ラジオ＋2スイッチ／作品タイトル・著者）、右（プレビュー）。幅は `ExportDialog` と同じ `md:max-w-3xl lg:max-w-5xl`。フッター左にエラー、右に「キャンセル」「作品を作る」。
- モバイル（`useIsNarrow`）：2ステップ。1＝入力と分け方、「キャンセル」「次へ」（0 件なら disabled）。2＝作品情報＋プレビュー、「戻る」「作品を作る」。高さは `DialogContent` の既定 `max-h` のまま `DialogBody` をスクロール。
- トーストは使わない（既存 ImportDialog と同じく結果はダイアログ内）。プロトタイプの状態切り替え（ファイル／貼り付け／見出しなし／エラー／大きすぎる／空／完了）を参照。

## 実装の骨格

| 種別 | パス | 責務 |
|---|---|---|
| 新規 | `src/core/importer/text.ts` | `decodeTextFile` `looksLikeText` `normalizeImportedText` `workJsonBytes` `MAX_IMPORT_BYTES` `MAX_WORK_JSON_BYTES` |
| 新規 | `src/core/importer/split.ts` | `splitEpisodes` `isHeadingLine` `isSeparatorLine` `sortSourcesNatural` `episodeKey` `applyEdits` |
| 新規 | `src/core/importer/build.ts` | `buildImportedWork`（→ `Work`） |
| 新規 | `src/core/importer/index.ts` + `*.test.ts` | 再 export・unit テスト |
| 新規 | `src/ui/components/TextImportDialog/`（`text-import-dialog.tsx` `source-pane.tsx` `preview-pane.tsx` `use-text-import.ts` `*.test.tsx`） | ダイアログ |
| 変更 | `src/ui/components/Library/library.tsx` | メニュー項目・state・配線 |
| 新規 | `e2e/text-import.spec.ts` | 貼り付け／ファイルの e2e |
| 変更 | `docs/requirement/99-open-questions.md` `docs/CODEMAP.md` `HelpPage`（1行・任意） | 文書追従 |

データモデル差分：なし。作る Work は `{ id, title, author?, updatedAt, episodes: [{ id, title, blocks: parseEpisodeBody(body) }] }`。`format` は付けない。シグネチャの詳細は `design.md`「ロジック・API」。

## テスト

- unit（`src/core/importer/*.test.ts`）：正規化（BOM/CRLF/CR）、復号（UTF-8／Shift_JIS 固定バイト列／PNG ヘッダ→null／NUL→null）、見出し規則①〜⑤の正例・負例、前文・見出しなし・複数ファイル・各モード・区切りオン/オフ、`applyEdits`（つなげた後も他の手直しが残る・同名ソースの衝突）、`buildImportedWork`（`WorkSchema.parse` 通過・id 一意・記法往復・空タイトル補完）、`workJsonBytes`。
- integration（`text-import-dialog.test.tsx`・`library.test.tsx`）：貼り付け→プレビュー→タイトル編集→作成→完了→執筆。disabled 条件。`.md`・同名の拒否文言。JSON 上限超過で保存されない。メニューから開く。
- e2e（`e2e/text-import.spec.ts`）：貼り付け→作成→一覧→執筆画面で本文。`setInputFiles` の buffer で UTF-8 2 ファイル→自然順→作成。

## 守ること

- `src/core/importer/` は React・`src/ui/` を import しない。`TextDecoder`／`TextEncoder` は標準 API としてそのまま使う。
- スキーマ・IndexedDB・同期・バックアップ・publish・MCP に変更を入れない。既存作品を書き換えない。
- 利用者の文章を暗黙に捨てない（前文も残す。失敗したファイルは他に影響させない）。
- 同期の 25MB 上限は作成時の JSON サイズ判定で守る（クライアントに 413 の個別処理は無い）。
- Node の `TextDecoder('shift_jis')` は full-ICU 前提。CI で `RangeError` なら Shift_JIS ケースだけ環境判定で skip し、e2e で担保。

## やらないこと

- 既存作品への話の追加取り込み／脚本形式での取り込み／ファイル順の手動並べ替え／`.md` など `.txt` 以外／EUC-JP・UTF-16／なろう式傍点の変換／前書き・後書きの分離

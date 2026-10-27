# 投稿サイトのバックアップ ZIP の取り込みと、全話の書き出し 仕様書（COT-65）

- 要件: COT-68 ／ 設計: COT-69 ／ プロトタイプ: https://claude.ai/artifact/24J7DSAagnLAhcLY4Zyp5Q
- 状態: レビュー4ラウンド（Round 4 の指摘は修正済み）。実物の形は `samples.md`

## 何を作るか

「テキストから作品を作る」で、カクヨムと小説家になろうのバックアップ ZIP（となろうの txt）を受けて話に分ける。見分けられない ZIP は中の .txt を1ファイル1話で取り込む。「Web投稿形式」で、全話を ZIP（話ごとの .txt）か1本の .txt で書き出す。スキーマは変えない。

## 振る舞い

- **FR-1 ZIP を受ける**：`accept=".txt,.zip"`。ZIP は1回に1つで、.txt と混ぜない（「ZIP は1つずつ取り込めます…」）。一覧に ZIP の行と見分けた結果
- **FR-2 安全な展開と文字コード**：中央ディレクトリだけを先に読み、20MB 超・暗号化・未対応方式・txt 無し・壊れた ZIP は展開しない。申告より長く展開されたら打ち切る。名前は UTF-8 フラグ → UTF-8 → Shift_JIS。本文は JIS（ESC の並び）→ UTF-8 → Shift_JIS と EUC-JP を「ひらがなの数 − U+FFFD」で比べる（同点は Shift_JIS）。.txt の直接入力も同じ判定
- **FR-3 カクヨム**：`about.txt`＋`episode_NNNN.txt`（4桁）。題名は `【タイトル】`、本文は `【本文（N行）】` の次から N 行。章は about.txt の目次（`§`）から。`【作者名】`（@ID）は著者にしない。紹介文・タグの見出しは未確認（あれば読む）
- **FR-4 ノベルアップ+**：実物が届くまで見分けない（FR-6 で扱う）
- **FR-5 小説家になろう**：中身（`【Nコード】`＋`エピソードN開始` の区切り）で見分ける。章・題名・前書き（仮）・本文・後書きを読み分ける。ユーザ情報・評価・収益・リアクション・免責事項は読まない（許可リスト）。作品タイトル・著者の既定値は `【タイトル】` `【作者名】`（利用者が打った著者は上書きしない）。話数の検算。なろうの txt を直接入れても同じに読むが、1本だけ（同時に選んだ・あとから足したら、なろうの行を外して案内）。区切りの無い txt・2本入った ZIP はエラー
- **FR-6 見分けられない ZIP**：中の .txt をパスの自然順に、既定は1ファイル1話。ZIP から来た txt だけ題名の頭の番号を落とす（.txt の直接入力は COT-31 のまま）
- **FR-7 作品情報**：あらすじは先頭 250 字、タグは先頭 5 個（各 30 字）。入りきらないもの（あふれた紹介文・6個目以降のタグ・キャッチコピー・なろうの「作品に含まれる要素」）はネタ帳に1件。章の題名は章の最初の話の題名に添える（スイッチ。章が無ければ出さない）。前書き・後書きは「（前書き）」「（後書き）」の行を付けて本文に残す（スイッチ。無ければ出さない）
- **FR-8 全話 ZIP**：`NNN_<題名>.txt`（UTF-8・LF）。中身は1話の書き出しと同じ。名前に日本語があれば ZIP の UTF-8 フラグを立てる
- **FR-9 全話 1本**：話の題名を見出し行に（見出しの規則に当たらなければ「■」を付ける）
- **FR-10 往復**：なろうは「ZIP の txt の本文」と「分けた話の本文」、カクヨムは記法テキストどうしが一致（話の先頭・末尾の空行を除く）

## 画面

- テキストから作品を作る：ドロップ領域の案内（4つの文字コードと ZIP）、ZIP の行（バッジ・話数・字数・読み飛ばした件数）、サイトのときはスイッチ、プレビューの上に「作品情報に入るもの」と話数の食い違い、話の行に行数の印。2段（モバイル）の「次へ」は話が1つ以上で押せる
- Web投稿形式：「書き出す範囲」（この話／全話 ZIP／全話 1本）。話の選択は「この話」だけ

## 実装の骨格

| パス | 責務 |
|---|---|
| `src/core/zip/unzip.ts` | `listZipEntries` `extractEntry` `unzipEntries`（`src/ui/proofread/unzip.ts` から移す） |
| `src/core/zip/index.ts` | 日本語名のエントリで UTF-8 フラグ |
| `src/core/importer/text.ts` | 文字コードの判定（JIS・EUC-JP を足す） |
| `src/core/importer/archive.ts` | `readImportArchive` `readNarouText` `ArchiveResult` |
| `src/core/importer/sites/` | `index.ts`（見分け）・`kakuyomu.ts`・`narou.ts`・`sections.ts`・`__fixtures__/`（架空の文） |
| `src/core/importer/meta.ts` | `fitWorkMeta` `siteEpisodesToSplit`（警告・食い違い・スイッチの有無） |
| `src/core/importer/split.ts` | `stripNumberPrefix`（`fromArchive` だけ） |
| `src/core/importer/build.ts` | `description` `tags` |
| `src/core/exporter/toPostingSite.ts` | 全話 ZIP・1本の .txt・`safeFileName` |
| `TextImportDialog/` | ZIP の行・なろうの1本の規則（`Promise.all` でまとめて判定）・`authorOverride`・スイッチ・警告・`hasInput` |
| `ExportDialog/export-dialog.tsx` | 書き出す範囲 |
| `Library` / `Root.tsx` | `onAddIdea` |

## テスト

- unit：展開（上限・暗号化・申告超え・Shift_JIS の名前）、文字コード（JIS・EUC-JP・半角カナの Shift_JIS・既存判定の回帰）、カクヨム（章あり・なし・行数）、なろう（章2・1・0、後書き、取り込まない節、名前を変えた txt、2本、区切り無し）、作品情報の切り分け、全話の書き出しと往復
- integration：取り込みダイアログ（ZIP の行・混ぜない・同時に選ぶ・著者の上書き・スイッチ・警告・2段の「次へ」・ネタ帳）、書き出しの範囲
- e2e：全話 ZIP の往復、スマホ幅でカクヨムの ZIP を取り込む

## 守ること

- 取り込みの .txt と貼り付けの分け方・題名は変えない
- なろうのユーザID・評価・収益・リアクションを、作品にもネタ帳にも入れない
- テストのフィクスチャに実物の本文を入れない（構造だけ写した架空の文）

## やらないこと

- 記法の変換（COT-48）、ほかのサイトの記法での書き出し（COT-47）、既存の作品への追記、感想・画像の取り込み、Shift_JIS の書き出し、ノベルアップ+ の見分け（実物待ち）

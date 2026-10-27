# 設計 — COT-65 投稿サイトのバックアップ ZIP を取り込み、全話をまとめて書き出す（なろう・カクヨム・ノベルアップ+）

プロトタイプ: https://claude.ai/artifact/24J7DSAagnLAhcLY4Zyp5Q

> カクヨムと小説家になろうは実物の ZIP で形を確かめた（`samples.md`）。ノベルアップ+ は実物が無いので `sites/novelup.ts` は作らず、届くまでは見分けられない ZIP として扱う。

## 方針

- ZIP の展開を `src/core/zip/unzip.ts` に移し、展開の前に中央ディレクトリだけを読む `listZipEntries` を足す（サイズ・暗号化・方式・名前の文字コードを展開前に判定する）。`src/ui/proofread/unzip.ts` は core を再 export して、辞書の展開（`analyzer-engine.ts:103`）はそのまま動かす。
- 取り込みは COT-31 の流れに乗せる。ZIP は「1つのファイル」として一覧に入り、中身は `ImportSource[]` か、サイトの解釈が済んだ `SplitEpisode[]` として出てくる。プレビュー・手直し（`applyEdits`）・作品の組み立て（`buildImportedWork`）は共通。
- サイトの見分けは `detectArchive(entries)` が1か所で行い、サイトごとの解釈は `sites/<site>.ts` の純関数に分ける。見分けられなければ `ImportSource[]`（1ファイル＝1ソース）を返し、COT-31 の分け方を選べる。
- 書き出しは既存の1話ぶんの記法（`blocksToNarou` `blocksToKakuyomu`）を話の数だけ回し、ZIP は `zipStore`、1本の .txt は見出し行を挟んで連ねる。core に `src/core/exporter/toPostingSite.ts` を置く。
- 捨てた案：
  - ZIP を .txt と混ぜて受ける：サイトの見分けと、ファイル名の並びの意味が混ざる。1回に1つに絞る。
  - 入りきらない作品情報を `Work.synopsis` に入れる：梗概は応募原稿・脚本の提出用で、意味が違う。スキーマを変えずに残せるネタ帳にする。
  - 書き出しに Shift_JIS を出す：変換表が要る（依存か自前の表）。需要が見えるまで UTF-8 だけ（未決）。

## 変更ファイル

| 種別 | パス | 責務 / 変更内容 | 要件ID |
|---|---|---|---|
| 新規 | `src/core/zip/unzip.ts` | `listZipEntries(zip): ZipEntryInfo[]`（中央ディレクトリだけ読む。名前・展開後サイズ・方式・暗号化・UTF-8 フラグ）と `extractEntry(zip, entry): Promise<Uint8Array>`、`unzipEntries`（`src/ui/proofread/unzip.ts:23-50` から移す・名前の扱いは互換）。名前の復号は UTF-8 フラグ → UTF-8（fatal）→ Shift_JIS | FR-2 |
| 新規 | `src/core/zip/unzip.test.ts` | stored・deflate・UTF-8 フラグの有無・Shift_JIS の名前・暗号化・未対応の方式・壊れた ZIP・`zipStore` の出力を読み戻す | FR-2 |
| 変更 | `src/ui/proofread/unzip.ts` | core の `unzipEntries` を再 export するだけにする（辞書の展開の呼び口を変えない） | FR-2 |
| 変更 | `src/core/zip/index.ts` | `zipStore` が ASCII でない名前のとき、汎用ビットフラグの bit 11（UTF-8）を立てる（ローカルヘッダ `index.ts:52`・中央ディレクトリ `index.ts:76`）。ASCII だけの名前（EPUB・docx・サウンドノベル）は出力のバイト列が変わらない | FR-8 |
| 変更 | `src/core/importer/text.ts` | `decodeTextFile` の判定を変える：① ESC の並び（`1B 24 42` `1B 24 40` `1B 28 42` `1B 28 4A`）があれば ISO-2022-JP ② UTF-8（fatal）で `looksLikeText` を通れば UTF-8（通らなくても `return null` せず次へ＝いまの早期 return `text.ts:50-51` をやめる）③ Shift_JIS と EUC-JP の両方で復号し、`looksLikeText` を通ったものを `scoreJapanese`（ひらがなの数 − U+FFFD の数。漢字・カタカナは数えない）で比べて高いほう。同点なら Shift_JIS。`TextEncodingName` に `'euc-jp' | 'iso-2022-jp'` を足す | FR-2 |
| 新規 | `src/core/importer/archive.ts` | `readImportArchive(zip): Promise<ArchiveResult>`：検査（20MB・暗号化・方式・txt 無し）→ txt の展開と復号 → `detectArchive` → サイトの解釈か `ImportSource[]`。`ArchiveResult` の型 | FR-1, FR-2, FR-6 |
| 新規 | `src/core/importer/sites/index.ts` | `detectArchive(files): ArchiveSite`（`'kakuyomu' | 'narou' | 'unknown'`。ノベルアップ+ は実物が届いてから足す）と、`looksLikeNarou(text)`（中身で見分ける。名前では決めない）と、サイトごとの解釈の呼び分け | FR-3〜FR-6 |
| 新規 | `src/core/importer/sites/kakuyomu.ts` | カクヨムの解釈：`parseKakuyomu(files)`。about.txt の見出しと目次（`§` の章・`M.` の話）、`episode_NNNN.txt` の `【タイトル】` と `【本文（N行）】` | FR-3 |
| 新規 | `src/core/importer/sites/narou.ts` | なろうの解釈：`parseNarou(file)`。区切りの行で話に切り、作品情報の見出し（取り込む欄だけ）・`【第N章】`・`【エピソードタイトル】`・`【前書き】`・`【本文】`・`【後書き】` を読む。`【ユーザ情報】` `【評価】` `【収益情報】` `【リアクション】` `【免責事項】` は読まない | FR-5 |
| 新規 | `src/core/importer/sites/sections.ts` | 両サイト共通の `【見出し】` の節の読み取り（`readSections(text, knownHeadings)`：行頭が見出しの語と完全に一致する行だけを見出しにする） | FR-3, FR-5 |
| 新規 | `src/core/importer/sites/__fixtures__/` | `samples.md` の構造を写した架空の文の txt（カクヨム章あり・章なし、なろう章2つ・章1つ・章なし・後書きあり）。テストでは `zipStore` で ZIP にしてから読む。実物の ZIP と本文は入れない | FR-3, FR-5 |
| 新規 | `src/core/importer/meta.ts` | `fitWorkMeta(meta): { description?, tags?, overflowNote? }`（250 字・5 個・30 字の切り分けと、ネタ帳のメモの本文）、`siteEpisodesToSplit(episodes, opts)`（章の添え・前書き後書きの残し方を当てて `SplitEpisode[]` にする） | FR-7 |
| 変更 | `src/core/importer/split.ts` | `stripNumberPrefix(name)`（`001_坂` → `坂`、`001` はそのまま）を足す。`ImportSource` に `fromArchive?: boolean`（`split.ts:9-14`）を足し、`mode: 'file'` の題名（`split.ts:189-229` の file 分岐）で当てるのは `fromArchive` のソースだけ。.txt を直接入れたときの題名は変えない（既存の `split.test.ts` はそのまま通る） | FR-6, FR-10 |
| 変更 | `src/core/importer/build.ts` | `ImportedWorkInput` に `description?: string` `tags?: string[]` を足し、あれば `description` と `platform: { tags }` を付ける（`build.ts:10-40`） | FR-7 |
| 変更 | `src/core/importer/index.ts` | 上の export を足す | — |
| 新規 | `src/core/exporter/toPostingSite.ts` | `buildPostingSiteZip(work, site): ZipInput[]`（`NNN_<題名>.txt`）と `buildPostingSiteText(work, site): string`（見出し行つきの1本）、`headingLineOf(title)`（`isHeadingLine` に当たらなければ「■」を付ける） | FR-8, FR-9 |
| 新規 | `src/core/exporter/toPostingSite.test.ts` | ファイル名・連番・使えない文字・本文が1話の書き出しと一致・見出し行・往復（FR-10） | FR-8〜FR-10 |
| 変更 | `src/ui/_utils/exporters.ts` | `workPostingSiteZipExport(work, site)` `workPostingSiteTextExport(work, site)`。`safeName`（`exporters.ts:28-30`）を core の `toPostingSite.ts` と同じ規則にするため、core 側に `safeFileName` を置いて両方から使う | FR-8, FR-9 |
| 変更 | `src/ui/components/ExportDialog/export-dialog.tsx` | 「Web投稿 設定」（`export-dialog.tsx:505-555`）に「書き出す範囲」のチップ（この話／全話 ZIP／全話 1本）を足す。「話を選択」は「この話」のときだけ出す。`handleExport` の `web` 分岐（`export-dialog.tsx:313-319`）を範囲で分ける | FR-8, FR-9 |
| 変更 | `src/ui/components/TextImportDialog/use-text-import.ts` | `FileEntry` に `kind: 'zip'` の行（`archive: ArchiveResult`）を足す。`addFiles` で .zip を受け、1回に1つ・.txt と混ぜない判定。なろうの txt を直接入れたときの置き換え（ロジック節）。`MESSAGES.unreadable`（`use-text-import.ts:39-40`）を「UTF-8・Shift_JIS・EUC-JP・JIS のテキストファイルを選んでください」に、`MESSAGES` に `zipOnlyOne` `narouOnlyOne` `narouBroken` `narouMultiple` を足す。プレビューは ZIP のときサイトの話（`SplitEpisode[]`）か、見分けられなければ `ImportSource[]` を `splitEpisodes` に通す。章・前書き後書きの選択（`archiveOptions`）を持つ。作品タイトルの既定値を ZIP の作品情報の題名にする（`use-text-import.ts:109-114` の `defaultTitle`。`titleOverride` があればそちら）。著者は `author: string`（`use-text-import.ts:62`）を `authorOverride: string | null` に替え、表示する著者は「`authorOverride` → ZIP のなろうの `【作者名】` → ペンネーム」の順で導く。`setAuthor` は `authorOverride` を書く。ZIP を外すと ZIP の作者名は消え、上書きしていなければペンネームに戻る。`isTxtFile`（`use-text-import.ts:47`）の隣に `isZipFile` | FR-1, FR-6, FR-7 |
| 変更 | `src/ui/components/TextImportDialog/source-pane.tsx` | `encodingLabel`（`source-pane.tsx:30`）の型を `TextEncodingName` にし、EUC-JP・JIS の表示を足す。`accept=".txt,.zip"`（`source-pane.tsx:72`）・案内文（`source-pane.tsx:101-103`。「.txt（UTF-8・Shift_JIS・EUC-JP・JIS）・複数可、または投稿サイトのバックアップ ZIP（1つ）・合計 20MB まで」）・ZIP の行（見分けた結果・読み飛ばした件数・文字コード）。ZIP のときの「章の題名を話の題名に添える」「前書き・後書きを本文に残す」のスイッチ | FR-1, FR-2, FR-7 |
| 変更 | `src/ui/components/TextImportDialog/preview-pane.tsx` | ZIP のときプレビューの上に「どこへ何が入るか」の枠（紹介文・タグ・ネタ帳）と、話数の食い違い（`countMismatch`）。話の行に「本文の行数が合いませんでした」の印（`warnings`） | FR-3, FR-5, FR-7 |
| 変更 | `src/ui/components/TextImportDialog/text-import-dialog.tsx` | 2段（モバイル）の「次へ」の判定 `hasInput`（`text-import-dialog.tsx:83`・`:265`）を `preview.episodes.length > 0` に変える（サイトを見分けた ZIP では `preview.sources` が空のため）。`buildImportedWork` に `description` `tags` を渡す（`text-import-dialog.tsx:95-103`）。入りきらないものがあれば、作品の保存のあとに `onAddIdea(text)` を呼ぶ（失敗しても作品は作れたまま。完了画面に「ネタ帳への控えは残せませんでした」） | FR-7 |
| 変更 | `src/ui/components/Library/library.tsx` / `src/ui/Root.tsx` | `TextImportDialog` に `onAddIdea={(t) => ideaRepo.add(t)}` を渡す（`library.tsx:666-673`、`ideaRepo` は `Root.tsx:163`。Library の props に `onAddIdea` を足して Root から渡す `Root.tsx:486`） | FR-7 |
| 変更 | `src/ui/components/HelpPage/help-page.tsx` | 「バックアップする」の段落（`help-page.tsx:93-96`）に「投稿サイトのバックアップ ZIP」の一文、「書き出す」（`help-page.tsx:89-92`）に全話の書き出しの一文 | FR-1, FR-8 |
| 変更 | `docs/CODEMAP.md` | §1 の取り込みの行（`CODEMAP.md:44`）に ZIP、§2 の変換に `zip/unzip.ts`・`importer/archive.ts`・`importer/sites/`・`exporter/toPostingSite.ts` | — |

## データモデル

- Zod スキーマの差分：なし。
- 作る Work（`buildImportedWork`）：既存の `title` `author` `episodes` に加えて、あれば `description`（250 字まで）と `platform: { tags }`（5 個・各 30 字まで）。`platform` の他の欄は持たせない（未投稿の作品と同じ＝`schema/index.ts:165-167` の「未投稿の作品・旧データはキーごと持たない」に合わせ、`tags` だけ）。
- ネタ帳のメモ：既存の `IdeaNote`（`text` だけ）。`ideaRepo.add(text)`（`src/core/storage/ideaRepository.ts:19`）で1件。
- 新しい型（保存しない）

```ts
// src/core/zip/unzip.ts
export interface ZipEntryInfo {
  path: string            // 復号した名前（フォルダを含む）
  name: string            // パスの最後
  size: number            // 展開後
  compressedSize: number
  method: number          // 0 stored / 8 deflate / その他
  encrypted: boolean      // flag bit 0
  utf8Flag: boolean       // flag bit 11
  offset: number          // ローカルヘッダの位置
}

// src/core/importer/archive.ts
export type ArchiveSite = 'kakuyomu' | 'narou' | 'unknown' // 'novelup' は実物が届いてから
export interface ArchiveFile { path: string; text: string; encoding: TextEncodingName }
export interface ArchiveMeta {
  title?: string; author?: string          // author はなろうの【作者名】だけ（カクヨムの @ID は入れない）
  description?: string; catchphrase?: string; tags?: string[]
  extras?: { label: string; text: string }[] // ネタ帳にだけ残すもの（なろうの「作品に含まれる要素」など）
  declaredEpisodes?: number                  // なろうの【掲載エピソード数】（検算用）
}
export interface SiteEpisode { title: string; body: string; chapter?: string; foreword?: string; afterword?: string; sourcePath: string; sourceIndex: number; warning?: 'lineCountMismatch' }
export type ArchiveResult =
  | { ok: false; message: string }
  | { ok: true; site: Exclude<ArchiveSite, 'unknown'>; meta: ArchiveMeta; episodes: SiteEpisode[]; skipped: number; files: ArchiveFile[] }
  | { ok: true; site: 'unknown'; sources: ImportSource[]; skipped: number; files: ArchiveFile[] }
// なろうの txt を .txt として直接入れたときも、`readNarouText(name, text)` が同じ `ArchiveResult`（site: 'narou'）を返す。
// 失敗の理由（ok: false）に足すもの：区切りの無いなろうの txt（narouBroken）・なろうの txt が2本（narouMultiple）

// src/core/importer/meta.ts
export interface ArchiveOptions { chapterInTitle: boolean; keepNotes: boolean } // 既定 true / true
```

- `SiteEpisode` → `SplitEpisode`（`split.ts:32-39`）：`sourceName` に ZIP 内のパス、`sourceLine` に `sourceIndex`（カクヨムは 0＝1ファイル1話、なろうは話の通し番号）、`reason: 'file'`。手直しのキー（`episodeKey` `split.ts:238`）がなろうの1本の txt でも話ごとに一意になる。

## UI

### 画面: テキストから作品を作る（ライブラリ → データ管理 → テキストから作品を作る）
- 現状: `screens/text-import-desktop.png`・`screens/text-import-mobile.png`
- 変更点:
  - ① ドロップ領域の案内「.txt（UTF-8・Shift_JIS・EUC-JP・JIS）・複数可、または投稿サイトのバックアップ ZIP（1つ）・合計 20MB まで」
  - ② ZIP の行：アイコン（`FileArchive`）・ZIP の名前・見分けた結果のバッジ（「カクヨム」「小説家になろう」「ZIP」）・話の数・字数・✕。行の下に小さく「.txt 以外の 3 件は読み飛ばしました」「1 件は読めませんでした」
  - ③ ZIP のときの分け方：サイトを見分けたときは「分け方」の選択を隠し、代わりに「章の題名を話の題名に添える」（章が1つも無ければ出さない）「前書き・後書きを本文に残す」（前書き・後書きが1つも無ければ出さない）のスイッチ。見分けられないときは COT-31 の分け方（既定「ファイルごとに1話」）
  - ④ プレビューの上の枠「作品情報に入るもの」：あらすじ（紹介文の先頭 250 字）・タグ 5 個・「キャッチコピーなど 3 項目はネタ帳に控えます」
- 状態:
  - 空：COT-31 のまま
  - 読み込み中：ZIP の行に「読み込み中…」
  - エラー：ZIP の行に理由（FR-2 の文言）。作品を作るボタンは押せない
  - オフライン：影響なし
  - ゲスト・無料会員：全員使える
- モバイル: COT-31 のダイアログと同じく「1 読み込む › 2 確かめる」の2段（`screens/text-import-mobile.png`）。①〜③は1段目、④は2段目のプレビューの上。ZIP の行のバッジは名前の下に折り返す
- 形式（小説／脚本）の選択はそのまま残す（投稿サイトの ZIP は小説が前提だが、選べることは変えない）
- 使う共通部品: `Badge`・`Switch`・`Label`（`src/ui/components/ui/`）、行の見た目は既存のファイルの行（`source-pane.tsx:121-160`）
- 文言: 上記（toc-copy の作法）

### 画面: 書き出しダイアログ「Web投稿形式」
- 現状: `screens/export-web-desktop.png`・`screens/export-web-mobile.png`
- 変更点:
  - ⑤ 「投稿先」の下に「書き出す範囲」のチップ：この話／全話（ZIP・話ごとの .txt）／全話（1本の .txt）
  - ⑥ 「この話」のときだけ「話を選択」を出す。全話のときは「3話を書き出します」と、ファイルの形の説明（ZIP：「001_題名.txt のように、話の順に番号を付けます。1話ずつ読み込むサイトへ順に入れられます」／1本：「話の題名を見出しの行にして、1本につなげます。1本の .txt を受けて話に分けるサイト向けです」）
- 状態: 話が無い作品は押せない（いまと同じ）
- モバイル: チップは折り返す
- 使う共通部品: 既存のチップ（`export-dialog.tsx:512-527`）

## ロジック・API

```ts
// src/core/zip/unzip.ts
export function listZipEntries(zip: Uint8Array): ZipEntryInfo[]   // 壊れていれば throw
export function extractEntry(zip: Uint8Array, e: ZipEntryInfo): Promise<Uint8Array>
export function unzipEntries(zip: Uint8Array, wanted?: ReadonlySet<string>): Promise<Map<string, Uint8Array>> // 既存と同じ振る舞い

// src/core/importer/archive.ts
export const MAX_ARCHIVE_ENTRIES = 2000
export async function readImportArchive(zip: Uint8Array): Promise<ArchiveResult>
// 1) listZipEntries（throw → 「ZIP として読めませんでした」）
// 2) .txt の行だけ選ぶ（__MACOSX/・.DS_Store・フォルダ・ほかの拡張子は skipped に数える）。0 件 → 「txt がありません」
// 3) 暗号化・未対応の方式が1つでもある .txt → 理由。展開後サイズの合計 > MAX_IMPORT_BYTES → 理由。件数 > MAX_ARCHIVE_ENTRIES → 理由
// 4) 1件ずつ extractEntry → decodeTextFile。読めない件は除いて数える。extractEntry は展開した長さが中央ディレクトリの申告（size）を超えた時点で打ち切り、「ZIP として読めませんでした」に倒す（申告を偽った ZIP で 20MB の上限をすり抜けさせない）
// 5) detectArchive(files) → サイトなら sites/<site>.parse、unknown なら files をパスの自然順に ImportSource へ

// src/core/importer/meta.ts
export function fitWorkMeta(meta: ArchiveMeta, workTitle: string): { description?: string; tags?: string[]; overflowNote?: string }
export function siteEpisodesToSplit(episodes: SiteEpisode[], opts: ArchiveOptions, meta: ArchiveMeta): {
  episodes: SplitEpisode[]
  droppedNotes: number
  warnings: { key: EpisodeKey; kind: 'lineCountMismatch' }[]  // 話の行に出す（SiteEpisode.warning を episodeKey に結び直す）
  countMismatch?: { declared: number; found: number }        // なろうの【掲載エピソード数】と区切りの数が違うとき。プレビューの上に出す
  hasChapters: boolean; hasNotes: boolean                    // スイッチを出すかどうか（UI ③）
}

// src/core/importer/split.ts
export function stripNumberPrefix(base: string): string // /^[0-9０-９]{1,4}[_\-.．\s　]+(?=\S)/ を落とす
// ImportSource に `fromArchive?: boolean` を足し、file 分割の題名で stripNumberPrefix を当てるのは fromArchive のソースだけ（.txt を直接入れたときは COT-31 のまま）

// src/core/exporter/toPostingSite.ts
export type PostingSite = 'narou' | 'kakuyomu'
export function safeFileName(s: string): string // exporters.ts の safeName と同じ規則（core に移す）
export function buildPostingSiteZip(work: Work, site: PostingSite): ZipInput[]
export function headingLineOf(title: string, index: number): string // isHeadingLine なら title、そうでなければ `■${title}`。題名が空なら `第${index+1}話`
export function buildPostingSiteText(work: Work, site: PostingSite): string
```

- `zipStore` の UTF-8 フラグ：名前に U+0080 以上が1文字でもあれば flags = 0x0800。Windows のエクスプローラーなどで日本語のファイル名が化けないようにする。
- 見分けの順：カクヨム（直下に `about.txt` と `/^episode_\d{4}\.txt$/` が1件以上）→ なろう（中身に `/^【Nコード】$/m` と `/^-{25} エピソード1開始 -{25}$/m` の両方がある .txt が1本。名前は見ない。ほかの .txt は `ignored` に名前を控えて話にしない）→ unknown。ノベルアップ+（5桁）は実物が届いてから足す。
- unknown と、.txt を直接入れたとき：
  - `readImportArchive`：見分けの条件に合う txt が2本以上 → `ok: false`（narouMultiple）。`/^【ユーザ情報】$/m` があるのに区切りの行が無い txt が1本でもある → `ok: false`（narouBroken）
  - `addFiles`（`use-text-import.ts:152-209`）：復号した .txt が見分けの条件に合えば、その行を `kind: 'zip'` の行と同じ形（`archive: readNarouText(name, text)`）に置き換える。ほかの .txt と同時には持てない。判定は、1回の `addFiles` で受けたファイルを `Promise.all` で全部復号してから、1回の `setState` でまとめて行う（いまの1件ずつの `arrayBuffer().then` `use-text-import.ts:182-207` をやめる）：その回で受けたファイルのうち、なろうと分かったものが1本で、ほかに行が1つも無い（その回のほかのファイルも、すでに一覧にある行も無い。error の行も数える）ときだけ、なろうとして読む。そうでなければ、その回のなろうと分かったものをすべて外して `narouOnlyOne` を出し、ほかのファイルは残す（2本同時なら2本とも外れる）。すでに一覧になろうの行があるときに足した分は、復号の前（`:152-181`）に断る。一覧の行がまだ読み込み中のうちに足した分は、前の回の `setState` が済むまで待ってから判定する（`addFiles` を前の回の Promise につなぐ）ので、外れるのはいつも足した側になる。`【ユーザ情報】` があって区切りの行が無ければ、その行を `state: 'error'` にして narouBroken の文言を出す
  - これで、なろうの txt が1話の本文になる経路は無くなる（`splitEpisodes` に渡るのは、なろうと見分けなかった txt だけ）
- なろうの区切りの行：`/^-{25} エピソード(\d+)開始 -{25}$/`。作品情報の節の末尾は最初の区切り、最後の話の末尾は `【免責事項】`。本文の終わりは `【後書き】` か `【リアクション】` の行（行全体が一致するときだけ）。
- カクヨムの本文：`/^【本文（(\d+)行）】$/` の次の行から N 行。足りなければ残り全部を本文にして `warning: 'lineCountMismatch'`。
- 目次の読み方（カクヨム）：`/^§ (.+)$/` を章、`/^\s*(\d+)\. (.+)$/` を話（番号＝`episode_` の番号）。章の行の次から次の章の行までの話がその章。

## テスト計画

| 層 | 何を固定するか | 置き場所 |
|---|---|---|
| unit | 中央ディレクトリの読み取り・UTF-8 フラグ・Shift_JIS の名前・暗号化・未対応方式・壊れた ZIP・stored/deflate の展開・`zipStore` の出力の読み戻し | `src/core/zip/unzip.test.ts` |
| unit | `zipStore` の UTF-8 フラグ（日本語名で立つ・ASCII 名では立たず、既存のバイト列が変わらない） | `src/core/zip/index.test.ts`（既存に追加） |
| unit | EUC-JP・ISO-2022-JP の復号（日本語のバイト列のフィクスチャ）、半角カナだけの Shift_JIS（`B1 B2 B3 B4 B5 B6 0A C3 DE B1 B2`）、既存の UTF-8・Shift_JIS のケースが同じ判定、読めないバイト列 | `src/core/importer/text.test.ts` |
| unit | なろうの見分け：名前を変えたなろうの txt・ほかの txt と同梱・2本入った ZIP（narouMultiple）・区切りの無い txt（narouBroken）・`readNarouText`（ユーザID・評価が結果に無い） | `src/core/importer/sites/narou.test.ts`・`src/core/importer/archive.test.ts` |
| unit | `extractEntry`：申告より長く展開される ZIP を打ち切る | `src/core/zip/unzip.test.ts` |
| unit | `readImportArchive`：上限（展開せずに弾く）・txt 無し・読み飛ばしの数・読めない1件を除く・unknown の自然順 | `src/core/importer/archive.test.ts` |
| unit | `stripNumberPrefix`、file 分割の題名 | `src/core/importer/split.test.ts` |
| unit | `fitWorkMeta`（250 字・5 個・30 字・メモを作る／作らない）・`siteEpisodesToSplit`（章の添え・前書き後書きの残し方と捨てた件数） | `src/core/importer/meta.test.ts` |
| unit | カクヨム：章あり・章なし・本文の行数どおり（本文に `【…】` の行を含む）・行数が合わない txt・`@ID` を著者にしない。なろう：章2つ・章1つ（先頭だけ `【第1章】`）・章なし（`【第N章】` が無い）・後書き・前書き（仮の見出し）・取り込まない節（ユーザ情報・評価・収益・リアクション・免責事項の文字列が結果に無い）・話数の検算・CRLF | `src/core/importer/sites/kakuyomu.test.ts` `narou.test.ts` |
| unit | `buildImportedWork` の `description` `tags` | `src/core/importer/build.test.ts` |
| unit | 全話 ZIP のファイル名・連番（3桁／4桁）・使えない文字・本文が1話の書き出しと一致、1本の .txt の見出し行、往復（なろう：全話 ZIP → `readImportArchive` → `splitEpisodes`(file) → ZIP の txt の本文と分けた話の本文が一致。カクヨム：作品を作って `blocksToKakuyomu` の出力が一致。どちらも話の先頭・末尾の空行は除いて比べる。1本 → `splitEpisodes`(heading) → 本文が一致） | `src/core/exporter/toPostingSite.test.ts` |
| integration | 取り込み：ZIP を入れると行と見分けの結果が出る・.txt と混ぜられない・エラーの文言・スイッチでプレビューが変わる（章・前書き後書きが無いときはスイッチが出ない）・行数の印と話数の食い違いが出る・著者を先に打つと ZIP の作者名で上書きされない／ZIP を外すとペンネームに戻る・狭い幅（2段）で ZIP を入れると「次へ」が押せる・なろうの txt を直接入れるとなろうとして読まれ、著者の既定値が `【作者名】`・そのあと .txt を足せない（逆順も）・なろうの txt と別の .txt を同時に選ぶとなろうの行だけ外れて案内が出る・なろうの txt を2本同時に選ぶと2本とも外れる・なろうの txt の読み込み中に .txt を足すと足した側が断られる・error の行があるときになろうの txt を足すと外れる・区切りの無いなろうの txt がエラーの行になる・EUC-JP の .txt の行に「EUC-JP」の印・作品を作るとネタ帳への `onAddIdea` が呼ばれる／呼ばれない | `src/ui/components/TextImportDialog/text-import-dialog.test.tsx` |
| integration | 書き出し：範囲のチップ・「この話」だけ話の選択が出る・全話 ZIP と1本で `triggerDownload` のファイル名と MIME | `src/ui/components/ExportDialog/export-dialog.test.tsx` |
| e2e | 3話の作品を全話 ZIP（なろう）で書き出し、その ZIP をテキストから作品を作るに入れて、3話の題名がプレビューに出る（往復） | `e2e/text-import.spec.ts`（既存に追加） |
| e2e | スマホ幅でカクヨム形式の ZIP（フィクスチャを `zipStore` で作る）を入れ、「次へ」で2段目に進み、話が並ぶ | `e2e/mobile.spec.ts`（既存に追加） |

## リスク・未決事項

- ノベルアップ+ の実物が未確認。届くまでは見分けない。カクヨムの紹介文・キャッチコピー・タグ、なろうの前書きの見出し名も未確認（設定のある作品の ZIP で確かめる）。読めない見出しは無視するので、名前が違っても取り込みは止まらず、作品情報が入らないだけになる。
- なろうの ZIP には、作者のユーザID・評価・収益の数字が入っている。取り込みの対象を見出しの許可リストで決め（拒否リストにしない）、許可していない節は読まない。テストで、これらの文字列が作品にもネタ帳のメモにも入らないことを固める。
- 1本の .txt の往復：本文の中に見出し行の規則に当たる行（「1. 」で始まる行・「【回想】」だけの行など）があると、取り込みで余分に分かれる。題名が 40 字を超えると「■」を付けても見出し行にならない（`HEADING_MAX_LENGTH` `split.ts:48`）。どちらもプレビューの「前の話とつなげる」で直せるが、往復のテストはこれらを含まない文で固め、画面の説明に「本文の書き方によっては、取り込むときに分かれ方を直す必要があります」と添える。
- `zipStore` の UTF-8 フラグが立つのは、中に日本語名のエントリを作る今回の全話 ZIP だけ。既存の書き出し（EPUB・docx・サウンドノベル・フォルダ(ZIP)＝`manifest.json` と `001.txt` `src/core/folder/index.ts:24-26`）は中のエントリ名が ASCII なので、出力は変わらない。
- 展開は `DecompressionStream('deflate-raw')`（`src/ui/proofread/unzip.ts:16-21`）に頼る。Node のテスト環境と、対応ブラウザ（Safari 16.4 以降）で動く。古いブラウザでは「この ZIP の形式には対応していません」に倒す。
- ひらがなを1字も含まない EUC-JP の .txt（全角カタカナと漢字だけ・半角カナだけ）は、点数が同点になり Shift_JIS と判定されうる（化けて取り込まれる）。小説の本文ではまず起きないので規則は変えず、プレビューで化けに気づけば、ファイルを UTF-8 で保存し直してもらう。
- 未決（要件と同じ）：Shift_JIS の書き出し、カクヨムの下書きの印。

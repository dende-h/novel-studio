# 設計 COT-31 テキストの取り込み（.txt を読み込んで話に分ける）

プロトタイプ: https://claude.ai/artifact/BodvdMcJTZYYTCYM54uLKT （ローカル: `docs/specs/COT-31/prototype.html`・非公開 Artifact）

## 方針

- 分割・正規化・文字コード判別・Work 組み立ては `src/core/importer/` に純関数として置き、テストで固める。UI はそれを呼ぶだけ。
- 入口は作品一覧「データ管理」メニューに「テキストから作品を作る」を足し、専用ダイアログ `TextImportDialog` を新設する。既存 `ImportDialog`（JSON）は触らない（文言と判別ロジックが JSON 前提で、混ぜると両方が複雑になる）。
- 保存は既存の `store.importWorks([work])` を使う（`WorkSchema.parse` を通って IndexedDB に入る）。新しい store action・repository・スキーマは作らない。
- 文字コードは `TextDecoder('utf-8', {fatal: true})` で試し、失敗したら `TextDecoder('shift_jis')`。どちらの結果も「U+FFFD か、タブ・改行以外の制御文字を含めば失敗」の検査を通す（Shift_JIS デコーダは PNG ヘッダのような任意バイト列も黙って文字にするため）。ブラウザと Node（full-ICU）の双方で使える標準 API なので依存は増やさない。
- 容量は二段構え。入力側で生テキスト合計 20MB を足切りし（UI の応答性）、作成時に `buildImportedWork` の結果を `JSON.stringify` した UTF-8 バイト数で 20MB を判定して超えたら保存しない（同期の 25MB 上限 `functions/api/sync/work.ts:116-117` は JSON 平文で測るため）。
- 捨てた案：`ImportDialog` の accept を広げる（JSON と .txt で確認画面が全く違う）。`src/core/folder/index.ts:48-62` `folderToWork` の流用（`manifest.json` 必須で用途が違う）。

## 変更ファイル

| 種別 | パス | 責務 / 変更内容 | 要件ID |
|---|---|---|---|
| 新規 | `src/core/importer/text.ts` | `decodeTextFile`（UTF-8→Shift_JIS の2段階判別＋制御文字検査）、`normalizeImportedText`（BOM 除去・CRLF/CR→LF）、`MAX_IMPORT_BYTES`・`MAX_WORK_JSON_BYTES`・`workJsonBytes` | FR-1 |
| 新規 | `src/core/importer/split.ts` | `splitEpisodes`（見出し／区切り／ファイル／分けない）、`isHeadingLine`・`isSeparatorLine`、`episodeKey`・`applyEdits`（手直し＝タイトル変更と「前の話とつなげる」を安定キーで適用）、`SplitOptions`/`SplitEpisode` 型 | FR-3, FR-5 |
| 新規 | `src/core/importer/build.ts` | `buildImportedWork`（分割結果 → `Work`。本文は `parseEpisodeBody`、タイトル空は「第N話」） | FR-6, FR-7 |
| 新規 | `src/core/importer/index.ts` | 再 export | — |
| 新規 | `src/core/importer/*.test.ts` | 上記の unit テスト（Shift_JIS のバイト列フィクスチャを含む） | FR-1, FR-3, FR-5, FR-7 |
| 新規 | `src/ui/components/TextImportDialog/text-import-dialog.tsx` | ダイアログ本体。段階 `edit` → `done`。左：入力（ファイル／貼り付け・分け方・作品情報）、右：プレビュー。`useIsNarrow` で2段のステップ表示 | FR-1〜FR-6 |
| 新規 | `src/ui/components/TextImportDialog/source-pane.tsx` | 左ペイン（ドロップ領域・ファイル一覧・貼り付け欄・分け方） | FR-1, FR-2, FR-3 |
| 新規 | `src/ui/components/TextImportDialog/preview-pane.tsx` | 右ペイン（話一覧・タイトル編集・前の話とつなげる） | FR-4, FR-5 |
| 新規 | `src/ui/components/TextImportDialog/use-text-import.ts` | ダイアログの状態（sources・options・manual edits・preview を `useMemo` で導出）。File の読み取り（`arrayBuffer()` → core） | FR-1〜FR-5 |
| 新規 | `src/ui/components/TextImportDialog/text-import-dialog.test.tsx` | 貼り付け→プレビュー→作成→完了の integration テスト | FR-2, FR-4, FR-6 |
| 変更 | `src/ui/components/Library/library.tsx` | 「データ管理」メニュー（`:463-523`・自前の `role="menu"`・幅 `w-[230px]` `:461`）に `DataMenuItem`「テキストから作品を作る」を追加（「バックアップを取り込み」`:472-479` の直後。既存と同じラベルのみ・`DataMenuItem` の props `icon/label/onClick/disabled/badge` `:108-121` はそのまま）。`textImportOpen` state と `<TextImportDialog>` の配線（`<ImportDialog>` `:627-632` の隣） | FR-1, FR-6 |
| 変更 | `src/ui/components/HelpPage/`（該当節） | 「データ管理」の説明に1行追記（任意・文言は toc-copy） | — |
| 新規 | `e2e/text-import.spec.ts` | 貼り付け→作成→一覧に出る／UTF-8 ファイル（`setInputFiles` の buffer）→作成 | FR-2, FR-6 |
| 変更 | `docs/requirement/99-open-questions.md:18` | 「外部からのインポート」を解決済みにし COT-31 を参照 | — |
| 変更 | `docs/CODEMAP.md` | §1 索引に「テキストの取り込み」、§2 に `importer/`、§3 に `TextImportDialog/` | — |

## データモデル

変更なし。作る Work は次の形で、`store.importWorks` → `repo.saveWork` の `WorkSchema.parse`（`src/core/storage/workRepository.ts:55`）を通る。

```ts
{
  id: genId(),                 // crypto.randomUUID()（src/ui/store/createDefaultStore.ts:36 と同じ）
  title,                       // 作品タイトル（必須・空不可）
  author?,                     // プロフィールのペンネーム（editorStore.ts:277 と同じ既定。未設定ならキーを付けない）
  updatedAt: now(),
  episodes: [{ id: genId(), title, blocks: parseEpisodeBody(body) }, ...],
}
```

- `format` は付けない（小説）。`description`・`glossary`・`platform` も付けない。
- 同期・バックアップ・publish・MCP への波及：なし（通常の新規作品と同じレコード）。作成時に `workJsonBytes(work) > MAX_WORK_JSON_BYTES（20MB）` なら保存しない。同期は JSON 平文サイズで 25MB を判定し（`functions/api/sync/work.ts:116-117`）、クライアントに 413 の個別処理は無い（`src/ui/sync/sync-service.ts:400-402`）ので、作成時点で止めるしかない。

## ロジック・API（`src/core/importer/`）

```ts
// text.ts
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024       // 入力側：生テキスト合計（ファイル＋貼り付け）
export const MAX_WORK_JSON_BYTES = 20 * 1024 * 1024    // 作成時：JSON.stringify(work) の UTF-8 バイト数
export type TextEncodingName = 'utf-8' | 'shift_jis'
/** UTF-8（fatal）→ Shift_JIS の順で復号。復号結果に U+FFFD か、\t \n \r 以外の制御文字
 *  （U+0000–U+0008, U+000B, U+000C, U+000E–U+001F）が1つでもあれば失敗＝null。復号後は normalize 済み */
export function decodeTextFile(bytes: Uint8Array): { text: string; encoding: TextEncodingName } | null
export function looksLikeText(text: string): boolean   // 上の検査だけを切り出したもの（テスト用）
/** BOM 除去・\r\n と \r を \n に */
export function normalizeImportedText(text: string): string
/** new TextEncoder().encode(JSON.stringify(work)).byteLength */
export function workJsonBytes(work: Work): number

// split.ts
export type SplitMode = 'heading' | 'file' | 'none'
export interface ImportSource { name: string; text: string }   // name はファイル名（貼り付けは ''）
export interface SplitOptions { mode: SplitMode; separators: boolean; keepHeadingInBody: boolean }
export type SplitReason = 'heading' | 'separator' | 'file' | 'preamble' | 'whole'
export interface SplitEpisode { title: string; body: string; reason: SplitReason; sourceName: string; sourceLine: number }
export interface SplitResult { episodes: SplitEpisode[]; headingFound: boolean }
/** 手直しの安定キー。話の位置番号ではなく「元ファイル名＋開始行」なので、前後の話がつながっても他の手直しがずれない。
 *  ファイル名の一意性は UI 側で同名追加を拒否して保証する（`splitEpisodes` 自体は同名ソースを受けると衝突するので、テストで固定） */
export type EpisodeKey = string                                   // `${sourceName}\u0000${sourceLine}`
export function episodeKey(e: SplitEpisode): EpisodeKey
export interface SplitEdits { titles: Record<EpisodeKey, string>; mergedInto: EpisodeKey[] }  // mergedInto＝「前の話とつなげる」を押した話のキー
/** 分割結果に手直しを適用（タイトル上書き → つなげる、の順）。分け方の設定が変わったら UI 側で edits を空に戻す */
export function applyEdits(episodes: SplitEpisode[], edits: SplitEdits, options: SplitOptions): SplitEpisode[]
export function isHeadingLine(line: string): boolean
export function isSeparatorLine(line: string): boolean
export function splitEpisodes(sources: ImportSource[], options: SplitOptions, workTitle: string): SplitResult
export function sortSourcesNatural(sources: ImportSource[]): ImportSource[]  // localeCompare('ja', {numeric: true})

// build.ts
export interface ImportedWorkInput { title: string; author?: string; episodes: { title: string; body: string }[] }
export function buildImportedWork(input: ImportedWorkInput, genId: () => string, now: () => number): Work
```

- 見出し判定は requirements FR-3 の規則 1〜5。`trim()` 後 40 文字以内のみ対象。正規表現は `split.ts` に定数で置き、テストで各規則を1ケースずつ固定する。
- 区切り判定：全角・半角空白を除いた残りが `/^[-=ー―─━＊*※#＃]{3,}$/`。
- 「分けない」モードは全ソースを `\n\n` で連結して1話（タイトルは `workTitle`）。
- 貼り付けは `sources = [{ name: '', text }]`。`name` 空のとき前文タイトルは「序」、見出しなしは「第1話」。
- `buildImportedWork` はタイトル空を「第N話」に補い、本文は末尾の空行を落としてから `parseEpisodeBody`。
- UI 側の読み込み：`file.arrayBuffer()` → `new Uint8Array` → `decodeTextFile`。拡張子は `.txt` だけ（`accept=".txt"`）。選択・ドロップのどちらも同じ `isTxtFile(name)` で拡張子を判定して弾く（OS が text/plain と見なす `.md` `.log` が選択経路だけ通るのを防ぐ）。同名ファイルは「同じ名前のファイルはすでにあります」で追加しない（`episodeKey` の一意性のため）。生テキスト合計（ファイル＋貼り付け）は追加・入力のたびに `MAX_IMPORT_BYTES` で判定。
- 作成：`buildImportedWork` → `workJsonBytes` が `MAX_WORK_JSON_BYTES` 超なら保存せずフッターに「本文が大きすぎます。ファイルを分けて取り込んでください」。
- store：新規 action なし。`store.importWorks([work])`（`src/ui/store/editorStore.ts:520-523`）→ `store.openWork(work.id)`（`:298-310`）→ `onEnterEditor()`（Library の `handleWrite` と同じ `library.tsx:252-255`）。

## UI

### 画面: 作品一覧（ルート `#/`）— データ管理メニュー
- 現状: `screens/data-menu-desktop.png`（メニューを開いた状態）、`screens/library-desktop.png` / `screens/library-empty-mobile.png`
- 変更点: ① 「バックアップを取り込み」の直後に `DataMenuItem`「テキストから作品を作る」（アイコン `FileText`。既存項目と同じラベルのみ・説明なし・幅 230px のまま・背景の強調なし）
- 状態: ゲスト／無料／有料で同じ。作品 0 件でも出す
- モバイル: メニューは同じ（Library は幅で出し分けしない）
- 使う共通部品: `DataMenuItem`（`library.tsx:108-139`。このメニューは Radix ではなく自前の `role="menu"`）

### 画面: テキストから作品を作る（新規ダイアログ）
- 現状の近い画面: `screens/import-dialog-desktop.png` / `screens/import-dialog-mobile.png`（既存の JSON 取り込み。見出しのフォント・フッターの並びを踏襲）、ラジオの見た目は `screens/new-work-dialog-desktop.png`（新しいプロジェクトの小説／脚本）、幅は `ExportDialog`（`export-dialog.tsx:326` `md:max-w-3xl lg:max-w-5xl gap-0 overflow-hidden p-0`）と同じ2ペイン
- 変更点（番号はプロトタイプと対応）:
  - ② ヘッダ：タイトル「テキストから作品を作る」、説明「.txt や貼り付けた本文を、見出しの行で話に分けます」
  - ③ 左ペイン上段：入力元の切り替え「ファイル｜貼り付け」（`aria-pressed` のトグル。タブにしない流儀は `src/ui/components/BoardPage/thread-list.tsx:229` に従う）
  - ④ ファイル側：破線のドロップ領域（`admin-templates-page.tsx:342-358` と同じ見た目）＋「ファイルを選択」ボタン＋ファイル一覧（名前・字数・文字コード Badge・「外す」）。貼り付け側：`Textarea`（高さ 12 行・`aria-label="本文"`）
  - ⑤ 分け方：ラジオ3つ「見出し行で分ける（既定）／ファイルごとに1話／分けない」。「ファイルごとに1話」は貼り付け時に disabled。下に `Switch`「罫線だけの行（--- や ＊＊＊）でも分ける」「見出し行を本文にも残す」
  - ⑥ 作品の情報：`Input`「作品タイトル」（必須・既定値は FR-6）、`Input`「著者」（既定はペンネーム）
  - ⑦ 右ペイン：見出し行「N 話に分かれます」＋「合計 M 字」（`aria-live="polite"` はこの行だけ。話一覧には付けない）。話ごとのカード：番号・タイトル `Input`（`aria-label="N話目のタイトル"`）・冒頭2行（`text-muted-foreground`・2行で省略）・分けた理由の `Badge`（見出し／区切り／ファイル／見出しの前）・元ファイル名（ファイル入力のときだけ）・字数・「前の話とつなげる」（2話目以降・`Button variant="ghost" size="sm"`）
  - ⑧ 右ペインの案内：見出しが見つからなかったとき「見出しが見つからなかったので、1話にまとめました」の一文（`Alert` 相当の淡い枠。既存 `import-dialog.tsx:162` の空メッセージと同じトーン）
  - ⑨ フッター：左にエラー文言の領域、右に「キャンセル」「作品を作る」（`disabled` = 話 0 件 or タイトル空 or 作成中）
  - ⑩ 完了相：本文を「N 話で「タイトル」を作りました」に置き換え、フッターは「閉じる」「執筆を始める」（primary）
- 状態:
  - 空：右ペイン「テキストを読み込むと、ここに話の分かれ方が出ます」
  - 読み込み中：ファイル一覧の該当行に「読み込み中…」。ドロップ領域は操作可
  - エラー：ファイル単位のエラーは該当行に赤字（`text-destructive`）、全体のエラー（容量超過・拡張子・作成時の JSON サイズ超過）はフッター左。文言は requirements FR-1
  - 作成中：「作品を作る」を disabled にし文言「作成中…」
  - オフライン／ゲスト／無料会員：差なし
- モバイル（`useIsNarrow()`・lg 未満）: 2ペインを2ステップにする。ステップ1＝左ペインの内容、フッター「キャンセル」「次へ」（`disabled` = 読み込んだテキストが 0 件、または貼り付けが空白のみ）。ステップ2＝右ペイン＋作品の情報（⑥はステップ2に移す）、フッター「戻る」「作品を作る」（⑨と同じ条件）。ダイアログの高さは `DialogContent` の既定 `max-h`（`ui/dialog.tsx:65`）のままにし、`DialogBody` の中をスクロールする
- 使う共通部品: `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogBody`/`DialogFooter`（`src/ui/components/ui/dialog.tsx`）、`Button`、`Input`、`Textarea`、`Label`、`Switch`、`Badge`、`ScrollArea`。ラジオは `ui/` に無いので `TitlePromptDialog` の小説／脚本ラジオ（`library.tsx:573-601`・`screens/new-work-dialog-desktop.png`）と同じ素の `<input type="radio">` を使う。トーストは使わない（既存 ImportDialog と同じく結果はダイアログ内に出す）
- 文言（toc-copy の型に従う。ボタンは動詞で言い切る・エラーは事実＋次の一歩）:
  - メニュー項目「テキストから作品を作る」／ダイアログ見出し同じ
  - 「ファイルを選択」「ここにファイルをドロップ」「外す」「前の話とつなげる」「作品を作る」「執筆を始める」「閉じる」「キャンセル」「次へ」「戻る」
  - 完了「N 話で「タイトル」を作りました」
  - 案内「見出しが見つからなかったので、1話にまとめました」「テキストを読み込むと、ここに話の分かれ方が出ます」
  - エラー「「ファイル名」は読み込めませんでした。UTF-8 か Shift_JIS のテキストファイルを選んでください」「合計 20MB までのテキストを取り込めます」「.txt のテキストファイルを選んでください」「本文が大きすぎます。ファイルを分けて取り込んでください」「同じ名前のファイルはすでにあります」

## テスト計画

| 層 | 何を固定するか | 置き場所 |
|---|---|---|
| unit | `normalizeImportedText`：BOM・CRLF・CR。`decodeTextFile`：UTF-8／Shift_JIS バイト列（`[0x82,0xa0,...]` の固定配列）／PNG ヘッダ 16 バイトで null／NUL を含む UTF-8 で null。`workJsonBytes` が `TextEncoder` の長さと一致 | `src/core/importer/text.test.ts` |
| unit | `isHeadingLine` 規則1〜5の正例・負例（行途中の「第1話」・41文字超）。`isSeparatorLine`。`splitEpisodes`：FR-3 の受け入れ条件（前文・見出しなし・複数ファイル・`file`/`none` モード・`keepHeadingInBody`・区切りオン/オフ）。`applyEdits`：2話目をつなげた後も3話目のタイトル手直しが残る・つなげた話の本文が前の末尾に付く。`episodeKey` が同名ソースで衝突する（UI 側で防ぐ前提を明示する）。`sortSourcesNatural`（`2.txt` < `10.txt`） | `src/core/importer/split.test.ts` |
| unit | `buildImportedWork`：`WorkSchema.parse` が通る・id がすべて異なる・空タイトル→「第N話」・ルビ／傍点／字下げが `blocksToNotation` で往復する・末尾空行を落とす | `src/core/importer/build.test.ts` |
| integration | 貼り付け→プレビューに「2 話に分かれます」→タイトル編集→「作品を作る」で `onCreate` に `Work` が渡る→完了相→「執筆を始める」で `onWrite(id)`。空入力で作成ボタン disabled。「ファイルごとに1話」が貼り付け時に disabled。`.md` の選択と同名ファイルの追加が弾かれて文言が出る。`MAX_WORK_JSON_BYTES` を超える Work（モックで小さい値に差し替え）で保存されずエラー文言が出る | `src/ui/components/TextImportDialog/text-import-dialog.test.tsx` |
| integration | Library のデータ管理メニューに項目が出てダイアログが開く | `src/ui/components/Library/library.test.tsx`（既存があれば追記） |
| e2e | 貼り付け→作成→一覧に新しい作品カード→執筆画面で本文が見える。`setInputFiles({name:'a.txt', mimeType:'text/plain', buffer})` で UTF-8 ファイル2つ→自然順→作成 | `e2e/text-import.spec.ts` |

## リスク・未決事項

- Node のテスト環境で `TextDecoder('shift_jis')` が使えるのは full-ICU ビルドのみ。公式バイナリは full-ICU 既定だが、CI で `RangeError` が出たら `text.test.ts` の Shift_JIS ケースだけ環境判定で skip し、ブラウザ側の e2e で担保する。
- 見出し規則の誤検出（例：本文中の「1. 」で始まる箇条書き）。プレビューと「前の話とつなげる」で利用者が直せる設計にしてある。規則の追加・緩和はテストケースを増やして対応する。
- 大きな本文（10MB 超）でのプレビュー再計算。分割は行の正規表現だけで `parseEpisodeBody` は作成時に1回なので、1秒以内に収まる見込み。超えるなら `useDeferredValue` を足す。
- 既存作品への追加取り込みの要望が出た場合は、`splitEpisodes` と `PreviewPane` をそのまま使い、保存先の選択を足す別 issue にする。

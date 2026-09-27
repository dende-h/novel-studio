# 設計 — COT-6 脚本モード機能の追加

プロトタイプ: https://claude.ai/artifact/VwhcDYmaEEiJ5KZsobEnCc

## 方針
- 本文の正本は今までどおり「記法テキスト → `parseEpisodeBody` → `Block[]`（paragraph のみ）」（`src/core/parser/parseNotation.ts:34`）。**Block に種類を持たせない**。柱・ト書き・セリフは描画・書き出しの直前に行頭の書き方から判別する。
- 判別は `src/core/script/` に純関数として置き、プレビュー・EPUB・テキスト書き出しがそこを共有する。演出譜の `classifyBlock`（`src/core/game/index.ts:222`）とは別物にする（初回は連携しないと決めたため。純テキスト化は同じ `plainTextOfBlock` を使う）。
- 作品の形式は `Work.format?: 'novel' | 'script'`。未設定＝小説。
- 捨てた案：Block に `kind` を保存する（parse・export・MCP・grove 契約すべてに手が入り、MCP のプレーンテキスト入力と二重表現になる）。話ごとの形式（切替 UI と公開側の扱いが複雑）。

## 変更ファイル
| 種別 | パス | 責務 / 変更内容 | 要件ID |
|---|---|---|---|
| 変更 | `src/core/schema/index.ts:191-209` | `WorkFormatSchema = z.enum(['novel','script'])`・`Work.format: WorkFormatSchema.optional()` を `platform` の後に追加。`export type WorkFormat` | FR-1 |
| 新規 | `src/core/script/index.ts` | `classifyScriptBlock(block): ScriptLine`・`splitSpeaker(inlines)`・`SLUG_PREFIX = /^[○〇]/`・`SPEAKER_RE`。React 非依存 | FR-2 |
| 新規 | `src/core/script/index.test.ts` | FR-2 の受け入れ条件を全部固定 | FR-2 |
| 変更 | `src/core/exporter/toHtml.ts:36-48` | `blocksToHtml(blocks, resolvedNames?, opts?: { script?: boolean })`。`opts.script` のとき `blockToHtml` が `classifyScriptBlock` でクラスを付け、ト書きの行頭空白を落とし、セリフの話者を `<span class="sc-speaker">` で包む。`p.blank` は script でも inlines 空のときだけ（現状 :45-46 のまま）。空白だけの行は classify が `blank` を返すのでクラスを付けず `<p>　</p>` のまま。省略時は現状と同一出力 | FR-3, FR-5 |
| 変更 | `src/core/exporter/toEpub.ts:25-40, 151-172` | `episodeToXhtml(ep, opts)` が `work.format` を受けて `blocksToHtml(..., {script})`。`buildStyleCss` に `.sc-*` ルール（論理プロパティ） | FR-5 |
| 変更 | `src/core/exporter/toPlainText.ts:41-51` | `blocksToPlainText` は**変えない**（利用者向けの出口が無い：`workToPlainText` と `beat-ui.ts` だけが使う）。`workToPlainText` は **正規化しない**まま、`format==='script'` なら `形式: 脚本` と判別ルール 1 行をメタに足す | FR-5, FR-9 |
| 変更 | `src/core/exporter/toNarou.ts:10` `toKakuyomu.ts:10` | 同じ `opts.script` を受けてト書きを正規化 | FR-5 |
| 変更 | `src/ui/_utils/exporters.ts` | `episodeNarouExport` / `episodeKakuyomuExport` / `workEpubExport` に `work.format` を通す。`workAiTextExport` と `workFolderZipExport` は通さない（後者はロスレス往復・`src/core/folder/index.ts:5-9`） | FR-5 |
| 変更 | `src/ui/App.tsx:104-110, 238-241, 597-612` | `NOTATION_BUTTONS` に `slug`（柱）と `dialogue`（セリフ）を足し、`work?.format === 'script'` のときだけ描く。`previewHtml` に `{ script }` を渡す | FR-3, FR-4 |
| 変更 | `src/ui/components/EditorPane/editor-pane.tsx:21, 38-44, 182-212, 344-346` | `NotationKind` に `'slug' \| 'dialogue'` を追加。`EditorPaneProps.scriptMode?: boolean` を追加し、`NotationBar` に渡す items を切り替える（`NotationBar` は EditorPane 内部で描かれる :344-346）。`applyNotation` に 2 分岐（柱＝行頭へ `○`、セリフ＝`「」` でキャレットは内側）。`SHORTCUTS` は変えない | FR-4 |
| 変更 | `src/ui/components/EditorPane/notation-bar.tsx:8-13, 23` | `items` を props で受ける（既定は現状の 3 つ）。`scriptMode` のとき EditorPane が 5 つ渡す | FR-4 |
| 変更 | `src/ui/components/WorkMetaDialog/work-meta-dialog.tsx:19-25, 103-140` | `WorkMetaValues.format: WorkFormat`。「形式」の 2 択（`<fieldset>`＋`<input type="radio">`×2）をあらすじの下・表紙の上に追加。ラベル横に `FieldHelp`（`src/ui/components/FieldHelp/field-help.tsx:23`）で判別ルールを説明 | FR-8 |
| 変更 | `src/ui/store/editorStore.ts:135-145, 504-514` | `WorkMeta.format?: WorkFormat`。`updateWorkMeta` で `format === 'novel'` は `delete work.format`（`coverImage: ''` と同じ明示削除の扱い） | FR-1 |
| 変更 | `src/core/storage/workRepository.ts:19-32, 68-78` | `WorkSummary.format?: WorkFormat` を派生 | FR-8 |
| 変更 | `src/ui/components/Library/project-card.tsx:95-108` `project-row.tsx:52-57` | `format === 'script'` のとき「脚本」`Badge`（`variant="secondary"` に `bg-secondary-container font-sans text-on-secondary-container`＝wheat。「N話」の緑と区別）。「N話」の隣 | FR-8 |
| 変更 | `src/ui/components/Library/library.tsx:610-625` `src/ui/App.tsx:852-862` | `WorkMetaDialog` の呼び出し 2 箇所で `initial.format` と `onSubmit` の `format` を通す。`PublishPage/publish-route.tsx:42-46` は `updateWorkMeta` の部分パッチなので据え置き | FR-8 |
| 変更 | `src/ui/components/HelpPage/help-page.tsx:9` | `Section` を 1 つ追加「脚本を書く」 | FR-8 |
| 変更 | `src/ui/index.css:274-346` | `.preview .sc-slug / .sc-direction / .sc-dialogue / .sc-speaker` | FR-3 |
| 変更 | `src/ui/_api/publish.ts:33-37, 139-144, 262-280, 335-343, 376-385` | `SCHEMA_VERSION_WITH_FORMAT = 7`。`BundleWork = Omit<Work, 'episodes' \| 'platform' \| 'format'> & { …; format?: 'script' }`（`Work.format` は Omit で外し `'script'` だけに狭める）。`toBundleWork` で `format` を **明示的に**扱う（`rest` に紛れて送らない：小説は落とす・脚本は載せる）。`schemaVersion` は `format === 'script'` なら 7 を最優先。`unsupported-schema-version` の案内（:376-385）に「`bundleWork.format` があり `supported < 7`」の分岐を**先頭に**足し、脚本向けの文言を返す | FR-6 |
| 変更 | `src/core/mcp-edit/index.ts:78-91` | `setWorkMeta` の patch に `format?: WorkFormat`。`'novel'` はキー削除 | FR-9 |
| 変更 | `functions/api/_lib/mcp-server.ts:113-176, 722-730, 800-813` | `set_work_meta` に `format` を追加。`listWorksText`（:722-730）と `get_work` の出力に `形式: 脚本` 行。`set_episode` の説明文を更新（要求外の小修正として「行頭＊でシーン区切り」を併せて削除） | FR-9 |
| 変更 | `docs/requirement/02-notation-and-format.md` | 「脚本形式」の節を追加（判別ルール・体裁・書き出しの正規化）。廃止済みの `＊` 行の記述も要求外の小修正として併せて直す | — |
| 変更 | `docs/CODEMAP.md` §1・§2 | `src/core/script/` の行を追加 | — |
| 変更 | `e2e/smoke.spec.ts` | 脚本の作品で柱・セリフがプレビューに体裁付きで出る回帰 1 本 | FR-3 |

## データモデル
```ts
// src/core/schema/index.ts
export const WorkFormatSchema = z.enum(['novel', 'script'])
export type WorkFormat = z.infer<typeof WorkFormatSchema>
// WorkSchema に追加（platform の後）
// 作品の形式。未設定＝小説。'novel' は保存しない（未設定に正規化）。旧データ互換のため任意。
format: WorkFormatSchema.optional(),
```
- 旧レコード：`format` 無し → `parse` を通り小説として扱う。マイグレーション無し。
- クラウドバックアップ・同期スナップショット：Work を JSON 丸ごと運ぶ（`src/ui/sync/sync-service.ts:431` は `WorkSchema.parse`）ので `format` はそのまま往復する。
- **旧クライアントの同期（U-1）**：`z.object` は unknown key を strip するため、`format` を知らない版のクライアントが同じ作品を編集して push すると `format` が落ちる。これは `coverImage`・`platform` を足したときと同じ性質の既知リスクで、PWA の更新で解消する。設計上の対処は「`format` が消えても本文は壊れない（小説として描かれるだけ）」に留め、`passthrough` 化はしない（他の欄の検証を弱めるため）。
- publish バンドル（契約 v7）：`work.format: 'script'` を載せる。小説は載せない。grove 側は v7 を受けたら `format` で体裁を切り替える（別リポ）。
- MCP：`set_work_meta.format`。`get_work` は `形式: 脚本` 行を出す。本文は生のまま。

### 判別ロジック（`src/core/script/index.ts`）
```ts
export type ScriptLineKind = 'blank' | 'slug' | 'dialogue' | 'direction'
export interface ScriptLine { kind: ScriptLineKind; speaker?: string }
const SLUG_RE = /^[○〇]/
// 名前 1〜20 文字（空白・括弧・鉤括弧を含まない）＋任意で（補足 1〜10 文字）を 1 つ＋任意の空白＋「 or 『
const SPEAKER_RE = /^([^\s「」『』（）()]{1,20}(?:（[^（）]{1,10}）)?)[ 　]*[「『]/
export function classifyScriptBlock(block: Block): ScriptLine {
  const raw = plainTextOfBlock(block)
  const lead = raw.replace(/^\s+/, '')
  if (lead === '') return { kind: 'blank' }
  if (SLUG_RE.test(lead)) return { kind: 'slug' }
  // 字下げした行はト書き固定（脚本ではセリフを行頭から書く）。途中の「」で話者に化けさせない
  if (raw !== lead) return { kind: 'direction' }
  if (lead.startsWith('「') || lead.startsWith('『')) return { kind: 'dialogue' }
  const m = SPEAKER_RE.exec(lead)
  if (m) return { kind: 'dialogue', speaker: m[1] }
  return { kind: 'direction' }
}
// 話者を inline 列から切り出す（HTML で <span class="sc-speaker"> に包むため）。
// classifyScriptBlock と同じ純テキスト上で SPEAKER_RE の match 長（m[1].length）を取り、
// inline 列の先頭からその文字数ぶんを話者側へ移す。各 inline は plainTextOfInline の長さで数え
// （ref は children があれば children の純テキスト・無ければ name、ruby は base）、
// 切れ目が ref / ruby の内部に落ちるときはその inline 全体を話者側に含める
// （[[ユイ]]（声）「…」→ ref＋text「（声）」／｜結衣《ゆい》「…」→ ruby 全体）。
// text inline は文字位置で 2 つに割る。dialogue でなければ null。
export function splitSpeaker(inlines: Inline[]): { speaker: Inline[]; rest: Inline[] } | null
// ト書きの行頭空白を落とす（描画・書き出しの二重字下げ防止）。先頭の text inline の
// 先頭空白（/^\s+/）だけを削る。空白だけの行は classify が blank を返すのでここへ来ない
export function stripLeadingSpace(inlines: Inline[]): Inline[]
```
`plainTextOfBlock` は `src/core/game/index.ts:212` から import する（`core` 内なので依存 OK）。

## UI
### 画面: 執筆（ルート `#/write`）— エディタ
- 現状: `screens/write-desktop.png` `screens/write-mobile.png`
- 変更点: ① PC ツールバーの記法ボタン（ルビ／傍点／参照）の右に「柱」「セリフ」（脚本の作品のみ）。② スマホの記法バーも同じ 5 つ（`overflow-x-auto` で横スクロール）。
- 状態: 小説の作品＝変化なし／脚本の作品＝ボタン追加。ゲスト・無料会員の差なし（執筆は無料機能）。
- モバイル: 記法バーは textarea フォーカス時のみ。5 つ目までスクロールで届く。
- 使う共通部品: 既存のボタン markup をそのまま流用（`App.tsx:600-611`・`notation-bar.tsx:32-46`）。
- 文言: 「柱」（title: `柱 ○場所（時間）`）「セリフ」（title: `セリフ 名前「…」`）

### 画面: 執筆 — プレビュー
- 現状: `screens/write-desktop.png`（右ペインがプレビュー）`screens/preview-mobile.png`（脚本の例文を小説として描いた状態＝全部ただの段落）
- 変更点: ③ 柱＝太字・前に 1 行ぶんの間隔。④ ト書き＝3 字下げ。⑤ セリフ＝ぶら下げ（2 行目以降 3 字下げ）。話者は通常の太さ。話者の `<span class="sc-speaker">` は補足 `（声）` まで含む。
- 状態: 縦書き／横書きの両方（論理プロパティ）。小説の作品は変化なし。
- CSS（`src/ui/index.css`）：
  ```css
  .preview .sc-slug { font-weight: 600; margin-block-start: 1lh; }
  .preview .sc-slug:first-child { margin-block-start: 0; }
  .preview .sc-direction { padding-inline-start: 3em; }
  .preview .sc-dialogue { padding-inline-start: 3em; text-indent: -3em; }
  ```
  EPUB の `style.css` にも同じ 4 行（`1lh` 非対応リーダー向けに `margin-block-start: 1.8em` で代替）。

### 画面: 作品情報ダイアログ
- 現状: `screens/workmeta-desktop.png` `screens/workmeta-mobile.png`
- 変更点: ⑥ 「あらすじ」の下に「形式」欄。ラベル横にⓘ（`FieldHelp`）。選択肢は「小説」「脚本」の 2 つのラジオ（横並び）。
- 状態: 初期値＝現在の形式（未設定＝小説）。形式だけ変えて保存しても他の欄は据え置き。
- 使う共通部品: `Label`・`FieldHelp`。ラジオは shadcn の `RadioGroup` が無いので素の `<input type="radio">`（`ui/` には手を入れない規約）。
- 文言: ラベル「形式」。選択肢「小説」「脚本」。ⓘの本文：
  > 脚本にすると、行頭の書き方で柱・ト書き・セリフを見分けて表示します。
  > ・○で始まる行 → 柱（場所と時間）
  > ・行頭に名前、そのあとに「」が続く行 → セリフ
  > ・それ以外の行（行頭を空けた行を含む） → ト書き（自動で 3 字下がります）
  > 本文の文字はそのままです。EPUB・なろう・カクヨムへの書き出しと、コトノハ-grove- の表示も脚本の体裁になります。
- ダイアログの説明文を「作品の情報を編集します。EPUB やコトノハ-grove- に反映されます。」に改める（現状の EPUB 限定の文言では「形式」の効き先が伝わらない）。

### 画面: ライブラリ（ルート `/`）
- 現状: `screens/library-desktop.png` `screens/library-mobile.png`
- 変更点: ⑦ カードの「N話」バッジの右に「脚本」バッジ（脚本の作品のみ）。リスト表示の行も同様。
- 使う共通部品: `Badge`（`variant="secondary"` に `bg-secondary-container font-sans text-on-secondary-container`）。色は wheat。「N話」（primary-container・緑）「公開中」（accent）と並んでも区別がつく。

### 画面: ヘルプ（`#/help`）
- 現状: `screens/help-desktop.png`
- 変更点: ⑧ 節「脚本を書く」を追加（判別ルール 3 行・ボタン・書き出し）。
- 文言は toc-copy の作法（です・ます、短く）。

## ロジック・API
- `blocksToHtml(blocks, resolvedNames?, opts?)`：第 3 引数追加。既存呼び出し（`App.tsx:239`・`toEpub.ts:36`）は互換。
- `blocksToPlainText / blocksToNarou / blocksToKakuyomu (blocks, opts?)`：同様。
- `toBundleWork`：`const { platform: _local, episodes: _episodes, glossary, format, ...rest } = work` として `rest` に紛れ込まないよう **分割代入で取り出し**、`format === 'script'` のときだけ `base.format = 'script'`。
- `schemaVersion`：`bundleWork.format ? 7 : (現状の分岐)`。
- 409 案内（`publish.ts:376-385`）：`bundleWork.format && supported < SCHEMA_VERSION_WITH_FORMAT` を先頭に置き、「公開先がまだ脚本の体裁に対応していません。作品情報で形式を小説にしてから、もう一度お試しください。」を返す。既存 2 分岐はその後ろに据え置き。
- MCP `set_work_meta`：`format: { type: 'string', enum: ['novel','script'] }`。
- `updateWorkMeta`：`if (format === 'novel') delete work.format; else if (format) work.format = format`。
- 演出譜の `classifyBlock` は触らない（対象外）。

## テスト計画
| 層 | 何を固定するか | 置き場所 |
|---|---|---|
| unit | FR-2 の判別表（柱／話者付きセリフ／補足付き話者／話者なしセリフ／字下げト書き（途中に「」）／字下げ鉤括弧／空／21 文字名／空白入り名／補足 2 つ／空白だけ／`[[ref]]「`）・`splitSpeaker`（text 分割／`[[ユイ]]（声）「`／`｜結衣《ゆい》「`／非 dialogue で null） | `src/core/script/index.test.ts` |
| unit | `blocksToHtml(blocks)` と `blocksToHtml(blocks, undefined, {script:false})` の**文字列一致**（既存テストの入力を流用）。FR-2 の例文を小説形式で通して出力に `sc-` を含まない。script:true でト書き行頭空白の除去・話者 span・クラス付け | `src/core/exporter/toHtml.test.ts` |
| unit | EPUB の `style.css` に `.sc-*`、XHTML にクラス。小説は不変 | `src/core/exporter/toEpub.test.ts` |
| unit | なろう／カクヨムで ト書き `　x` → `　　　x`、`x` → `　　　x`、`　　　　x` → `　　　x`。柱・セリフは不変。`workToPlainText` は正規化しないが `形式: 脚本` 行が出る | `src/core/exporter/*.test.ts` |
| unit | `WorkSchema.parse` が `format` 無し・`'script'` の両方を通し、不正値を弾く | `src/core/schema/index.test.ts` |
| unit | `setWorkMeta({format:'script'})` と `{format:'novel'}` でキー削除・他欄据え置き | `src/core/mcp-edit/index.test.ts` |
| unit | `toBundleWork`：小説で `format` 無し／脚本で `format:'script'` と v7。`unsupported-schema-version`（supported 6）＋脚本で脚本向け案内文が返る | `src/ui/_api/publish.test.ts` |
| integration | `WorkMetaDialog` の形式ラジオ初期値と submit 値 | `src/ui/components/WorkMetaDialog/work-meta-dialog.test.tsx` |
| integration | `updateWorkMeta` で `'novel'` 保存時にキーが消える | `src/ui/store/editorStore.test.ts` |
| integration | `applyNotation('slug' / 'dialogue')` のキャレット位置 | `src/ui/components/EditorPane/editor-pane.test.tsx` |
| integration | ライブラリの「脚本」バッジの有無 | `src/ui/components/Library/library.test.tsx` |
| e2e | 作品を脚本にして例文を打つ → プレビューに `.sc-slug` `.sc-dialogue` が出る | `e2e/smoke.spec.ts` |

## リスク・未決事項
- U-1（旧クライアント同期で `format` が落ちる）：既知の性質として受容。リリースノートに書く。
- U-2（grove の v7）：novel-platform に issue を切り、**grove を先にリリース**。leaf の v7 送信はその後に main へ。
- 演出譜：脚本の作品をサウンドノベルにすると話者付きセリフが地の文扱い（対象外・後続 issue）。
- `1lh` は古い EPUB リーダーで効かないため EPUB 側は em 指定にする。

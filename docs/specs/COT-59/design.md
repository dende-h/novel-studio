# 設計 — COT-59 本文の固有名詞を拾って用語集への登録を勧め、解析辞書に今の言葉を足す

プロトタイプ: https://claude.ai/artifact/P1qK7rsF1ADv6eL21sLh1d （非公開）／ローカル `docs/specs/COT-59/prototype.html`

## 方針

- 名前の候補は、推敲画面の Worker が持っている作品全体のトークンから、core の純関数で作る（`analyzer-engine.ts:112` の `analyze` に1つ足す）。ルビと `[[ ]]` は話の記法（`Inline` の `ruby`／`ref`）から取り出して Worker へ渡す。
- 候補の絞り込みには二つの段階がある：
  - Worker：回数の線と、用語集の語（`excluded`）を外す
  - 画面：「外した語」と、いまの用語集の名前・別名を外す。登録や外す操作がすぐ一覧に効き、解析し直しを待たない
- 用語集が変わると、解析器の Worker は作り直される（`use-morph-analyzer.ts:28-31` → `analyzer-client.ts:73-83` で状態が準備中に戻り、`analyzer-engine.ts:89` でトークンのキャッシュも消える）。その間も、画面は前回の `analysis.names` をいまの用語集と外した語で絞って出し続ける。準備中の表示は、前回の結果が一度も無いときだけにする（続けて登録しても一覧が消えない）
- 外した語は、作品ごとに1件の新しい kv レコード `proofread-names:<workId>` に置く。推敲の判断（`proofread:`）と同じ相乗りの方式で同期・バックアップする。
- 辞書は、SudachiDict の普通名詞を足して作り直した IPADIC の zip（ファイル名 `lindera-ipadic-6.2.0-sudachi20260723.zip`）を、このリポジトリの GitHub Release に置く。`fetch-dict.mjs` がハッシュを固定して取る。作るスクリプトはリポジトリに置く（U2・2026-10-18 ユーザー決定）。ファイル名を変えるので、配信 URL が変わり、端末の古い辞書のキャッシュは既存の処理（`analyzer.worker.ts:66-69`）が消す。

### 捨てた代替案

- 外した語を `Work` の欄にする案：旧版のクライアントは `WorkSchema.parse` で未知の欄を落とす。作品を保存し直すたびに、外した記録が消える。
- 外した語を推敲の判断のレコード（話ごと）に入れる案：作品単位の記録なのに、話の削除や話ごとの同期に巻き込まれる。
- 接頭辞を `proofread:names:` にする案：
  - `ProofreadRepository` の `keys('proofread:')`（`proofreadRepository.ts:66,77,88`）に拾われる
  - 復元の `replaceAll` で消える
- 辞書を CI で毎回作る案：
  - キャッシュが外れるたびに、元データ約 50MB と lindera の CLI を取ることになる
  - CI の手順と失敗の種類が増える
- 足す語を実行時のユーザー辞書で読み込む案：
  - 起動のたびに7万行の CSV を読む（約 200ms・メモリ +40MB）
  - 用語集のユーザー辞書と同じ口を分け合うことになる

## 変更ファイル

| 種別 | パス | 責務 / 変更内容 | 要件ID |
|---|---|---|---|
| 新規 | `scripts/build-dict.mjs` | 手で回す。固定した元データを取ってハッシュを照合し、足す語を選び、`lindera build` で作り直して zip とハッシュを出す。元データは IPADIC のソース（`https://Lindera.dev/mecab-ipadic-2.7.0-20250920.tar.gz`・md5 `a95c409f12f1023fce8ef91f991ef042`）・SudachiDict 20260723 の small/core（`sudachidict-raw/v0/20260723/`）・lindera CLI 6.2.0（GitHub Release の linux x86_64）。zip には IPADIC の NOTICE と、新しい `NOTICE-sudachidict.txt`（SudachiDict の LICENSE・LEGAL の全文と「普通名詞を抜き出し、IPADIC の形式に変えて足した」旨）を入れる。zip が 13MB を超えたら失敗で止まる | FR-1 |
| 新規 | `src/core/proofread/morph/dict-supplement.ts` | 足す語の選び方を純関数にする。`selectSupplement(rows, splitOf)` が CSV 行を返す。import を持たない（`build-dict.mjs` が Node の型除去でそのまま読む） | FR-1 |
| 変更 | `scripts/fetch-dict.mjs:15-18` | 取得元を GitHub Release の新しい zip（`lindera-ipadic-6.2.0-sudachi20260723.zip`）に替える。NOTICE は IPADIC と SudachiDict の2つを取り出す。`public/dict/` の別名の zip を消す（手元のビルドに旧辞書を混ぜない） | FR-1 |
| 変更 | `src/ui/proofread/protocol.ts:33-35` | `DICT_URL`・`DICT_BYTES` を新しい zip に合わせる | FR-1 |
| 変更 | `scripts/gen-morph-fixtures.mjs:20,83-88` | 辞書ファイル名を引数で受ける（既定は新しい名前）。`--names` を付けると名前の試し文だけを `names.json` に書き、`samples.json` は書かない | FR-1, FR-2 |
| 変更 | `src/ui/proofread/analyzer.node.test.ts:14` | 辞書ファイル名を新しい名前にする | FR-1 |
| 変更しない | `src/core/proofread/morph/__fixtures__/samples.json` | 今の辞書の出力のまま残す。node テストで「新しい辞書の表層形の区切りが samples.json と一致する」と比べる基準にする | FR-1 |
| 新規 | `src/core/proofread/morph/__fixtures__/names.json` | 名前の候補のテスト用に、試し文を新しい辞書の lindera で解析した結果 | FR-2 |
| 新規 | `src/core/proofread/morph/__fixtures__/fictional-names.json` | 架空の名前61個（付録 A）。FR-1 の「1語のまま残る数」の基準 | FR-1 |
| 変更 | `src/ui/components/HelpPage/help-page.tsx:68-70` | SudachiDict と UniDic のライセンス表記（`/dict/NOTICE-sudachidict.txt`）へのリンクを足す | FR-1 |
| 変更 | `docs/requirement/03-architecture.md:38-40` | 辞書の版と作り方（GitHub Release・`build-dict.mjs`）を書き直す | FR-1 |
| 変更 | `src/core/proofread/morph/token.ts:8-50` | `MorphToken` に `pos2`（細分類2：人名・地域・組織）を足す。未知語の判定 `isUnknownToken`（原形が `*`）を足す | FR-2 |
| 新規 | `src/core/proofread/morph/name-candidates.ts` | `findNameCandidates`（候補づくり）と `inlineSignalsOf`（話の記法からルビと `[[ ]]` を取り出す） | FR-2 |
| 変更 | `src/core/proofread/index.ts:13-18` | 上の2つと型を export する | FR-2 |
| 変更 | `src/ui/proofread/protocol.ts:6-22` | `AnalyzeEpisode` に `rubies?`・`refs?`、`AnalysisResult` に `names` を足す | FR-2 |
| 変更 | `src/ui/proofread/analyzer-engine.ts:112-135` | `analyze` の戻り値に `names: findNameCandidates(...)` を足す（トークンはキャッシュを使い、候補は毎回作る） | FR-2 |
| 新規 | `src/core/proofread/name-dismissals.ts` | `NameDismissalsSchema` と純関数 `dismissName`・`restoreName`・`dismissedSet` | FR-5 |
| 新規 | `src/core/storage/nameDismissalRepository.ts` | 接頭辞 `proofread-names:`。`ProofreadRepository`（`proofreadRepository.ts:10-90`）と同じ API：`get`・`getById`・`save`・`put`・`removeById`・`removeByWork`・`list`・`listRaw`・`replaceAll` | FR-5 |
| 新規 | `src/ui/hooks/use-name-dismissals.ts` | 外した語の読み書き。`use-proofread-record.ts:46` と同じく、同期で取り込んだら読み直す | FR-5 |
| 新規 | `src/ui/components/ProofreadView/name-candidates-section.tsx` | 「用語集に無い名前」の欄（一覧・状態・外した語） | FR-3, FR-4, FR-5 |
| 変更 | `src/ui/components/ProofreadView/analysis-panel.tsx:35-118` | 欄を先頭に差し込む props を足す。既存の欄は変えない | FR-3 |
| 変更 | `src/ui/components/ProofreadView/proofread-view.tsx:44-52,96-131,355-362` | `namesRepo` と `onRegisterName` の props、話の記法の取り出し、画面側の絞り込み、`word` の共有 | FR-3〜5 |
| 変更 | `src/ui/components/GlossaryEntryForm/glossary-entry-form.tsx:62-76,171-172` | 省略できる `onCloseAutoFocus` の prop を足し、`DialogContent` に渡す（渡さなければ今のまま） | FR-4, NFR-4 |
| 変更 | `src/ui/App.tsx:183,399,541,548,570-580,1048-1060` | `quickCreateName`（`string \| null`）を `Partial<GlossaryEntry> \| null` に広げ、名前を `quickCreate`／`setQuickCreate` に変える。既存の呼び出し（`:399` 未解決の @参照・`:541` GlossaryPeek の `onQuickCreate`・`:548` `onNewEntry` の空フォーム）は `{ name }`／`{ name: '' }` を渡す形に直す。`ProofreadView` の `onRegisterName` から開く | FR-4 |
| 変更 | `src/ui/sync/sync-service.ts:95,100-116,140,301-315,419-421,568-581,748-750,916` | 種類 `proofreadNames` を足す。送る（`listRaw` から Zod 検証・壊れた記録は masked）・受ける（`put`）・消す（`removeById`）・退避しない（`recordLost` を早期 return）・本番の結線 | FR-5 |
| 変更 | `src/core/backup/index.ts:43,59` | `nameDismissals` 欄（下記の形）と `BackupState` | FR-5 |
| 変更 | `src/ui/backup/backup-service.ts:102,131,155,168,184` | 復元・ライブ取り込み・集める・置き換えるに足す | FR-5 |
| 変更 | `src/ui/components/ImportDialog/import-dialog.tsx:187,194` | 件数表示に「推敲で外した語：N作品」、警告文の列挙に「推敲で外した語」を足す（推敲画面の「外した語」と同じ語。取り込み画面では何の話か分かるよう「推敲で」を付ける） | FR-5 |
| 変更 | `src/ui/Root.tsx:52,190-192,461` | リポジトリを `withSyncTouch` で包んで App へ渡す | FR-5 |
| 変更 | `src/ui/store/editorStore.ts:189,244-250` と `src/ui/store/createDefaultStore.ts:37,76-78` | 作品の完全削除（`purgeWorkArtifacts`）で外した語も消す | FR-5 |
| 変更 | `docs/CODEMAP.md` | 新しいファイル・接頭辞・辞書の作り方 | — |

## データモデル

### 外した語（新しい kv レコード）

```ts
// src/core/proofread/name-dismissals.ts
export const NameDismissalSchema = z.object({
  text: z.string(),
  /** 外した時刻（並べ替えと、将来の語ごとのマージに使う）。 */
  at: z.number(),
})
export const NameDismissalsSchema = z.object({
  workId: z.string(),
  words: z.array(NameDismissalSchema).optional().default([]),
  /** 同期の LWW に使う（ProofreadRecordSchema と同じ）。 */
  updatedAt: z.number(),
})
// キー：`proofread-names:<workId>`（id は workId）
```

- **旧レコード**：今回からの新設なので無い。読めなければ、外した語なしとして扱う。
- **同期**：
  - サーバは接頭辞を絞っていない（`functions/api/sync/work.ts:55-57` は id が空でないことだけを見る）。サーバの改修は要らない
  - 1件の上限は 25MB（`work.ts:26`）で、外した語には十分
  - LWW はレコード丸ごとで決まる（`src/core/sync/plan.ts:176-184`）。2台で同時に別々の語を外すと、片方の操作が負ける（受け入れるリスク。語ごとの `at` を持たせておき、和集合のマージが要るようになったら足せる形にする）
  - 旧版のクライアントは、知らない接頭辞を作品（`kindOf` の既定）として取りに行く。`WorkSchema` で失敗して何も書かない（`sync-service.ts:113,476-478`）。壊しはしないが、照合のたびに取り直す。`proofread:` と同じ扱い
  - `canonicalJson`（`src/core/sync/hash.ts:6`）は未知の欄を落とす。欄は最初から `words[].at` まで持たせる
- **バックアップ**：

  ```ts
  nameDismissals: z
    .array(NameDismissalsSchema.nullable().catch(null))
    .optional()
    .default([])
  // deserialize で null を捨てる
  ```

  - 配列の要素が1件でも検証に落ちると、バックアップ全体が復元できない（`proofreads` の現状）。外した語では、壊れた要素だけを捨てる
  - 旧版のクライアントは、この欄を黙って捨てる（z.object の既定）
- **publish・MCP**：出さない。grove への publish バンドルは作品（`Work`）から組み立てる（`src/ui/_api/publish.ts:157` の `toBundleEpisodes`）ので、別キーの記録は入らない。MCP の作品スナップショットにも入らない（別キー）。
- **削除**：
  - 作品の完全削除（ゴミ箱の purge・30日切れ・ゴミ箱を空にする）で `removeByWork` する（`editorStore.ts:244-250`）
  - ゴミ箱へ移すだけでは消さない
  - 同期での削除は、レコードごとの tombstone で伝わる（`sync-service.ts:748-750` と同じ）

### 名前の候補（保存しない・Worker から画面へ渡すだけ）

```ts
// src/core/proofread/morph/name-candidates.ts
export type NameSignal = 'katakana' | 'split-kanji' | 'honorific' | 'dict-proper' | 'ruby' | 'ref'
export type NameCategory = '人物' | '場所' | '組織'   // DIALOG_CATEGORIES（src/core/glossary/dialog.ts:124）の部分集合
export interface NameCandidate {
  name: string
  /** 作品全体の本文（記法を解いた文字）での出現回数。 */
  count: number
  /** 出てくる話の数。 */
  episodes: number
  signals: NameSignal[]
  category?: NameCategory
  /** ひらがな。推定できなければ undefined。 */
  reading?: string
}
export interface NameSourceEpisode {
  texts: ReadonlyArray<string>          // 段落ごとのプレーン文字列（plainTextOfBlock）
  tokens: ReadonlyArray<ReadonlyArray<MorphToken>>
  rubies?: ReadonlyArray<{ base: string; reading: string }>
  refs?: ReadonlyArray<string>          // [[ ]] の name（trim 済み）
}
export function findNameCandidates(
  episodes: ReadonlyArray<NameSourceEpisode>,
  excluded: ReadonlySet<string>,        // 用語集の名前・別名（glossaryTerms）
  isKnownReading: (base: string, readingKatakana: string) => boolean, // ルビの除外判定（Worker が辞書で引く）
): NameCandidate[]
export function inlineSignalsOf(blocks: ReadonlyArray<Block>): {
  rubies: { base: string; reading: string }[]
  refs: string[]
}
```

- ルビの除外：「辞書の1語で、読みがルビと同じ」は、ルビの親文字をトークン化して判定する。Worker の中で `tokenize(base)` を引いて1語かを見る。core には判定関数を引数で渡し、lindera に依存しない
- 回数は、作品の全段落を名前の文字列で数える（`indexOf` の繰り返し・重なりなし）。本文の点線の印（`proofread-text.tsx:34-40`）と同じ数え方
- 並べ方：回数の多い順。同じなら名前の `localeCompare(…, 'ja')`
- 敬称の除外リスト（一般の語）は core の定数に置く：客・店員・母・父・兄・姉・妹・弟・娘・息子・嫁・孫・婆・爺・神・王・皆・奥・嬢・坊・姫・先生・社長・部長・課長・殿下・陛下・旦那・女将・親方・師匠
  - 試し文で決めた初期値で、テストで固定する
  - 区間が「辞書にある一般の語1つだけ」のときは、そもそも除く（店員さん）。辞書に無い語（原形が `*`）は除かない（リリアーナ様）
- 「辞書にある語」は原形が `*` でないトークン（`isUnknownToken` の否定）。分類の推定（人名・地域・組織）は辞書にある語の細分類だけを見る。辞書に無い語にも unk.def の細分類（固有名詞,組織 など）が付くことがあるが、使わない

## UI

### 画面: 推敲画面の「分析」タブ（`#/write` の推敲・PC だけ）

- 現状: `screens/proofread-analysis-desktop.png`（撮影用に一時コピーで会員の判定だけを外して撮った。右の欄の幅は約 384px、見出しは `text-xs font-medium`、行は `text-xs`・高さ約 30px、補足は `text-[11px]`）
- 変更点（番号はプロトタイプと対応）:
  - ① 「分析」の先頭に「用語集に無い名前（作品全体）」の欄を足す。見出しの下に補足「用語集に無い名前の候補です。2回以上出てくる語と、ルビや [[ ]] を付けた語を挙げます。」を置く
  - ② 行は2段にする（幅 384px で名前を切らないため）：
    - 1段目：名前のボタン（押すと印を付ける・`aria-pressed`）
    - 2段目：推定した分類・回数・話の数を「人物・3回・1話」の形で淡く出す
    - 右側：小さな「用語集に登録」（`Button size="xs" variant="outline"`）と「外す」（`size="xs" variant="ghost"`）。`xs` は `button.tsx:25` の高さ 24px。行が詰まる欄なので、指摘のカード（`finding-list.tsx:106-115` の `sm`）より一段小さくする
  - ③ 名前を押すと、本文の出現に点線の枠を付ける。既存の `word` の印（`proofread-text.tsx:13-40`）を共用する。「よく使う言葉」の選択とは排他（どちらか一方）。指摘の印と重なる箇所は、先に始まる印だけを描く（今の重ね方のまま・`proofread-text.tsx:23,41-50`）
  - ④ 一覧の下に補足「名前を押すと、この話の本文に点線の枠が付きます。」を置く。選んだ名前がこの話に無いときは「この話には出てきません。」に替える
  - ⑤ 欄の最後に「外した語（N）」の開閉を置く。開くと外した語と「戻す」が並ぶ。0件なら出さない
  - ⑥ 既存の「よく使う言葉」「セリフと地の文」は欄の下にそのまま残す
- 状態:
  - 前回の結果がまだ無く、準備中・作品全体の解析中：「くわしい確認の準備ができると表示します。」（既存の文言・`analysis-panel.tsx:52-54`）
  - 使えない：「くわしい確認は、いまは使えません。」（同 `:49-50`）。ルビと `[[ ]]` だけの候補も出さない
  - くわしい確認の作り直し中（用語集の変更・登録の直後）：前回の一覧を、いまの用語集と外した語で絞って出し続ける。準備中の表示にしない（前回の結果が無いときだけ準備中）
  - 0件：「用語集に無い名前は見つかりませんでした。」
  - オフライン：辞書がキャッシュにあれば変わらない。無ければ「使えない」と同じ（COT-40 の扱い）
  - ゲスト・スマホ：推敲画面そのものが出ない（`App.tsx:230-232`）
  - 無料会員・有料会員：同じ。外した語の同期は、有料の同期が動いているときだけ効く
- モバイル: 対象外（推敲画面は PC だけ）
- 使う共通部品: 既存の `Button`（`src/ui/components/ui/button.tsx`、編集しない）、`AnalysisPanel` の行の見た目、`GlossaryEntryForm`（新規作成）。新しい部品は欄の1ファイルだけ
- フォーカス:
  - 「外す」で行が消えたら、次の行の名前のボタンへフォーカスを移す（次が無ければ前の行、どちらも無ければ欄の見出し `h3` に `tabIndex={-1}`）
  - 登録では、行はダイアログが開いたまま先に消える。`addGlossaryEntry` が `set({ work })` してから戻り（`editorStore.ts:715-718`）、フォームは `await onSubmit` のあとで閉じる（`glossary-entry-form.tsx:154-163`）ため。開いている間はモーダルがフォーカスを閉じ込めるので、行が消えた時点では移せない。また、フォームは `DialogTrigger` を持たない（open を外から制御する）ので、閉じたときの Radix の既定の戻り先（トリガー・`@radix-ui/react-dialog` の `onCloseAutoFocus`）も効かず、フォーカスは body に落ちる
  - そこで、`GlossaryEntryForm` に省略できる `onCloseAutoFocus?: (e: Event) => void` を足して `DialogContent` に渡す（`src/ui/components/GlossaryEntryForm/` は shadcn のコピーではないので編集してよい）
  - `onRegisterName` は `Promise<'created' | 'cancelled'>` を返す。App はダイアログを開くときに resolve を覚え、作成に成功したかを控える。`onCloseAutoFocus` で `preventDefault()` してから resolve する
  - `ProofreadView` は、結果が `created` で行が消えていれば、閉じた時点の一覧で次の行（無ければ前の行・見出し）へ移す。`created` でも行が残っていれば（名前を直して作成した場合）、その行の名前のボタンへ戻す。`cancelled` ならその行の「用語集に登録」へ戻す
  - App は `onCloseAutoFocus` に常に同じ handler を渡す。handler は resolve の ref があるときだけ `preventDefault()` して resolve し、ref を空にする。ref が無ければ何もしない（既存の呼び出しは今のまま）。閉じる時点では `onOpenChange` が `quickCreate` の state をもう null にしているので、state を見て handler を付け外ししない（Radix は閉じたあと最後に描画した handler を呼ぶ）
  - 未解決の @参照など既存の呼び出しでは `onCloseAutoFocus` を渡さず、今の振る舞いのまま
- 文言:
  - 見出し「用語集に無い名前（作品全体）」
  - 補足「用語集に無い名前の候補です。2回以上出てくる語と、ルビや [[ ]] を付けた語を挙げます。」
  - ボタン「用語集に登録」「外す」「戻す」
  - 読み上げ名「リリアーナを用語集に登録」「リリアーナを外す」「リリアーナを戻す」
  - 開閉「外した語（2）」

### 画面: バックアップの取り込み（`ImportDialog`）とヘルプ

- 文字を1行ずつ足すだけで、配置は変わらない。撮影はしない（推敲画面と違って画面の構成に手を入れないため）
- 取り込み：件数の一覧に「推敲で外した語：N作品」（`import-dialog.tsx:187` の「推敲の判断：N話」の次）、警告文の列挙に「推敲で外した語」（`:194` の「推敲の判断」の次）
- ヘルプ：`help-page.tsx:68-70` の IPADIC の表記の文に続けて「今の言葉は SudachiDict から足しています（ライセンス表記・Apache-2.0。一部に UniDic を含みます）。」を足し、`/dict/NOTICE-sudachidict.txt` へリンクする。言い回しは実装時に現物の文に合わせる（プロトタイプの3つ目の節）

### 画面: 用語集に登録（既存のダイアログ・`GlossaryEntryForm` の新規作成）

- 現状: `screens/glossary-quick-create-desktop.png`（本文の未登録の `[[シェリス]]` を押して開いたもの。見出し「用語集に登録」・名前・読み・カテゴリ（未分類）・別名・公開情報・作者メモ・サムネイル・「キャンセル」「作成」）
- 変更点:
  - ⑦ 推敲画面の「用語集に登録」から、名前・読み・カテゴリを入れた状態で開く
  - フォーム自体は変えない（`initial` に渡すだけ・`glossary-entry-form.tsx:68,113-115`）
- 確定後: `store.addGlossaryEntry({ name, ...formValuesToFieldPatch(values) })`（`App.tsx:1057`）。推敲画面のまま閉じる

## ロジック・API

- `findNameCandidates`（上記）の手がかりは、トークン列を左から1回なめて区間を作る：
  - カタカナの区間：カタカナだけの表層形で、品詞が名詞（接尾を除く）のトークンが続くところ。`isUnknownToken` か `pos1 === '固有名詞'` を1つ以上含めば候補
  - 割れた漢字の区間：漢字1字の名詞（`pos1` が 数・接尾・代名詞・非自立 以外）が2〜3個続くところ
  - 敬称：`pos === '名詞' && pos1 === '接尾' && pos2 === '人名'` の直前の名詞の区間。「一般の語1つだけ」の区間と、除外リストの語は除く
  - 辞書の固有名詞：`pos1 === '固有名詞'` で2字以上（カタカナの区間に含まれるものは区間のほうを採る）
  - 場所の推定：区間の直後が `pos1 === '接尾' && pos2 === '地域'`
- `analyzer-engine.ts` の `analyze` は、今のトークンキャッシュ（`episodes` のハッシュ）をそのまま使う。`names` は呼ぶたびに作る。ルビの判定用に `tokenize` を中で引く
- 画面側の絞り込み（`proofread-view.tsx`）：

  ```ts
  // analysis は解析器の作り直し中も前回の結果を持ち続ける（setAnalysis を消さない・proofread-view.tsx:95,120-122）
  const names = analysis?.names ?? null          // null＝まだ一度も結果が無い（準備中の表示）
  const shown = names?.filter((c) => !dismissed.has(c.name) && !glossaryNow.has(c.name)) ?? null
  // 解析器が error のときは shown にかかわらず「使えない」を出す
  ```

  `glossaryNow` は `glossaryTerms(work.glossary)`（`src/core/proofread/user-dict.ts:16`）。指摘タブの品詞を使う指摘は、今のまま作り直し中は出ない（COT-40 の振る舞い・今回は変えない）
- `ProofreadView` の props を足す：
  - `namesRepo: NameDismissalRepo`
  - `onRegisterName: (draft: { name: string; reading?: string; category?: string }) => Promise<'created' | 'cancelled'>`
- `App.tsx` は `setQuickCreate(draft)` で既存のクイック作成ダイアログを開き、resolve を ref に覚える。作成に成功したら控え、`onCloseAutoFocus` で `preventDefault()` してから `'created'`／`'cancelled'` で resolve する（UI 節「フォーカス」）。`onCloseAutoFocus` の handler は常に同じものを渡し、resolve の ref が無いときは何もしない。未解決の @参照から開くとき（`App.tsx:389-404`）は `{ name }` を渡すだけで、ref は作らない

## テスト計画

| 層 | 何を固定するか | 置き場所 |
|---|---|---|
| unit | 足す語の選び方：ひらがなだけ・3字以下のカタカナ（core の3字は入れる）・重み0を外す、割れ方の3分類だけを入れる、品詞とコストの写像 | `src/core/proofread/morph/dict-supplement.test.ts` |
| unit | `pos2` と `isUnknownToken` | `src/core/proofread/morph/token.test.ts`（既存に追記） |
| unit | FR-2 の受け入れ条件（リリアーナ・アルヴェイン・朔夜・湊斗・宮森／佐伯・店員さん・黒鉄と憂鬱のルビ・用語集の名前と別名・`[[シェリス]]`・スマートフォン・並び順）。トークンは `names.json`（実物の lindera 出力）から作る | `src/core/proofread/morph/name-candidates.test.ts` |
| unit | `inlineSignalsOf`（ルビ・`[[ ]]`・ルビを重ねた `[[ ]]`） | 同上 |
| unit | `dismissName`／`restoreName`（重複・順序・`updatedAt`） | `src/core/proofread/name-dismissals.test.ts` |
| unit | リポジトリ：接頭辞が `proofread:` の `replaceAll` で消えない、`listRaw` が壊れた記録も返す、`removeByWork` | `src/core/storage/nameDismissalRepository.test.ts` |
| unit | バックアップ：往復、旧バックアップ（欄なし）が空で読める、壊れた要素だけ捨てて他は復元できる | `src/core/backup/index.test.ts`（既存に追記） |
| integration | 同期：送る・受ける・tombstone で消える・壊れた記録は masked で相手を上書きしない・`recordLost` に入らない | `src/ui/sync/sync-service.test.ts`（既存に追記） |
| integration | 欄の状態（準備中・使えない・0件・一覧）。解析器の作り直し中も前回の一覧を出し続け、準備中にならない。名前の押下で印が付き言葉の選択が外れる。この話に無い名前で補足が「この話には出てきません。」に替わる。「外す」「戻す」がリポジトリに保存される。本文から無くなった外した語も「外した語」に並ぶ。外した語の記録が壊れていても一覧が出る。行が消えたらフォーカスが次の行（無ければ前の行・見出し）へ移る。読み上げ名 | `src/ui/components/ProofreadView/proofread-view.test.tsx`（既存に追記・偽の解析器で `names` を返す） |
| integration | 「用語集に登録」でフォームが名前・読み・カテゴリ入りで開く。分類が無い候補は「未分類」で開く。作成で用語集に入り一覧からすぐ消え、ダイアログが閉じたあと次の行の名前のボタンにフォーカスがある。名前を直して作成すると、元の候補は一覧に残り、フォーカスはその行の名前のボタンに戻る。「キャンセル」で何も変わらず、フォーカスはその行の「用語集に登録」に戻る。既存の呼び出し（未解決の @参照・GlossaryPeek・空フォーム）が今までどおり開く（実際の `GlossaryEntryForm` を通す） | `src/ui/App.test.tsx`（既存に追記） |
| node | 新しい辞書：FR-1 の文が1語になる。新しい辞書の表層形の区切りが `samples.json`（今の辞書の出力・作り直さない）と一致する。`fictional-names.json` の61個で1語のまま残る数が、今の辞書の数（実装の最初に今の辞書で数えて定数に固定・試作で55）以上。`public/dict/` の zip が 13MB 以下 | `src/ui/proofread/analyzer.node.test.ts`（辞書があるときだけ走る既存の形） |
| node | 辞書ファイル名が4か所（`protocol.ts`・`fetch-dict.mjs`・`gen-morph-fixtures.mjs`・`analyzer.node.test.ts`）でそろう | 同上 |
| e2e | ヘルプに SudachiDict のライセンス表記へのリンクがあり、開ける（ゲストで見られる範囲） | `e2e/smoke.spec.ts` |
| e2e | 推敲画面は無料会員以上なので、ゲストで走る e2e では扱わない（COT-40 と同じ） | — |
| 手動 | 30万字の作品で、候補づくりが足す時間（NFR-1）とメモリを Chromium で測り、実装メモに残す | design.md 末尾 |
| 手動 | 前の版の辞書をキャッシュに持つブラウザで推敲画面を開き、Cache Storage `ns-dict-v1` に新しい zip だけが残る（既存の `analyzer.worker.ts:66-69` に任せる） | 同上 |

## リスク・未決事項

- **U1（決定）外した語は同期・バックアップする**（2026-10-18 ユーザー回答）
- **U2（決定）辞書はこのリポジトリの GitHub Release に置く**（2026-10-18 ユーザー回答）：
  - 公開リポジトリなので、CI は認証なしで取れる
  - Release を作るのは外向きの操作なので、実装時に改めてユーザーの了承を得る
  - SudachiDict を改変して配るので、zip に LICENSE・LEGAL の全文と改変の旨を書いた `NOTICE-sudachidict.txt` を入れる（Apache-2.0 の4条）
- **品詞を使う指摘の出方が変わる**：
  - 足した7万語には読みがあり、表記ゆれの自動発見の対象に入る
  - 新しい組（〆切り／締め切り など）が出ることがある
  - テスト文の区切りは変わらないことを固定する。実際の原稿での変化は実装時に手で確かめる
- **2台で同時に外すと片方が負ける**（LWW）。外した語は戻せる記録なので受け入れる
- **実在の地名・人名も候補に出る**（新宿など）。「外す」で消せる
- **義訓のルビが候補に出る**：宇宙《そら》・本気《マジ》のように、辞書の読みと違うルビは1回でも候補になる。作中の言い回しとして用語集に入れたい作者もいるので、手がかりからは外さない。不要なら「外す」で消せる
- **試し文で決めた線**（2回以上・敬称の除外リスト・足す語の選び方）は、実際の原稿で外れが多ければ見直す。見直しは `names.json` の試し文を足して、テストで固定してから行う
- **メモリ**：辞書の展開後は 46MB から 54MB になる。推敲画面のメモリ（COT-40 の実測で Chromium RSS +約205MB）が少し増える。実装時に測る

## 付録 A：架空の名前61個（`fictional-names.json` の中身）

FR-1 の「名前が1語のまま残る数」を数える基準。試作（2026-10-15）では、今の辞書で55個、足す語を選び直した新しい辞書で56個が1語のまま残った。3字以下のカタカナ語も足した辞書では44個に減った。

- 文の型：「「待って」<名前>は振り返った。<名前>の声が響く。」
- 数え方：その文を解析して、名前と表層形が同じトークンが1つでもあれば「1語のまま残る」

リリアーナ アルヴェイン グランヴェル シェリス ヴォルフガング エクスカリバー ルミエール セレスティア アリシア エリオット クラウディア フェリシア ルシアン ヴィクトール レオンハルト ジークフリート エレオノーラ マリエッタ オーレリア カトリーナ シルヴィア ノエル ユリウス ラインハルト アストリア イザベラ ガブリエル ディートリヒ フィオナ ベアトリス ミルフィーユ ロザリンド ウィルヘルム エステル カミーユ セシリア ティアナ ナターシャ ハインリヒ マクシミリアン リヒテンベルク アークライト ヴァルハイム エルディア ガルムント ゼファリア ドラグノフ ネメシア ファルケンハイン メルヴィア ラグナロク アイゼンブルク クロノス セラフィナ ティルナノーグ ベルセリオス リュミエール オルフェウス カーディナル シュヴァルツ ノクターン

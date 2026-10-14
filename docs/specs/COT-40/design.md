# 設計 — COT-40 推敲画面を執筆から切り離し、指摘ごとに「直す／このまま」を選べるようにする（形態素解析つき）

プロトタイプ: https://claude.ai/artifact/NQ5GfUrxqSMq1tPTYZkG19 （非公開・ローカルは `docs/specs/COT-40/prototype.html`）

## 方針

- 小説の推敲は、執筆画面の中の別画面「推敲」（`activeScreen === 'proofread'`）に移す。入口の条件と画面の切り替えは演出エディタ（`src/ui/App.tsx:215,423,504-512`）と同じにし、小説の作品に限る。
- 指摘は「段落 ID＋項目＋該当文字列＋同じ段落での出現順」で識別する。判断（直す／このまま）は演出譜と同じく本文の外に話ごとに保存し、同期とバックアップに相乗りさせる（`src/core/storage/stagingRepository.ts` の写し）。
- 執筆画面は解析器を使わない。「直す箇所」は、判断の記録と現在の下書きの文字列照合だけで「まだ直っていないか」を決める。
- 形態素解析は `lindera-wasm` 6.2.0（wasm 1.7MB）と IPADIC 6.2.0（zip 10.5MB）を Web Worker で動かす。推敲画面を開いたときだけ Worker を起こし、離れたら止める。辞書の zip は同じ配信元（`/dict/`）から取り、Cache Storage に保存して2回目以降はネットワークを使わない。
- 作品全体のトークンは Worker の中だけに持つ。Worker は core の純関数で作品全体の集計（表記ゆれの自動発見・よく使う言葉）まで済ませ、画面側にはいまの話のトークンと集計結果だけを返す。
- 品詞を使うルールは `src/core/proofread/morph/` に、トークン列（自前の型）を受け取る純関数として置く。解析器のライブラリを import するのは Worker だけ。

捨てた案：
- `lindera-wasm-ipadic` 2.1.0（辞書内蔵の1ファイル）：npm で deprecated。ユーザー辞書をバイト列から読めない。
- kuromoji.js：2018年以降更新が無い。辞書 17MB。
- 辞書を Service Worker のプリキャッシュに入れる：執筆画面しか使わない人にも 12MB を配ることになる。
- lindera の OPFS ヘルパ（`lindera-wasm/opfs`）：展開後の 47MB を端末に置くことになる。zip のまま（10.5MB）Cache Storage に置き、毎回メモリ上で展開するほうが軽い。
- 辞書をリポジトリにコミット：10.5MB のバイナリが履歴に残り続ける。ビルド時にハッシュを固定して取得する。
- 執筆画面の textarea に下線を重ねる：ユーザーが不採用とした。
- 推敲の判断を同期の退避一覧に載せる：退避一覧は全種類で20件まで（`src/core/sync/syncLostRepository.ts:20`）なので、話ごとの判断がプロットや原稿の退避を押し出す。

## 変更ファイル

| 種別 | パス | 責務 / 変更内容 | 要件ID |
|---|---|---|---|
| 変更 | `src/core/proofread/types.ts` | `Finding` 型を足す。`NovelRuleId` と `NOVEL_RULES` に `doubled-particle`（一文の中の同じ助詞）・`ra-nuki`（ら抜き言葉）を足す（`isNovelRuleId` は自動で通る）。脚本と共用の `ProofNotice` は残す | FR-3, FR-8, FR-10 |
| 変更 | `src/core/proofread/rules.ts` | `checkLine` を「出現ごとのヒット（`start`・`end`・`text`・`anchor` つき）」を返す形にする。`.test` を `matchAll` に替え、「同じ code は 1 行に 1 件まで」（`:7`）と三点リーダー／ダッシュ／中黒、感嘆符／句読点の優先順位をやめる。当たる段落の集合は変えない | FR-10 |
| 変更 | `src/core/proofread/variants.ts` | `formsInLine`（`:388-396`）を、書き方ごとに全出現と `m.index` を返す形にする（`mask` `:322-325` は長さを保つので位置はそのまま使える）。`variantFindingsForLine(text, counts)` を足し、語は出現ごと、数の書き方は数の出現ごとに1件にする（`:436-438` の1行まとめをやめる） | FR-10 |
| 変更 | `src/core/proofread/index.ts` | `proofreadNovel(blocks, opts)` の戻り値を `Finding[]` にする。`blocks` は id 付き（保存済み）を受ける。`opts.morph` を受けたら FR-8 の指摘を足す。自動の表記ゆれは、辞書の表記ゆれと範囲が重なる出現を落とす | FR-3, FR-8, FR-10 |
| 新規 | `src/core/proofread/morph/token.ts` | `MorphToken` 型と `toMorphTokens(raw)`（Worker の生データ→UTF-16 の位置つきトークン。`setKeepWhitespace(true)` で表層形を足し合わせると原文に戻ることを使う） | FR-8 |
| 新規 | `src/core/proofread/morph/auto-variant.ts` | 表記ゆれの自動発見（作品全体の集計と段落ごとの指摘） | FR-8a |
| 新規 | `src/core/proofread/morph/doubled-particle.ts` | 一文の中の同じ助詞 | FR-8b |
| 新規 | `src/core/proofread/morph/ra-nuki.ts` | ら抜き言葉（地の文だけ） | FR-8c |
| 新規 | `src/core/proofread/morph/frequent-words.ts` | よく使う言葉（副詞・形容詞の上位10件） | FR-9a |
| 新規 | `src/core/proofread/quotes.ts` | 括弧の中かどうかの判定（`insideQuotes(text): boolean[]`）。ら抜きとセリフの割合が共用 | FR-8c, FR-9b |
| 新規 | `src/core/proofread/dialogue-ratio.ts` | セリフと地の文の文字数（話ごと・作品全体） | FR-9b |
| 新規 | `src/core/proofread/decisions.ts` | 判断の Zod スキーマ・指摘との照合・判断の追加／変更／削除・「直す箇所」の算出と位置決め（純関数） | FR-4, FR-5, FR-6 |
| 新規 | `src/core/proofread/user-dict.ts` | 用語集の名前と別名から IPADIC のユーザー辞書 CSV（`表層形,カスタム名詞,読み`）を作る | FR-7 |
| 変更 | `src/core/parser/parseNotation.ts` | `scanInlines`（`:76-159`）に、プレーン文字ごとの行内の位置を報告する省略可能な引数を足し、それを使う `plainOffsetMap(line)` を export する（規則を二重に書かない。`parseInlines` の結果は変えない） | FR-6 |
| 新規 | `src/core/storage/proofreadRepository.ts` | 判断の永続化（`stagingRepository.ts` の写し。キー `proofread:<workId>:<episodeId>`） | FR-5 |
| 新規 | `src/ui/proofread/analyzer.worker.ts` | Worker 本体：wasm の初期化、辞書 zip の取得と Cache Storage 保存、展開、ユーザー辞書、話ごとのトークンのキャッシュ、作品全体の集計（core の関数を呼ぶ） | FR-7, FR-8, FR-9a, NFR-5 |
| 新規 | `src/ui/proofread/unzip.ts` | zip の展開（`DecompressionStream('deflate-raw')`。依存を足さず自前で持つ） | FR-7 |
| 新規 | `src/ui/proofread/analyzer-client.ts` | Worker の起動・停止・要求と応答の対応・状態（`idle`/`loading`/`ready`/`error`）を持つ自前ストア | FR-7 |
| 新規 | `src/ui/hooks/use-morph-analyzer.ts` | `analyzer-client` を `useSyncExternalStore` で読むフック。推敲画面のマウントで起動、アンマウントで停止 | FR-7 |
| 新規 | `src/ui/hooks/use-proofread-record.ts` | 話ごとの判断の読み書き（repo 経由・`subscribeSyncApplied` で読み直し） | FR-4, FR-5, FR-6 |
| 新規 | `src/ui/components/ProofreadView/proofread-view.tsx` | 推敲画面（ヘッダ・本文・右欄）。遅延読み込み | FR-3, FR-4 |
| 新規 | `src/ui/components/ProofreadView/proofread-text.tsx` | 本文を段落ごとに読み取り専用で描き、指摘と「よく使う言葉」の印を付ける | FR-3, FR-9a |
| 新規 | `src/ui/components/ProofreadView/finding-list.tsx` | 指摘の一覧（未判断／直す／このまま）と判断のボタン | FR-4 |
| 新規 | `src/ui/components/ProofreadView/analysis-panel.tsx` | 分析（よく使う言葉・セリフと地の文） | FR-9 |
| 新規 | `src/ui/components/ProofreadView/rule-toggles.tsx` | 「確認する項目」（`proofread-panel.tsx:30-50` のチップ部分を移す） | FR-3 |
| 新規 | `src/ui/components/FixListButton/fix-list-button.tsx` | 執筆画面の「直す箇所 N」と一覧（幕は `ProjectMenu` の作り `src/ui/components/Library/project-menu.tsx:50-62`。一覧は `role="menu"` にせず `ul` と行ごとのボタン2つ） | FR-6 |
| 変更 | `src/ui/components/EditorPane/editor-pane.tsx` | 小説の推敲チェックを外す（`:12,46,72,83-93,468-479` の小説側・`variantBase` prop・`useProofreadPrefs` の import）。脚本の分岐（`:460-466`）は残す | FR-1 |
| 変更 | `src/ui/components/EditorPane/proofread-panel.tsx` | `toggles` を外し脚本専用にする（使う側が脚本だけになる） | FR-1 |
| 変更 | `src/ui/App.tsx` | `activeScreen` に `'proofread'`（`:151-153`）、`proofreadAvailable`（`:215` の並び）、狭幅で戻す（`:219-229`）、`SideNav` へ `onNavigateProofread`（`:423` の並び）、入るときに先に保存（`:276-293` の前例）、遅延読み込みと描画（`:87,504-512` の並び）、ツールバーに `FixListButton`（`:698` 右側の操作群の先頭）、「本文で直す」（下の「App の配線」）。`variantCache`・`variantBase`（`:240-249`）と `EditorPane` への受け渡し（`:805`）を消す | FR-1, FR-2, FR-4, FR-6 |
| 変更 | `src/ui/components/SideNav/side-nav.tsx` | `NavKey` に `'proofread'`（`:33-44`）、`onNavigateProofread` prop、「本文を書く」の `NavRow`（`:247-252`）の直後に「推敲」の `NavRow`（アイコン `SpellCheck`） | FR-2 |
| 変更 | `src/ui/Root.tsx` | `withSyncTouch(createDefaultProofreadRepository(), ['save','remove','removeByWork'])`（`:183-187` と同型）を作り App へ渡す | FR-5 |
| 変更 | `src/ui/store/createDefaultStore.ts`・`src/ui/store/editorStore.ts` | `EditorStoreDeps` に `proofreadRepo?`（`:185-187`）、`purgeWorkArtifacts`（`:241-246`）で `removeByWork` | FR-5 |
| 変更 | `src/ui/sync/sync-service.ts` | `ItemKind` に `'proofread'`（`:93`）、`kindOf`／`rawIdOf`（`:98-112`、`'work'` へ落ちる前に置く）、`SyncDeps.proofreads`（`:134`）、列挙（`:283-294` の後）、pull（`:528-543` の後。競合でも `recordLost` を呼ばない）、purgeLocal（`:699-709` の後。`recordLost` を呼ばない）、配線（`:874`） | FR-5 |
| 変更 | `src/core/backup/index.ts` | `CloudBackupSchema.proofreads` を `.optional().default([])`（`:40` の後）、`BackupState` に `proofreads`（`:47-57`） | FR-5 |
| 変更 | `src/ui/backup/backup-service.ts` | restore・pullLive・gather・replaceAll と repo の生成に proofreads（`:92-102,120-130,151,155-165,170-184`） | FR-5 |
| 変更 | `src/ui/components/ImportDialog/import-dialog.tsx` | 内訳と置き換えの警告文に推敲の判断を足す（`:181-193`） | FR-5 |
| 変更 | `src/ui/hooks/use-auto-backup.ts` | `store.subscribe(schedule)`（`:72`）に加えて `subscribeSyncTouch(schedule)`（`src/ui/sync/sync-touch.ts:19`）も購読し、判断だけの変更でも静止判定に数える | FR-5 |
| 変更 | `src/ui/components/HelpPage/help-page.tsx` | 「推敲する」（`:65-68`）を新しい流れに書き直し、IPADIC の NOTICE へのリンクを足す | FR-11, NFR-6 |
| 変更 | `public/llms-full.txt` | `:16` の「書く・推敲する・投稿用に書き出すまでの機能は、無料で期限なく使えます」から推敲を外し、推敲画面は無料のアカウント登録で使える、と足す | FR-11 |
| 変更 | `vite.config.ts` | `globIgnores` に `'**/*.wasm'`（`:25`。入れないと 2MiB 超でビルドが止まる）。`runtimeCaching` に `/assets/*.wasm` の CacheFirst（`:41-63` の並び）。`navigateFallbackDenylist` に `/^\/dict\//`（`:32-40`）。`worker: { format: 'es' }`、`optimizeDeps.exclude: ['lindera-wasm']` | FR-7, NFR-4 |
| 新規 | `scripts/fetch-dict.mjs` | `lindera-ipadic-6.2.0.zip` を GitHub Releases から取得し、SHA-256 `5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72` を照合して `public/dict/` に置く。NOTICE.txt を `public/dict/NOTICE-ipadic.txt` に取り出す。既にあってハッシュが合えば何もしない。取れないかハッシュが違えば終了コード 1 | FR-7, NFR-1, NFR-6 |
| 新規 | `scripts/gen-morph-fixtures.mjs` | 品詞ルールのテスト用に、例文を実際の lindera で解析した結果を `src/core/proofread/morph/__fixtures__/*.json` に書き出す（手で回す。CI では回さない） | FR-8 |
| 新規 | `scripts/check-precache.mjs` | build 後の `dist/sw.js` に `.wasm` と `/dict/` が入っていないことを確かめ、入っていれば終了コード 1 | FR-7 |
| 変更 | `package.json`・`.gitignore` | `lindera-wasm@6.2.0` を dependencies に。`predev`・`prebuild`・`pretest` で `fetch-dict.mjs`、`postbuild` で `check-precache.mjs`。`public/dict/` を ignore | NFR-1 |
| 変更 | `.github/workflows/ci.yml`・`.github/workflows/deploy.yml` | `actions/cache`（`ci.yml:33,69`・`deploy.yml:38` の並び）に `public/dict/` を足し、キーに辞書の版を含める | NFR-1 |
| 新規 | `public/_headers` | `/dict/*` に `Cache-Control: public, max-age=31536000, immutable`（ファイル名に版を含む） | NFR-4 |
| 変更 | `docs/requirement/03-architecture.md`・`docs/CODEMAP.md` | 依存ポリシーの例外（lindera-wasm）を記録。推敲画面・判断・解析器の地図 | NFR-1 |

`src/ui/components/ui/`（shadcn コピー）は触らない（`Progress` は使うだけ）。状態管理ライブラリは足さない（解析器の状態は `useSyncExternalStore` の自前ストア）。`src/core/sync/syncLostRepository.ts` と `SyncLostDialog` は変えない（判断を退避一覧に載せないため）。

## データモデル

### 指摘（core の型・保存しない）

```ts
export interface Finding {
  blockId: string        // 保存済み Block の id
  blockIndex: number     // 表示順（話の中の段落の位置）
  code: NovelRuleId      // 'indent' | … | 'variant' | 'doubled-particle' | 'ra-nuki'
  start: number          // 段落のプレーン文字列（plainTextOfBlock）の UTF-16 位置
  end: number
  text: string           // 該当文字列。直したら段落から消えるように選ぶ（下表）
  anchor: 'contains' | 'lineStart'
  message: string
}
```

指摘はすべて出現ごとに1件。

| code | `text` の取り方 |
|---|---|
| `indent` | 段落の先頭1文字（`anchor: 'lineStart'`） |
| `punct-before-close` | 「。」」のような句読点＋閉じ括弧の2文字 |
| `space-after-exclamation` | 「！」と直後の1文字 |
| `leader-odd` | 奇数の連なりと前後1文字（「て…、」）。中黒は「・・・」の連なり |
| `halfwidth-punct` | 半角の約物と隣の和文字（「て!」） |
| `successive-word` | 当たった繰り返し（「がが」「言った言った」） |
| `variant`（辞書の語） | 辞書の正規表現の一致そのもの（`m[0]`）。前後の文脈の文字を含むことがある（「出来な」「る事が」）。範囲も一致の範囲 |
| `variant`（数の書き方） | 数の一致（「2人」「一人」） |
| `variant`（自動） | 該当トークンの表層形と範囲（「子供」）。辞書の `variant` と範囲が重なれば出さない |
| `doubled-particle` | 1つ目の助詞から2つ目の助詞まで（「で代替素材で」） |
| `ra-nuki` | 動詞と「れる」を合わせた範囲（「食べれる」「来れ」） |

辞書の表記ゆれは解析器に依存しないので、解析器の準備の前後で `text` と範囲が変わらない。自動の表記ゆれは、辞書の指摘と重ならない出現にだけ出るので、準備の前後で判断のキーがずれることはない。

### 判断（保存する）

```ts
// src/core/proofread/decisions.ts
export const ProofreadDecisionSchema = z.object({
  blockId: z.string(),
  code: z.string(),                                  // 未知の項目 ID も捨てない
  text: z.string(),
  nth: z.number().int().nonnegative().optional().default(0), // 指摘の中での順番：同じ段落・同じ code・同じ text の指摘の何番目か（0始まり）。推敲画面での照合に使う
  occurrence: z.number().int().nonnegative().optional(), // 段落のプレーン文字列に現れる text（指摘かどうかを問わない）の中での通し番号（0始まり）。「直す箇所」の判定と位置決めに使う。無ければ nth で代用
  anchor: z.string().optional().default('contains'), // 'contains' | 'lineStart'。未知の値は 'contains' として扱う
  verdict: z.string(),                               // 'fix' | 'keep'。未知の値は判断なしとして扱う（捨てない）
  message: z.string().optional(),                    // 判断した時点の説明（執筆画面の一覧に出す）
  decidedAt: z.number(),
})
export const ProofreadRecordSchema = z.object({
  workId: z.string(),
  episodeId: z.string(),
  decisions: z.array(ProofreadDecisionSchema).optional().default([]),
  updatedAt: z.number(),                             // 同期の LWW に使う（StagingSchema と同じ）
})
```

- 保存先：IndexedDB の既存 store `kv` にキー `proofread:<workId>:<episodeId>`（`src/core/storage/idbStore.ts:19` のバージョンは上げない）。id は `proofreadIdOf(workId, episodeId) = "<workId>:<episodeId>"`。
- 同期 id：`proofread:<workId>:<episodeId>`。サーバ（`functions/api/sync/*`）と `src/core/sync/plan.ts` は変えない。競合は LWW（新しい `updatedAt` を採る）で、負けた側は退避一覧に載せない。
- 照合：指摘のキー `blockId|code|text|nth` が判断と一致したら、その判断を当てる。`verdict` が未知なら未判断として扱う。
- 「直す箇所」：`verdict === 'fix'` の判断のうち、現在の下書きを `reconcileBlockIds(episode.blocks, parseEpisodeBody(draft))` で id 付きにした段落の `plainTextOfBlock` で、`text` の出現数（1文字ずつずらして探し、重なり合う出現もそれぞれ数える）が `occurrence` より多いもの（`lineStart` は段落がまだ `text` で始まるもの）だけ。段落が無ければ直ったとみなす。記録は消さない。ルールを当て直さないので、正規表現の項目も品詞の項目も同じ方法で判定できる
  - `occurrence` は判断を作るとき（`decide`）に、段落全体で `text` を1文字ずつずらして探し、`start` より前で始まる出現の数として数える（重なり合う出現も数える。`openFixes` と `locateFix` も同じ数え方。数え方は `decisions.ts` の1つの関数 `occurrencesOf(text, plain): number[]` にまとめる）。同じ文字列の指摘どうしが重なる場合（`leader-odd` の「ご…ご…ごめん」は2件とも「ご…ご」で位置 0 と 2）も、2つ目は occurrence=1 になる。指摘にならない同じ文字列（「飛んできた」の「できた」、括弧の中の「見れ」、「仕事」の「事」）も数えるので、判定と位置決めは指摘の出現を正しく指す
  - 割り切り：判断した箇所より前に同じ文字列を書き足す・消すと通し番号がずれ、隣の出現を選ぶ・直っていないのに消えることがある。どの出現を直したかも区別しない（1つ目が「このまま」、2つ目が「直す」なのに1つ目を書き換えると、残った出現に推敲画面で `nth` の小さい判断が当たる）。いずれも原稿には影響せず、作者は推敲画面で見直せる
- バックアップ：`CloudBackupSchema` に `proofreads: z.array(ProofreadRecordSchema).optional().default([])`。旧バックアップは空として読む。旧版のアプリで新しいバックアップを復元すると `z.object` が `proofreads` を捨て、旧版の `replaceAll`（`src/ui/backup/backup-service.ts:170-184`）は `proofread:` のキーに触れないので、その端末の判断はそのまま残る。
- publish バンドル・MCP：載せない。

## UI

### 画面: 執筆（`#/write`、本文の面）

- 現状: `screens/editor-novel-desktop.png`・`screens/editor-novel-mobile.png`
- 変更点:
  - ① エディタの下の「推敲チェック（確認候補 N件）」の欄を無くす（小説）。脚本の「脚本の書式チェック」は残す
  - ② ツールバー右側の操作群の先頭（「検索・置換」の手前）に「直す箇所 N」ボタン（件数が1以上のときだけ）。見た目は `bg-secondary-container text-on-secondary-container` の丸いボタン。スマホでも出す（アイコン＋件数）
  - ③ 押すと一覧（PC はボタンの下に右寄せで幅 360px のカード、スマホは `WorkSearchPanel` と同じ全幅のカード）。見出し「直すと決めた箇所」、項目は「項目名」「該当文字列（前後6字を添える）」「説明」と、ボタン「その箇所へ移る」（行の大部分を占める）と「外す」。PC で FR-2 の条件を満たすときだけ末尾に「推敲画面を開く」。外側を押すと閉じる（`ProjectMenu` の幕と同じ）。Esc で閉じて「直す箇所」ボタンへフォーカスを戻す処理は、`ProjectMenu` に無いので新しく書く
  - ④ 「その箇所へ移る」で一覧を閉じ、本文の該当文字列を選択（`EditorPaneHandle.selectRange`・`editor-pane.tsx:315-330`）
- 状態: 0件＝ボタン自体を出さない／ゲスト・無料・有料とも同じ（判断が無ければ出ない）／脚本では出さない
- 使う共通部品: `Button`、`ProjectMenu` 型の幕、`useToast().show`
- 文言: ボタン「直す箇所 3」（aria-label「直すと決めた箇所 3件」）、見出し「直すと決めた箇所」、「その箇所へ移る」（項目の文字列を読み上げ名に含める）、「外す」、「推敲画面を開く」、トースト「その箇所だけを選べなかったため、段落全体を選びました」

### 画面: 推敲（`#/write` の中、`activeScreen === 'proofread'`・PC だけ）

- 現状: 撮影不可（無料会員以上の画面。撮影はゲストで動くため。同じ構成の演出エディタも同じ理由で撮れない）。代わりに会員の PC 画面の骨格として `public/lp/shots/plot.webp`（プロット画面）を参照し、プロトタイプにも載せる。⑤ の行はこの画像の「本文を書く」と「用語集」の間に入る
- 変更点:
  - ⑤ サイドナビの「本文を書く」の直下に「推敲」（`SpellCheck` アイコン）。下の「草稿」の話の一覧はそのまま
  - ⑥ ヘッダ：プロット画面の見出し（`src/ui/components/PlotView/plot-view.tsx:314-327`）と同じ組み方。明朝の見出し「推敲」、件数の行「未判断 6 ・ 直す 3 ・ このまま 1」、説明文。その下に話の選択（`staging-view.tsx:877-890` と同じ select）、「確認する項目」ボタン（押すと項目のチップが開く。チップは `proofread-panel.tsx:36-49` の見た目のまま）、くわしい確認の状態（`Progress`＝`src/ui/components/ui/progress.tsx` と数字）
  - ⑦ 左：本文。段落ごとに `<p>`、プレビューと同じ明朝（`.preview` のフォント）。指摘の印は、未判断＝波線の下線（`underline decoration-wavy decoration-brand-secondary`）、直す＝塗り（`bg-secondary-container`）。「よく使う言葉」の印は点線の枠（`outline-dotted outline-primary`）。いずれも既存のトークン（`src/ui/index.css:193-194`）
  - ⑧ 右（`w-96`＝384px）：「指摘」「分析」の切り替えと「未判断 N／直す N／このまま N」の絞り込み。どちらもプロット画面の `ViewTab`（`plot-view.tsx:518-540`。丸いチップ、選択中は `bg-primary`）と同じ見た目
  - ⑨ 指摘のカード：項目名、該当文字列を含む前後20字の抜粋（該当箇所に⑦と同じ印）、説明、ボタン。未判断は「直す」「このまま」（同じ指摘が他にあれば「同じ指摘をすべてこのまま（N件）」）。直すは「本文で直す」「未判断に戻す」。このままは「未判断に戻す」
  - ⑩ 分析：「よく使う言葉」（語・件数・1万字あたり、押すと本文に印）と「セリフと地の文」（いまの話・作品全体の横棒と％、話ごとの一覧）
- 状態:
  - くわしい確認の準備中：正規表現の項目はすぐ出す。ヘッダに「くわしい確認の準備をしています（初回のみ）」＋ `Progress`＋「4.2 / 10.5MB」（辞書の取得の量。wasm 1.7MB は数えない）。「確認する項目」の新しい2項目には「準備中」の印
  - 作品全体の解析中：「作品全体を確認しています（12 / 48話）」
  - エラー：「くわしい確認は、いまは使えません。」＋「もう一度試す」。分析の「よく使う言葉」も同じ文言
  - 空の話：「この話にはまだ本文がありません」
  - 指摘0件：「確認する項目では、気になる箇所は見つかりませんでした」
  - オフライン：2回目以降は普段どおり。初回はエラーと同じ
  - ゲスト・スマホ：入口が無い（FR-2）
- 使う共通部品: `Button`、`Progress`、`ScreenLoading`／`ScreenFailure`（`App.tsx:100-124`）、`ErrorBoundary`（`App.tsx:503`）、`ViewTab` と同じ見た目のチップ、`useToast`
- 文言: 見出し「推敲」、説明「指摘ごとに、直すか、このままにするかを選べます。直すと決めた箇所だけが本文の画面に出ます。」、ボタン「直す」「このまま」「同じ指摘をすべてこのまま（N件）」「本文で直す」「未判断に戻す」「確認する項目」「もう一度試す」、切り替え「指摘」「分析」、絞り込み「未判断」「直す」「このまま」

## ロジック・API

### core（純関数）

```ts
// index.ts
proofreadNovel(blocks: Block[], opts?: {
  disabled?: ReadonlySet<NovelRuleId>
  baseCounts?: VariantCounts                // 他の話の辞書の表記ゆれ集計（createVariantCountCache）
  morph?: {
    tokens: MorphToken[][]                  // いまの話。blocks と同じ並び
    workVariants: AutoVariantCounts         // 作品全体の自動の表記ゆれ集計（Worker が作る）
    excluded: ReadonlySet<string>           // 用語集の名前・別名
  }
}): Finding[]

// decisions.ts
findingKey(f: Finding & { nth: number }): string
withNth(findings: Finding[]): Array<Finding & { nth: number }>
classify(findings, record?): { pending: F[]; fix: F[]; keep: F[] }
decide(record | undefined, ids: { workId: string; episodeId: string }, findings: F[], verdict: 'fix' | 'keep', now: number, blocks: Block[]): ProofreadRecord
  // blocks は保存済みの話の段落。各指摘の段落の plainTextOfBlock から occurrence（start より前の text の出現数）を数えて記録する
undecide(record, finding): ProofreadRecord
openFixes(record | undefined, blocks: Block[]): OpenFix[]   // blocks は reconcile 済みの下書き。OpenFix は判断＋段落の位置
locateFix(fix: OpenFix, draft: string): { start: number; end: number; whole: boolean }
  // 1) 段落のプレーン文字列で occurrencesOf(fix.text, plain)[occurrence] の位置（lineStart は先頭の1文字）を求める。
  // 2) draft の blockIndex 行に plainOffsetMap を当て、その位置を記法つきの行の位置に移す（ルビの読み・記法の記号は対応先に無いので選ばれない）。
  // 3) 移せない（参照の中など、対応が粗い区間にかかる）なら行全体を返し whole=true（呼び出し側がトーストを出す）。ほかの行は探さない

// parser/parseNotation.ts（追加）
plainOffsetMap(line: string): { plainText: string; toSource: (plainIndex: number) => number | null }
  // scanInlines と同じ走査で、プレーン文字（plainTextOfInlines と同じ並び）ごとに行の中の位置を返す。
  // 地の文字・傍点の中身・ルビの親文字は1文字ずつ正確に対応し、ルビの読み・《《》》・｜・[[ ]] の記号は対応先にならない。
  // 参照（[[…]]）の中は装飾が入れ子になりうるので1文字ずつは対応させず null を返す（区間全体の扱いは locateFix 側で行全体に倒す）

// morph/*
toMorphTokens(raw: RawToken[]): MorphToken[]
countAutoVariants(tokensByBlock: MorphToken[][], excluded): AutoVariantCounts
mergeAutoVariants(a, b): AutoVariantCounts
autoVariantFindings(block, tokens, counts, excluded): Finding[]
doubledParticleFindings(block, tokens): Finding[]
raNukiFindings(block, tokens, text): Finding[]
frequentWords(tokensByEpisode: MorphToken[][][], totalChars: number, excluded, limit = 10): { base: string; count: number; per10k: number }[]
dialogueRatio(blocks: Block[]): { dialogue: number; narration: number }
glossaryUserDictCsv(glossary: GlossaryEntry[]): string
```

### 品詞を使うルールの判定（IPADIC の `details` の並び＝品詞, 細分類1, 細分類2, 細分類3, 活用型, 活用形, 原形, 読み, 発音）

- 自動の表記ゆれ：対象は名詞（一般・サ変接続・形容動詞語幹・副詞可能・非自立）、動詞、形容詞、副詞。同じ語のキーは `品詞|細分類1|活用型|読み`。書き方は原形。キーを共有する書き方どうしを同じ組にまとめ、作品全体で2つ以上の書き方があり、違いが「漢字とかな」「同じ漢字で送り仮名違い」「ひらがなとカタカナ」のどれかの組だけを指摘する。用語集の語・固有名詞・`カスタム名詞`（ユーザー辞書）・数は外す
- 同じ助詞：文の区切りは「。！？」と括弧の出入り。助詞（`助詞` かつ 細分類1 が `格助詞` で表層形が「が・を・に・で・へ・から・より」、または `係助詞` の「は」）を順に見て、直前の助詞と表層形・細分類1が同じで、その間に読点（`記号,読点`）が無く、間に1語以上ある（隣り合わない）ときに1件。隣り合う「がが」は `successive-word` に任せる
- ら抜き：`動詞,自立` かつ活用型 `一段` かつ活用形 `未然形` の直後が `動詞,接尾` で原形 `れる`、または `動詞,自立` で原形が `来れる`／`見れる`。`insideQuotes` が真の位置は外す
- よく使う言葉：`副詞`（全細分類）と `形容詞,自立` を原形で数える。1文字の語と用語集の語は外す

### Worker と窓口

- 作品全体の集計は Worker で行う。Worker は core の `toMorphTokens`・`countAutoVariants`・`mergeAutoVariants`・`frequentWords` を import する（core は React も `src/ui/` も import しないので Worker から使える）
- メッセージ：
  - 受信 `{ type: 'init', userDictCsv: string, excluded: string[] }` → 送信 `{ type: 'progress', loaded, total }`（辞書の取得中だけ）→ `{ type: 'ready' }` か `{ type: 'error', reason: 'offline' | 'memory' | 'unsupported' | 'unknown' }`
  - 受信 `{ type: 'analyze', id, episodes: { id: string; hash: string; texts: string[] }[], currentId: string }` → 送信 `{ type: 'workProgress', done, total }` を話ごとに、最後に `{ type: 'analysis', id, currentTokens: RawToken[][], workVariants: AutoVariantCounts, frequent: FrequentWord[] }`（`RawToken = [surface, ...details]` の配列で軽くする）
  - 話ごとのトークンは Worker の中で `Map<"<episodeId>:<hash>", MorphToken[][]>` に持ち、編集していない話は解析し直さない。`hash` は画面側で話の段落テキストから作る（FNV-1a など軽い計算）
- 辞書：`/dict/lindera-ipadic-6.2.0.zip` を `caches.open('ns-dict-v1')` から読み、無ければ取得して入れる。`unzip.ts` で9ファイルを取り出し、`loadDictionaryFromBytes` に渡す。ユーザー辞書は `loadUserDictionaryFromBytes(csv, dictionary.metadata)` を**辞書を TokenizerBuilder に渡す前に**作る（渡した後は `metadata` が読めない。試験で確認）
- wasm：`lindera-wasm` の既定どおり `new URL('lindera_wasm_bg.wasm', import.meta.url)` で Vite がアセットとして出す。プリキャッシュから外し、runtimeCaching の CacheFirst で2回目以降はオフラインでも読める
- `analyzer-client.ts`：Worker の生成・`terminate()`・状態の自前ストア。`use-morph-analyzer.ts` が推敲画面のマウントで起動し、アンマウントで止める。用語集が変わったら Worker を作り直す。画面側が持つのは `analysis` の結果だけ

### App の配線

- `proofreadAvailable = Boolean(work && work.format !== 'script' && canUseStructure && proofreadRepo && !narrow)`
- 入口：`enterProofread = async () => { try { if (episode) await store.save(); setActiveScreen('proofread') } catch { show('保存できませんでした。下書きは残っています。もう一度お試しください') } }`（`openPublish` `:286-293` と同じ形）。サイドナビと「推敲画面を開く」の両方がこれを呼ぶ
- 「本文で直す」：`ProofreadView` の `onFixInEditor({ episodeId, decision })` → `setPendingFix({ episodeId, decision })` → `episodeId !== state.currentEpisodeId` なら `store.openEpisode(episodeId)`（`editorStore.ts:490`。PlotView の `onOpenEpisode` `App.tsx:524-527` と同じ）→ `setActiveScreen('episodes')`。effect は `pendingFix && activeScreen === 'episodes' && state.currentEpisodeId === pendingFix.episodeId && editorRef.current` のときだけ走る。`use-proofread-record` の record は話を切り替えた直後はまだ前の話のもの（読み込みは非同期）なので使わず、`pendingFix.decision` 1件だけを入れた仮の記録で `openFixes` を呼んで位置を求め、`locateFix(fix, state.draft)` → `selectRange` → `setPendingFix(null)`。その1件が既に直っていたら何もしない
- 「直す箇所」：`use-proofread-record` でいまの話の判断を読み、`openFixes(record, reconcileBlockIds(episode.blocks, parseEpisodeBody(state.draft)))` を `useMemo` で出す（判断に fix が無いときは計算しない）

## テスト計画

| 層 | 何を固定するか | 置き場所 |
|---|---|---|
| unit | 作法ルールと辞書の表記ゆれが当たる段落の集合が COT-30 と同じ（`novel-good.txt`／`novel-bad.txt` を含む）。出現ごとに出ること（「。」」2つ、奇数の「…」2か所、表記ゆれ2回、数2つ）と、各指摘の `start`・`end`・`text`・`anchor` | `src/core/proofread/rules.test.ts`・`variants.test.ts`・`index.test.ts`（`:44-50` の「1行1件」は出現ごとに書き換える） |
| unit | 品詞のルール（FR-8a〜c）の当たり外れ。「がが」が同じ助詞に出ないこと。辞書と自動の表記ゆれが重なると辞書の1件だけになり、`morph` の有無で辞書の指摘の `text`・範囲が変わらないこと。入力は `__fixtures__/` の実トークン | `src/core/proofread/morph/*.test.ts`・`index.test.ts` |
| unit | `toMorphTokens` の位置（全角・サロゲートペア・空白） | `morph/token.test.ts` |
| unit | よく使う言葉の上位10件と除外、セリフと地の文の割合（閉じない括弧・入れ子・空白を数えない） | `morph/frequent-words.test.ts`・`dialogue-ratio.test.ts` |
| unit | 判断：キーの一致、nth（同じ段落の2件目は別扱い）、`decide` が `occurrence` を数える、別段落の編集で残る、未知の verdict／anchor／code を落とさず読む、`occurrence` が無い記録は nth で代用、`openFixes` が文字列の消失・段落の削除で消える、「1つ目このまま・2つ目直す」で2つ目を直すと0件、「両方直す」で1つ目だけ直すと2件→1件、指摘にならない同じ文字列が混ざる3例（「鳥が飛んできた。彼にもできた。」・括弧の中と地の文の「見れ」・「仕事」と「事」）で直すと消え直す前は正しい出現を選ぶ、重なり合う指摘（「ご…ご…ごめん」の2つ目だけ直す：直す前は出て2つ目を選び、直すと消える）、`occurrencesOf` が重なりを数える、`locateFix` がルビの読みの中を選ばない（「｜言葉《ことば》と、ことば」）、参照の中にかかると行全体で `whole: true`、ほかの行を探さない | `src/core/proofread/decisions.test.ts` |
| unit | `plainOffsetMap` の `plainText` が `plainTextOfInlines(parseInlines(line))` と一致する（地の文・明示ルビ・自動ルビ・傍点・参照・未終端の記法・`novel-good.txt` の全行）。各プレーン文字の対応先が正しい | `src/core/parser/parseNotation.test.ts` |
| unit | ユーザー辞書 CSV（読みのひらがな→カタカナ、別名、カンマのエスケープ） | `src/core/proofread/user-dict.test.ts` |
| unit | repo の get/save/remove/removeByWork/replaceAll | `src/core/storage/proofreadRepository.test.ts` |
| unit | 旧バックアップ（`proofreads` 無し）を読める、新しい項目を往復できる | `src/core/backup/index.test.ts` |
| integration | 同期：proofread の列挙・pull・purgeLocal・競合（LWW で新しいほうを採り、`recordLost` が呼ばれない） | `src/ui/sync/sync-service.test.ts`（staging の describe `:684` に倣う） |
| integration | バックアップ：gather／replaceAll／restore／pullLive に proofreads | `src/ui/backup/backup-service.test.ts`・`import-dialog.test.tsx` |
| integration | 自動バックアップ：sync-touch だけでも静止判定のタイマーが動く | `src/ui/hooks/use-auto-backup.test.tsx` |
| integration | 作品の完全削除で判断も消える | `src/ui/store/editorStore.test.ts` |
| integration | 小説で推敲チェックが出ない／脚本の書式チェックは出る | `src/ui/components/EditorPane/editor-pane.test.tsx`（`:685-750` を置き換え） |
| integration | 「直す箇所」：件数、一覧、「その箇所へ移る」で `selectRange`、参照の中にかかって `whole: true` のとき行全体を選びトースト「その箇所だけを選べなかったため、段落全体を選びました」、入力で件数が減る、外す、Esc と外側で閉じる（Esc はボタンへフォーカスが戻る）、0件で出ない、脚本で出ない、「推敲画面を開く」は `canOpenProofread` のときだけ出て押すと呼ばれる、Tab で「その箇所へ移る」と「外す」の両方に届く、aria-label | `src/ui/components/FixListButton/fix-list-button.test.tsx` |
| integration | 入口：無料・有料で出る／ゲスト・脚本・狭幅で出ない／狭くすると戻る／入るとき保存する／保存に失敗したら移らずトースト。「本文で直す」：同じ話・別の話（`openEpisode` してから選択。判断の record の読み込みを遅らせても選択されること） | `src/ui/App.test.tsx`（`:290-342` の幅の作り） |
| integration | 判断の保存で sync-touch が起きる（`withSyncTouch` で包んだ repo の `save`） | `src/ui/sync/sync-touch.test.ts`（無ければ新規。包む関数の契約を固定し、Root では同じ包み方をする） |
| integration | 推敲画面：指摘の表示、判断、絞り込み、同じ指摘をまとめて、本文で直す、くわしい確認の状態（準備中・失敗・もう一度試す）、ボタンの読み上げ名とキーボード操作。解析器は窓口を差し替えた偽物 | `src/ui/components/ProofreadView/proofread-view.test.tsx` |
| integration | Worker の実物：Node で `initSync` と `public/dict/` の zip を使い、展開・ユーザー辞書・analyze（作品全体の集計）が通る | `src/ui/proofread/analyzer.node.test.ts` |
| e2e | ゲストの小説で推敲チェックが出ない、脚本の書式チェックは出る（PC・スマホ）。執筆画面を操作しても `.wasm` と `/dict/` へのリクエストが起きない（`page.on('request')`） | `e2e/smoke.spec.ts`・`e2e/mobile.spec.ts` |
| build | `dist/sw.js` に `.wasm` と `/dict/` が入らない | `scripts/check-precache.mjs`（`postbuild`） |
| 手動 | stg で Chrome・Safari・Firefox：初回の読み込み時間、Worker と画面側のメモリ（30万字の作品を含む）、作品全体の初回解析が10秒以内か、2回目のオフライン、失敗時の表示 | stg（結果は design.md の実装メモへ） |

e2e は常にゲストで動く（`playwright.config.ts`）ので、無料会員以上の推敲画面は integration で固定する。

## リスク・未決事項

- メモリ：Node の試験で常駐 約230MB。PC 専用でも古いノート PC では重い。Worker が落ちたら `error` を拾って「くわしい確認は、いまは使えません。」に倒す。実装の最初に Chrome の Task Manager で計測し、実装メモに残す
- lindera-wasm の更新：6.x の間に辞書の形式が変わった前例がある（`dict.da`→`dict.trie`）。npm の版と辞書 zip の版を必ず揃え、`fetch-dict.mjs` に版とハッシュを並べて持つ
- ビルド時のネットワーク：`prebuild` が GitHub Releases に依存する。取れないとビルドが失敗する（黙って辞書なしで出さない）。CI のキャッシュに `public/dict/` を載せる
- `functions/_middleware.ts:121-124` は stg で本文を包み直す。zip の配信が壊れないかを stg で確かめる
- 旧版タブによる判断の消失（requirements.md 仮定 A5）：原稿には影響しない。退避一覧に載せないので戻せない
- ユーザー辞書の副作用：試験で「ユイナと」の「と」がフィラーになった。助詞の判定に漏れが出るだけで誤検知は増えない
- 出現ごとに出すことで、COT-30 より件数が増える。推敲画面は作者が開いたときだけ見るので、執筆中のノイズにはならない

## 実装メモ（2026-10-14・実装時に設計から変えた点と計測）

- 前提の確認：`lindera-wasm` 6.2.0 は Worker の中で `init()`→辞書 zip の展開→`loadDictionaryFromBytes` まで動いた。計測（headless Chromium・dev サーバ）は、準備 0.56秒、1万字の解析 75ms、30万字（30話）の作品全体の解析 1.3秒、ブラウザ全体のメモリの増え方 約205MB。本番ビルド（`vite preview`）では、初回の準備 0.41秒（wasm と辞書を取得）、2回目 0.29秒（辞書は Cache Storage から読み、`/dict/` へは行かない）
- Worker の本体は `src/ui/proofread/analyzer-engine.ts` に分けた（lindera と辞書の取得を外から渡す）。`analyzer.worker.ts` はメッセージの受け渡しだけ。Node のテスト（`analyzer.node.test.ts`）で実物の lindera と辞書を動かせる。型は `src/ui/proofread/protocol.ts`
- Worker からは、いまの話のトークンを `MorphToken` の配列のまま返す（`RawToken` に詰め直さない）。作品全体のトークンは Worker の中だけに持つ方針は変えていない
- 同期の列挙は `ProofreadRepository.listRaw()`（生のまま）を使い、Zod で読めない判断は masked に回す。`list()` のように黙って外すと、同期の計画が「端末で消した」と受け取り、ほかの端末の判断まで消すため。`sync-service.ts` の `recordLost` は proofread のとき何もしない（退避一覧に載せない設計を型でも守る）
- 一文の中の同じ助詞：目視で「何かが動いた気がした」の「が動いた気が」に出たので、述語（動詞・形容詞・助動詞）を挟む場合は別の節として出さない判定を足した（requirements.md FR-8b に追記）
- 品詞ルールのテストは、実際の lindera の出力を `scripts/gen-morph-fixtures.mjs` で `morph/__fixtures__/samples.json` に固定して使う（テスト専用の読み口は `morph/fixtures.ts`）
- `variants.ts` の `variantNoticesForLine`（COT-30 の1行1件）は `variantFindingsForLine`（出現ごと）に置き換えた
- 手動の確認で残っているもの：stg での Safari・Firefox の動作、実機のメモリ
- 実装後のユーザー要望（2026-10-14）：「確認する項目」は最初から開き、どの項目も選ばれていない状態から作者が選ぶ。記憶は localStorage `ns-proofread-on`（選んだ項目）に替えた（旧 `ns-proofread-off` は意味が逆なので読まない）。項目のチップにホバー・フォーカスで説明（`NOVEL_RULES[].description`・shadcn の `Tooltip`）を出す。チップの高さは 44px からプロット画面のタブ（`ViewTab`）と同じ 28px にそろえた。本文の印から選んだ指摘は、右の一覧をそのカードまで送る

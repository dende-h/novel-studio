# 設計 — COT-30 小説の推敲チェック（表記ゆれと原稿の作法）

プロトタイプ: https://claude.ai/artifact/5J3y2BLPxT8YjTskosUxm3（ローカル: `docs/specs/COT-30/prototype.html`）

## 方針

- 脚本の書式チェックの仕組みをそのまま横に広げる。「本文の記法テキスト → `parseEpisodeBody` → `Block[]`（1 行＝1 block、`src/core/parser/parseNotation.ts:34-43`）→ 純関数が `{ blockIndex, code, message }[]` を返す → エディタ下部の `<details>` で一覧し、押すと行を選択」（`src/ui/components/EditorPane/editor-pane.tsx:71-74, 413-443`）。
- ルールは `src/core/proofread/` に純 TS で新設する。textlint は載せない。`tools/novel-textlint/.textlintrc.novel.json` の調整値（行頭許可文字・`《》` の許容）をそのまま定数に写し、同じフィクスチャ（`tools/novel-textlint/fixtures/novel-{good,bad}.txt`）で回帰を固定する。
- 表記ゆれは「作品全体で数え、いまの話の行を候補にする」。他の話の集計は `App.tsx` 側で `work.episodes` を鍵に memo し、EditorPane にはその集計だけを渡す。EditorPane 内で編集中の本文の分を足して判定する（core の `proofreadNovel` が合算する）。
- 項目のオン／オフは端末設定（localStorage）。`use-preferences.ts` と同型の最小ストアを足す。スキーマ・同期・バックアップには触れない。
- 既存の脚本側の `<details>` は見た目を変えずに `ProofreadPanel` 部品へ切り出し、小説と共有する（文言・件数・ジャンプの挙動は現状どおり。`editor-pane.test.tsx` の既存ケースで固定）。
- 捨てた案：(1) `textlint` の kernel をブラウザバンドルに載せる → 依存とバンドルが増え、kuromoji 系ルールはどのみち動かない。(2) 表記ゆれを形態素解析で自動検出 → 辞書を載せられない。(3) オン／オフを `Work` に保存 → スキーマ変更と同期の波及が要るのに、表示の好みでしかない。

## 変更ファイル

| 種別 | パス | 責務 / 変更内容 | 要件ID |
|---|---|---|---|
| 新規 | `src/core/proofread/types.ts` | `ProofNotice { blockIndex: number; code: string; message: string }`（`ScriptNotice`（`src/core/script/proofread.ts:5-18`）と同じ形。UI はこの形だけ見る）。`NovelRuleId = 'indent' \| 'punct-before-close' \| 'space-after-exclamation' \| 'leader-odd' \| 'halfwidth-punct' \| 'successive-word' \| 'variant'`。`NOVEL_RULES: { id, label }[]`（切替ボタンの並び順と表示名） | FR-2, FR-6 |
| 新規 | `src/core/proofread/rules.ts` | 作法ルール。`checkLine(text: string): { code: NovelRuleId; message: string }[]`。行頭許可文字 `LEADING_ALLOWED = '　「『【〈《（(“"‘\'［[〔｛{—…―–＊｜'`。日本語文字クラス `JA = /[ぁ-んァ-ヶ一-龯々ー]/`。1 行につき同じ code は 1 件 | FR-2, FR-3 |
| 新規 | `src/core/proofread/variants.ts` | 表記ゆれ辞書 `VARIANT_GROUPS: { id, forms: string[], exclude?: RegExp }[]`、助数詞 `COUNTERS`、`countVariants(texts: string[]): VariantCounts`（組ごと・書き方ごとの件数）、`mergeCounts(a, b)`、`variantNoticesForLine(text, counts)` | FR-4 |
| 新規 | `src/core/proofread/index.ts` | `proofreadNovel(blocks: Block[], opts: { disabled?: ReadonlySet<NovelRuleId>; baseCounts?: VariantCounts }): ProofNotice[]`。各 block を `plainTextOfBlock`（`src/core/game/index.ts:212`）で文字列化し、`checkLine` と `variantNoticesForLine` を回す。`countVariantsInBlocks(blocks: Block[]): VariantCounts` と `createVariantCountCache(): (episodes: Episode[]) => VariantCounts`（`WeakMap<Episode, VariantCounts>` で話ごとに集計を覚え、参照が同じ話は再計算しない。結果は `mergeCounts` で合算）も export。入力の `Block[]` は書き換えない | FR-2〜FR-4 |
| 新規 | `src/core/proofread/rules.test.ts` `variants.test.ts` `index.test.ts` | FR-2〜FR-4 の受け入れ条件。フィクスチャは `tools/novel-textlint/fixtures/novel-{good,bad}.txt` を `readFileSync` で読む | FR-2〜FR-4 |
| 新規 | `src/ui/hooks/use-proofread-prefs.ts` | `useProofreadPrefs(): { disabled: ReadonlySet<NovelRuleId>; toggle(id: NovelRuleId): void }`。`useSyncExternalStore` ＋ localStorage `ns-proofread-off`（JSON 配列）。読み書きは try/catch（`use-preferences.ts:23-41` と同じ）。snapshot の `disabled` は `toggle` のときだけ新しい `Set` に差し替え、それ以外は同じ参照を返す（`use-preferences.ts:48-52` の `state` 差し替え方式。毎回 new Set にすると `useSyncExternalStore` が無限再描画し、`notices` の memo も効かない） | FR-6 |
| 新規 | `src/ui/components/EditorPane/proofread-panel.tsx` | `<details>` 部品。props `{ title: string; intro: string; notices: ProofNotice[]; onJump(blockIndex): void; toggles?: { items: { id, label }[]; disabled: ReadonlySet<string>; onToggle(id): void } }`。現状の `editor-pane.tsx:413-443` の markup をそのまま移す。`toggles` があるときだけ「確認する項目」の行を描く | FR-1, FR-5, FR-6 |
| 変更 | `src/ui/components/EditorPane/editor-pane.tsx:13, 29-37, 71-74, 413-443` | props に `variantBase?: VariantCounts` を追加。`notices` の `useMemo` を `scriptMode ? proofreadScript(...) : proofreadNovel(blocks, { disabled, baseCounts: variantBase })` に。`<details>` を `ProofreadPanel` に置き換え、脚本は現状の文言、小説は新文言＋ `toggles` を渡す。ジャンプ関数は現状の `setSelectionRange`（:424-434）を `onJump` に移す | FR-1, FR-5, FR-6 |
| 変更 | `src/ui/App.tsx:747-753` | `variantBase` を渡す。`const variantCache = useMemo(() => createVariantCountCache(), [])` を置き（`useRef(create())` だと描画ごとに factory が走って WeakMap を捨てる）、`useMemo(() => !work \|\| work.format === 'script' ? undefined : variantCache(work.episodes.filter(e => e.id !== state.currentEpisodeId)), [work, state.currentEpisodeId])`。自動保存（`use-autosave.ts` の 800ms）のたびに `save()` が `work.episodes` を map で作り直すが、編集していない話の `Episode` 参照は変わらない（`editorStore.ts:362-377`）ので、話ごとのキャッシュが効く | FR-4 |
| 変更 | `src/ui/components/EditorPane/editor-pane.test.tsx` | 小説モードで `<details>` が出る・候補を押すと行が選択される・切替で候補が消える・脚本モードは従来どおり、を追加 | FR-1, FR-5, FR-6 |
| 変更 | `src/ui/components/HelpPage/help-page.tsx:50-75` | 「基本の使い方」に `HowTo term="推敲する"` を 1 つ追加（本文の下の「推敲チェック」・候補を押すと該当行を選択・本文は書き換えない・項目はオフにできる） | FR-1 |
| 変更 | `docs/CODEMAP.md:36, 87` | §1 に「小説の推敲チェック（作法・表記ゆれ）」の行、§2 に `proofread/` の行を追加 | — |

`src/core/proofread/` は React と `src/ui/` を import しない。既存の `src/core/script/proofread.ts` は触らない。

## データモデル

変更なし。`Work`・`Episode`・`Block` のスキーマは据え置き。候補は保存物に入らない。

端末設定（localStorage）：

```
key: 'ns-proofread-off'
value: JSON 配列 — オフにした NovelRuleId（例 ["successive-word","variant"]）
読めない・壊れている・未知の id → 無視して「すべてオン」
```

同期・バックアップ・publish・MCP への波及なし。

### core の型

```ts
// src/core/proofread/types.ts
export interface ProofNotice { blockIndex: number; code: string; message: string }
export type NovelRuleId =
  | 'indent' | 'punct-before-close' | 'space-after-exclamation'
  | 'leader-odd' | 'halfwidth-punct' | 'successive-word' | 'variant'
export const NOVEL_RULES: ReadonlyArray<{ id: NovelRuleId; label: string }> = [
  { id: 'indent', label: '字下げ' },
  { id: 'punct-before-close', label: '閉じ括弧の前の句読点' },
  { id: 'space-after-exclamation', label: '！？の後の空白' },
  { id: 'leader-odd', label: '三点リーダー・ダッシュ' },
  { id: 'halfwidth-punct', label: '半角の約物' },
  { id: 'successive-word', label: '同じ語の連続' },
  { id: 'variant', label: '表記ゆれ' },
]

// src/core/proofread/variants.ts
export interface VariantGroup { id: string; forms: string[]; exclude?: RegExp; kind?: 'word' | 'numeral' }
/** 組ID → 書き方 → 件数。数の書き方は forms = ['算用', '漢数字'] の 2 択で数える。 */
export type VariantCounts = Record<string, Record<string, number>>
export function countVariants(texts: string[]): VariantCounts
export function mergeCounts(a: VariantCounts, b: VariantCounts): VariantCounts

// src/core/proofread/index.ts
export function proofreadNovel(
  blocks: Block[],
  opts?: { disabled?: ReadonlySet<NovelRuleId>; baseCounts?: VariantCounts },
): ProofNotice[]
export function countVariantsInBlocks(blocks: Block[]): VariantCounts
/** 話ごとの集計キャッシュ。同じ Episode 参照には前回の結果を返す。 */
export function createVariantCountCache(): (episodes: Episode[]) => VariantCounts
```

## ロジック

### 作法ルール（`rules.ts`・行単位・プレーン文字列）

| code | 判定（text は `plainTextOfBlock` の結果。空白だけなら全部スキップ） |
|---|---|
| `indent` | `!LEADING_ALLOWED.includes(text[0])` |
| `punct-before-close` | `/[。、][」』）]/u` |
| `space-after-exclamation` | `/[！？](?![！？　 …―」』）〕】〉》]|$)/u`（`$` は行末。`m` フラグは使わない。1 行 1 文字列。「！……」「！――」は例外） |
| `leader-odd` | `/…+/g` の各一致で長さが奇数 → 「三点リーダー…」／ `/―+/g` で奇数 → 「ダッシュ…」／ `/・{2,}/` → 「中黒ではなく…」。この順で最初に当たった 1 件だけ |
| `halfwidth-punct` | `JA[!?]` または `[!?]JA` → 感嘆符の文言、`JA[,.]` または `[,.]JA` → 句読点の文言。どちらも当たれば感嘆符を優先し 1 件 |
| `successive-word` | (a) `/がが|をを|(?<!ま)でで|(?<!な)にに|(?<![ひっ])とと(?!もに)|(?<!も)のの/u` （「までで・なにに・ひとと・ちょっとと・とともに・ものの」を外す） (b) `/([^\s、。！？「」『』（）…―・]{2,6})\1/gu` で隣り合う繰り返しを取り、**TS 側で捕捉 `m[1]` に漢字 `/[一-龯々]/u` が含まれるときだけ**候補にする（正規表現に先読みは入れない。先読みだと「どきどき胸が」のように畳語の直後の漢字を拾ってしまう）。「言った言った」「今日は今日は」に当たり、「どきどき胸が」「ますます強く」「きらきら光る」「ところどころ」には当たらない（node で確認済み）。メッセージには当たった文字列を括弧で添える |

- `plainTextOfBlock` はルビを親文字、傍点を本文、`[[参照]]` を名前に落とすので、記法の記号は検査文字列に残らない（`src/core/game/index.ts:195-214`）。ただし **行頭の `｜`・`《`・`[` は記法を解いた後は消える**ので、`LEADING_ALLOWED` にこれらが入っているのは生テキストで検査する場合の保険にすぎない。設計はプレーン文字列を正とする。
- 脚本の `proofreadScript` との共存：`scriptMode` で完全に分岐する。小説の本文に `○` で始まる行があっても小説ルールだけが走る。

### 表記ゆれ（`variants.ts`）

- `countVariants(texts)`：各組について、`exclude` に当たる箇所をマスクしてから各 `forms[i]` の出現回数を数える。数の書き方は `/[0-9０-９]+(人|つ|日|年|月|回|本|枚|匹|個|歳|時|分|階|度|番|台|冊|杯|件|名|歩|秒)/gu` を「算用」、`/[一二三四五六七八九十百千]+(同じ助数詞)/gu` を「漢数字」として数える。
- `variantNoticesForLine(text, counts)`：counts で 2 つ以上の書き方が 1 件以上ある組だけを対象に、その行に含まれる書き方を探し、含まれていれば 1 件（組ごと）。メッセージ：
  - 語：`「出来る」と「できる」が混ざっています（この作品で 出来る 3件・できる 12件）。どちらかに揃えると読みやすくなります。`（3 つ以上の組は「・」でつなぐ。この行にある書き方を先頭に置く）
  - 数：`数の書き方が算用数字と漢数字で混ざっています：人（2人・三人／算用 4件・漢数字 2件）。`（助数詞ごとに、この行で見つかった実例・作品内で最初に見つかった反対側の実例・件数。複数の助数詞は「・」でつないで 1 行 1 件）
- `proofreadNovel` は `mergeCounts(baseCounts ?? {}, countVariants(当該 blocks のプレーン文字列))` を作ってから各行を回す。`disabled` に `'variant'` があれば集計そのものを省く。

### 表記ゆれ辞書（初版・`variants.ts`）

各組は `{ id, forms: { label, re }[], exclude?: RegExp }`。`re` は `u` フラグ付き。`exclude` に当たる箇所は先にマスクしてから数える。活用語は語幹で取り、熟語に化ける字は直前の活用語尾（た・る・う・い・の など）や直後の助詞で縛る。数の書き方は別扱い（`kind: 'numeral'`）。

| id | 書き方（label → re） | exclude |
|---|---|---|
| dekiru | 出来る → `出来[るたなまれず]` ／ できる → `(?<![んい])でき[るたなまれず]`（「飛んできた」の撥音便と「急いできた」のイ音便を外す。副作用として「お願いできる」「お会いできて」のような い＋できる も数えない＝取りこぼしは許容し、`variants.test.ts` に固定する） | `出来事\|出来心\|上出来\|不出来\|出来高\|出来栄` |
| koto | 事 → `[たるういのなくすつぬぶむぐ]事[がをにはもでだ]` ／ こと → `[たるういのなくすつぬぶむぐ]こと[がをにはもでだ]` | `[仕用大無返火食家物]事\|事[件情実故務業]` |
| toki | 時 → `[たるういのくすつぬぶむぐ]時[にはもを、]` ／ とき → `[たるういのくすつぬぶむぐ]とき[にはもを、]` | `時[間計代期刻々折速差点]\|[当同一瞬臨常日何潮]時` |
| iu | 言う → `言[うっわえお]` ／ いう → `[とて]い[うっわえお]` | — |
| teiru | ている → `[てで]い[るたれなま]` ／ て居る → `[てで]居[るたれなま]` | — |
| nai | ない → `[がはも]ない` ／ 無い → `[がはも]無[いくかけ]` | — |
| tame | ため → `ため[にのだ]` ／ 為 → `為[にのだ]` | `[行作無人]為\|為[替政]` |
| you | よう → `[たるういのくすつぬぶむぐ]よう[にだなで]` ／ 様 → `[たるういのくすつぬぶむぐ]様[にだなで]` | `様[子式々]\|模様` |
| kurai | くらい → `[くぐ]らい` ／ 位 → `[れのたるいう]位[いだでのかに]` | `位置\|[地順単品首王学上下]位` |
| made | まで → `まで` ／ 迄 → `迄` | — |
| hodo | ほど → `ほど` ／ 程 → `程` | `程[度遠近]\|[過日工行旅射]程` |
| sarani | さらに → `さらに` ／ 更に → `更に` | — |
| sudeni | すでに → `すでに` ／ 既に → `既に` | — |
| subete | すべて → `すべて` ／ 全て → `全て` | — |
| choudo | ちょうど → `ちょうど` ／ 丁度 → `丁度` | — |
| anata | あなた → `あなた` ／ 貴方 → `貴方` | — |
| kodomo | 子ども → `子ども` ／ 子供 → `子供` | — |
| kirei | きれい → `きれい` ／ 綺麗 → `綺麗` | — |
| takusan | たくさん → `たくさん` ／ 沢山 → `沢山` | — |
| sasuga | さすが → `さすが` ／ 流石 → `流石` | — |
| tokoro | ところ → `[たるういのくすつぬぶむぐ]ところ[がでにをへもだ]` ／ 所 → `[たるういのくすつぬぶむぐ]所[がでにをへもだ]` | `[場近台住箇]所\|所[持属有長々]` |
| mono | もの → `[たるういなのくすつぬぶむぐ]もの[がでにをへもだ]` ／ 物 → `[たるういなのくすつぬぶむぐ]物[がでにをへもだ]` | `物[語音陰事]\|[動植人荷品怪建本食]物` |
| itadaku | いただく → `いただ[くきけい]` ／ 頂く → `頂[くきけい]` | `頂[上点]\|[絶山]頂` |
| kudasai | ください → `ください` ／ 下さい → `下さい` | — |
| itasu | いたす → `いた(?:し(?=ま)|す(?=[。、」）]|$)|せ(?=ば))` ／ 致す → `致(?:し(?=ま)|す(?=[。、」）]|$)|せ(?=ば))`（「し」は「ます・ました」、「す」は句読点・閉じ括弧・行末、「せ」は「ば」が続くときだけ数える。イ音便の語幹は漢字なので後読みでは外せず、すべて直後で縛る。node で「泣いたせいで／聞いたすぐ後／書いたせいか／書いたし」が外れ、「お願いいたします／失礼いたしました／いたせば／そういたす。」が当たることを確認。「いたしております」「いたした」「いたす！」は数えない取りこぼしで、`致` 側も同条件なので件数は偏らない。許容して `variants.test.ts` に固定） | `致[命死]\|[一合]致` |
| aru | ある → `[がはも]あ[るっり]` ／ 有る → `[がはも]有[るっり]` | — |
| yoi | いい → `[がはもてでに]いい` ／ よい → `[がはもてでに]よ[いくかけ]` ／ 良い → `良[いくかけ]` | `仲良\|良[心好質品]\|[改優不善]良` |
| bokutachi | 僕たち → `僕たち` ／ 僕達 → `僕達` | — |
| watashitachi | 私たち → `私たち` ／ 私達 → `私達` | — |
| karera | 彼ら → `彼[女]?ら(?![しせ])`（「彼らしい」を外す） ／ 彼等 → `彼[女]?等` | — |
| tonikaku | とにかく → `とにかく` ／ 兎に角 → `兎に角` | — |
| doko | どこ → `どこ` ／ 何処 → `何処` | — |
| naze | なぜ → `なぜ` ／ 何故 → `何故` | — |
| zehi | ぜひ → `ぜひ` ／ 是非 → `是非` | `是非[をもの]` |
| hotondo | ほとんど → `ほとんど` ／ 殆ど → `殆ど` | — |
| shibaraku | しばらく → `しばらく` ／ 暫く → `暫く` | — |
| masumasu | ますます → `ますます` ／ 益々 → `益々` | — |
| dandan | だんだん → `だんだん` ／ 段々 → `段々` | `段々畑` |
| yahari | やはり → `や[はっ]ぱ?り` ／ 矢張り → `矢張り` | — |
| chotto | ちょっと → `ちょっと` ／ 一寸 → `一寸` | `一寸先\|一寸法師` |
| metta | めったに → `めった[にな]` ／ 滅多 → `滅多[にな]` | — |
| numeral:〈助数詞〉（kind: numeral・助数詞ごとに 1 組） | 算用 → `[0-9０-９]+(?=〈助数詞〉)` ／ 漢数字 → `[一二三四五六七八九十百千]+(?=〈助数詞〉)` | 助数詞 = 人・つ・日・年・月・回・本・枚・匹・個・歳・時・分・階・度・番・台・冊・杯・件・名・歩・秒。共通 exclude = `十分\|何分\|数分\|大分\|半分\|随分\|当分\|多分\|自分\|気分\|一時的\|[一二三四五六七八九十百千]+分の`。同じ助数詞で両方あるときだけ混在。1 行の numeral の候補は 1 件にまとめ、メッセージは「数の書き方が算用数字と漢数字で混ざっています：人（2人・一人／算用 2件・漢数字 1件）・年（…）。」 |

- 各組の「当たらない例」（飛んできた・急いできた・仲良く・彼らしい・書いたし・聞いたして・ものの・十分に・三分の一）と「当たる例」（できた・手でできた・お願いいたします・失礼いたしました・いたせば）、「数えない取りこぼし」（お願いできる・お会いできて・いたしております・いたした）を `variants.test.ts` に置く。外れ例には「泣いたせいで」「聞いたすぐ後」も加える。
- 辞書は「作品内で 2 つ以上の書き方が 1 件以上あるとき」にしか候補を出さないので、作品を通して 1 つの書き方に統一している語は何も言わない。
- `tools/novel-textlint/` には対応するルールが無い（textlint 側は AI 常套句辞書のみ）。将来 textlint 側へ同じ辞書を移すときは `variants.ts` を正とする。

### UI の状態と再計算

- `App.tsx`：`variantBase` は `createVariantCountCache()` で話ごとに集計をキャッシュして合算する。自動保存（800ms 静止ごと）で `work.episodes` 配列は作り直されるが、編集していない話の `Episode` 参照はそのままなので再計算は起きない（`editorStore.ts:362-377`）。保存した話だけ 1 話分を数え直す。脚本作品では `undefined`。
- `EditorPane`：`notices = useMemo(() => scriptMode ? proofreadScript(blocks, { cast }) : proofreadNovel(blocks, { disabled, baseCounts: variantBase }), [scriptMode, value, cast, disabled, variantBase])`。`blocks = parseEpisodeBody(value)` は現状どおり毎回。
- 件数（見出し）はオンの項目の候補数＝`notices.length`。オフの項目は core で最初から生成しない。

## UI

### 画面: 執筆（ルート `#/write`、本文の面）

現状: `screens/editor-novel-desktop.png`（小説。本文の下に何も無い）／`screens/editor-script-desktop.png`（脚本。`<details>` が本文の下に出ている＝流用する見た目）

変更点（番号はプロトタイプと対応）:

1. 本文の下に `<details>`「▼ 推敲チェック（確認候補 N件）」。位置・余白・文字サイズ・境界線は脚本のもの（`border-t border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant`）と同一。
2. 開くと説明文 1 段落：「原稿の作法と表記ゆれの確認候補です。本文は自動で書き換えません。意図した表現なら、そのまま使えます。」
3. その下に「確認する項目」の行：ラベル＋7 つの小さなトグルボタン（`rounded-full border px-3 min-h-11 text-xs`、オン＝`bg-primary-container text-on-primary-container border-transparent`、オフ＝`border-outline-variant/40 text-on-surface-variant line-through なし`、`aria-pressed`）。横に並べて折り返す（`flex flex-wrap gap-1.5`）。
4. 候補一覧：「N行：メッセージ」のボタン（既存と同じ `min-h-11 w-full py-1 text-left hover:text-primary`）。`max-h-32 overflow-y-auto` も同じ。
5. 候補を押す → 該当行を選択（FR-5）。

状態:
- 空の本文／候補 0 件：見出し「推敲チェック（確認候補 0件）」、説明文と項目行だけ。一覧は描かない。
- 読み込み中・エラー・オフライン：該当なし（純ローカル・同期処理）。
- ゲスト／無料／有料：差なし。
- 項目をすべてオフ：見出し 0 件。説明文と項目行だけ。
- 脚本作品：従来の「脚本の書式チェック」のまま（項目行なし）。

モバイル（lg 未満・`screens/editor-script-mobile.png` 参照）:
- 同じ `<details>` が本文の下に出る。textarea にフォーカス中は記法バー（`fixed`・`notation-bar.tsx:24`）が下端を覆うので、候補を見るには本文の外を一度押す。候補を押すとフォーカスが戻って再び隠れる（現状の脚本と同じ挙動。改善は別 issue）。
- 項目のトグルは折り返して 2〜3 行になる。`min-h-11` で指で押せる。

使う共通部品: 既存の `<details>`／`<button>` の素の markup（脚本側と同じ）。shadcn の `Button` は使わない（脚本側が使っていないため統一）。`cn()` のみ。

文言（toc-copy の作法：短く・利用者の言葉・押しつけない）:
- 見出し：`推敲チェック（確認候補 N件）`
- 説明：`原稿の作法と表記ゆれの確認候補です。本文は自動で書き換えません。意図した表現なら、そのまま使えます。`
- 項目行ラベル：`確認する項目`
- 項目：`字下げ` `閉じ括弧の前の句読点` `！？の後の空白` `三点リーダー・ダッシュ` `半角の約物` `同じ語の連続` `表記ゆれ`
- 候補の各メッセージ：requirements.md FR-2／FR-4 の表のとおり
- ヘルプ（基本の使い方）：`推敲する` — 「本文の下の「推敲チェック」で、字下げ・閉じ括弧の前の句読点・！？の後の空白・三点リーダーとダッシュの数・半角の約物・同じ語の連続・作品内の表記ゆれ（出来る／できる、2人／二人 など）を確認できます。候補を押すと該当行を選択します。本文は自動で書き換えません。要らない項目は「確認する項目」でオフにできます。」

## テスト計画

| 層 | 何を固定するか | 置き場所 |
|---|---|---|
| unit | FR-2 各 code の当たり／外れ（表の例文 1 つずつ）、記法行（ルビ・傍点・参照・`＊`）で候補 0、`novel-good.txt` で 0 件、`novel-bad.txt` で期待 code 一覧、入力 `Block[]` 不変 | `src/core/proofread/rules.test.ts` `index.test.ts` |
| unit | FR-4：混在で候補・統一で 0・除外語（仕事・事件）・数の混在・`baseCounts` との合算・`disabled` で集計省略・1 行 1 組 1 件 | `src/core/proofread/variants.test.ts` `index.test.ts` |
| integration | FR-1：小説モードで「推敲チェック（確認候補 N件）」が出る、脚本モードでは出ない。FR-5：候補クリックで `selectionStart/End` が行の範囲。FR-6：トグルで候補が消え件数が減る、localStorage に `ns-proofread-off` が書かれる、壊れた値でも落ちない | `src/ui/components/EditorPane/editor-pane.test.tsx`、`src/ui/hooks/use-proofread-prefs.test.ts` |
| e2e | 任意：作品作成→本文入力→「推敲チェック」を開く→候補を押す→選択される（`e2e/smoke.spec.ts` のヘルパ流用）。CI 時間を見て 1 本だけ | `e2e/smoke.spec.ts` |

## リスク・未決事項

- 誤検知：`successive-word` (b) は漢字を含む畳語（一人一人・一つ一つ・日に日に・何度も何度も・見て見て・走って走って）を候補にする。実装では区別しない（項目オフで逃がす。受け入れ条件には入れない）。また `successive-word` の近似と表記ゆれ辞書の部分一致（「様」「所」「物」「事」「時」）は除外パターンで抑えるが、作風によっては拾う。項目オフで逃がせる。初期辞書は U1 としてリリース後に見直す。
- 性能：他話の集計は話ごとにキャッシュする（`createVariantCountCache`）。作品を開いた直後の初回だけ全話を数えるので、数百話の作品で数十 ms 掛かる可能性はあるが 1 回きり。単体テストで「同じ `Episode` 参照には再計算しない」を固定する。
- モバイルで記法バーが `<details>` を覆う既存挙動（脚本と同じ）。本 issue では直さない。
- 「推敲チェック」と `tools/novel-textlint` の二重管理：辞書と行頭許可文字は手で揃える。README に相互参照を書く。

## 実装メモ（2026-10-07・実装時に設計から変えた点）

- `VariantCounts` は `Record<組ID, Record<表示名, { count, example }>>`。数の書き方のメッセージに実例（2人・一人）を出すため、件数だけでなく作品内で最初に見つかった実例も持つ。`mergeCounts` は件数を足し、実例は左を優先する。
- 数の書き方の正規表現は助数詞を先読みでなく本体に含める（`[0-9０-９]+人`）。件数は同じで、実例をそのまま表示に使える。
- `space-after-exclamation` の式は `/[！？](?=[^！？　 …―」』）〕】〉》])/u`。設計表の `(?![…]|$)` は `|$` が選択肢の外に出て常に当たる誤りだったので、「直後に本文の文字がある」の肯定先読みに直した（テストで行末・閉じ括弧・…―の外れを固定）。
- `ProofreadPanel` の「確認する項目」は `<fieldset>`＋`<legend>`（Biome の `useSemanticElements` が `div role="group"` を弾くため）。見た目は同じ。
- `useProofreadPrefs` はテスト用に `reloadProofreadPrefs()` を export（localStorage を読み直す）。
- `pnpm lint`（`biome check .`）は WSL で OOM になるため、ネイティブバイナリで変更ファイルを検査した（既存ファイルの `noNonNullAssertion` 等は本変更と無関係）。

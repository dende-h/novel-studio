# 設計 — COT-62 推敲画面に作品ごとの「例外」と「表記の好み」を足し、選んだ結果から決まりを提案する

プロトタイプ: https://claude.ai/artifact/MESp3mnKQwgzkLbPZpuRjx （非公開）／ローカル `docs/specs/COT-62/prototype.html`

## 方針

- 作品の決まり（例外・表記の好み・提案しない言葉）を、作品ごとに1件の新しい kv レコード `proofread-rules:<workId>` に置く。同期・バックアップの配線は COT-59 の外した語（`proofread-names:`）と同じ形にする。
- 指摘（`Finding`）に、決まりを当てるための手がかりを省略できる欄として足す：
  - `rule`：例外のキーと表示名
  - `variant`：表記ゆれの組と書き方
- 決まりの当て方は、種類で分ける：
  - 例外：`proofreadNovel` の最後で指摘を取り除く
  - 表記の好み：表記ゆれの指摘を作る段で当てる。好みの書き方は出さず、混ざっていなくても好みでない書き方を出すため
- 提案は、作品の全話の判断（`ProofreadRepository.listByWork`）を数えて、画面側で1件だけ作る。勝手に決まりは作らない。
- 文言に「辞書」を使わない。区切り（解析）は変えない。

### 捨てた代替案

- 決まりを COT-59 の `proofread-names:` の記録に欄を足して持つ案：COT-59 の版のクライアントは、未知の欄を同期の `canonicalJson`（`src/core/sync/hash.ts:10`）と Zod で落とす。stg にある COT-59 の版が保存し直すと、決まりが消える。
- 決まりを推敲の判断（話ごと）の記録に持つ案：決まりは作品単位。話ごとの記録に入れると、話の削除や話ごとの同期に巻き込まれる。
- 例外を一文の中の同じ助詞や字下げにも付ける案：
  - 字下げなどは「確認する項目」で項目ごと止められる（`src/ui/components/ProofreadView/rule-toggles.tsx`）
  - 同じ助詞の指摘の文字列は文ごとに違い（`src/core/proofread/morph/doubled-particle.ts:60`）、言葉の例外にならない
- 提案の回数を判断の記録の欄に足して数える案：推敲の判断のスキーマ（`src/core/proofread/decisions.ts:16-27`）に欄を足すことになり、旧版が落とす。今ある `code`・`text`・`verdict` で数える。

## 変更ファイル

| 種別 | パス | 責務 / 変更内容 | 要件ID |
|---|---|---|---|
| 変更 | `src/core/proofread/types.ts:27-36` | `Finding` に省略できる `rule?: { key: string; label: string }` と `variant?: VariantRef` を足す。`VariantRef = { group: string; form: string; forms: string[]; numeral?: string }` | FR-1, FR-2 |
| 変更 | `src/core/proofread/variants.ts:379-385,408-446` | `VariantHit` に `rule`・`variant` を足す。`variantFindingsForLine(text, counts, preferences?)` は戻り値の形（`VariantHit[]`）を変えずに好みを受け、好みのある組は混ざっていなくても見る。好みの書き方は出さず、ほかの書き方は好みの説明にする。重なりの判定用に、好みを当てる前の全出現の位置を返す `variantSpansForLine(text, counts, preferences?)` を新しく足す。提案の数え方に使う `variantFormOf(group, text)`（判断の文字列を組の書き方に当て直す）もここに置く | FR-1, FR-2, FR-4 |
| 変更 | `src/core/proofread/morph/hit.ts:2-7` | `MorphHit` に省略できる `rule`・`variant` を足す | FR-1, FR-2 |
| 変更 | `src/core/proofread/morph/auto-variant.ts:113-139` | 自動の表記ゆれに `rule`・`variant` を付ける（組は書き方の原形を並べたもの）。省略できる `preferences` を受け、好みの書き方は出さず、ほかの書き方は組の集計に無くても出す | FR-1, FR-2 |
| 変更 | `src/core/proofread/morph/ra-nuki.ts:12-43` | `rule` を付ける。キーは動詞の原形のら抜きの形（食べ＋れる → 「食べれる」、見れる → 「見れる」）。活用で文字列が変わっても同じ例外に当たるようにする | FR-1 |
| 変更 | `src/core/proofread/rules.ts:10-17,65-73,88-104` | 同じ語の連続の `RuleHit` に `rule`（キー＝指摘の文字列）を付ける | FR-1 |
| 変更 | `src/core/proofread/index.ts:31-45,67-107` | `ProofreadNovelOptions` に `rules?: WorkRules` を足す。表記ゆれの2か所へ好みを渡す。最後に `applyExceptions` で例外を取り除く。`push` の型を広げて `rule`・`variant` を `Finding` に運ぶ | FR-1, FR-2 |
| 新規 | `src/core/proofread/work-rules.ts` | `ProofreadRulesSchema` と型、純関数（決まりを足す・戻す・置き換える・`applyExceptions`・`suggestRule`・表示名） | FR-1〜5 |
| 新規 | `src/core/storage/proofreadRulesRepository.ts` | 接頭辞 `proofread-rules:`。`NameDismissalRepository`（`src/core/storage/nameDismissalRepository.ts`）と同じ API | FR-5 |
| 新規 | `src/ui/hooks/use-proofread-rules.ts` | 決まりの読み書き。`use-name-dismissals.ts` と同じく、同期で取り込んだら読み直す | FR-1〜5 |
| 変更 | `src/ui/hooks/use-proofread-record.ts:6-9` | `ProofreadRecordRepo` に省略できる `listByWork(workId)` を足す（提案の回数を作品の全話で数える） | FR-4 |
| 新規 | `src/ui/components/ProofreadView/work-rules-panel.tsx` | 「この作品の決まり」の欄（一覧・戻す・提案しない言葉・フォーカス） | FR-3, FR-4 |
| 新規 | `src/ui/components/ProofreadView/rule-suggestion.tsx` | 提案の入れ物（`role="status"` を常に置き、中身だけを入れ替える） | FR-4 |
| 変更 | `src/ui/components/ProofreadView/finding-list.tsx:10-23,73-140` | 未判断のカードに「この作品では指摘しない」（ら抜き言葉・同じ語の連続）と「この作品の決まりにする」のメニュー（表記ゆれ）を足す | FR-1, FR-2 |
| 変更 | `src/ui/components/ProofreadView/proofread-view.tsx:44-60,104,164-180,262-310,320-380,481,487` | `rulesRepo` の props、決まりの読み込み、`proofreadNovel` へ渡す、見出しの「この作品の決まり（N）」と欄の開閉、作品の全話の判断の読み込みと提案（絞り込みのチップと一覧のスクロールの間に置く）、準備中の表示の「辞書」の言い換え（FR-7） | FR-1〜4, FR-7 |
| 変更 | `src/ui/App.tsx`（props の型・`ProofreadView` の描画） | `proofreadRulesRepo` を受けて `ProofreadView` に渡す | FR-5 |
| 変更 | `src/ui/sync/sync-service.ts:95-129,155,332-345,450,611-625,795-797,964` | 種類 `proofreadRules` を足す（外した語の分岐と同じ形：送る・受ける・tombstone・退避しない・本番の結線） | FR-5 |
| 変更 | `src/core/backup/index.ts:50-56,70,85` | 欄 `proofreadRules`（壊れた要素は捨てる）と `BackupState` | FR-5 |
| 変更 | `src/ui/backup/backup-service.ts:104,134,159,173,190` | 復元・ライブ取り込み・集める・置き換えるに足す | FR-5 |
| 変更 | `src/ui/components/ImportDialog/import-dialog.tsx:188,195` | 件数に「推敲の決まり：N作品」、警告文の列挙に「推敲の決まり」 | FR-5 |
| 変更 | `src/ui/Root.tsx:191-199` | リポジトリを `withSyncTouch` で包んで App へ渡す | FR-5 |
| 変更 | `src/ui/store/createDefaultStore.ts:39,83-84` と `src/ui/store/editorStore.ts`（`purgeWorkArtifacts`） | 作品の完全削除で決まりも消す | FR-5 |
| 変更 | `src/ui/components/HelpPage/help-page.tsx:65-90` | 「推敲する」に2文足す | FR-6 |
| 変更 | `docs/CODEMAP.md` | 新しいファイル・接頭辞・欄 | — |

## データモデル

### 作品の決まり（新しい kv レコード `proofread-rules:<workId>`）

```ts
// src/core/proofread/work-rules.ts
export const RuleExceptionSchema = z.object({
  /** 'ra-nuki:<ら抜きの原形>' / 'successive-word:<文字列>' / 'variant:<組>' */
  key: z.string(),
  /** 一覧の表示名（見れる・言った言った・子供・子ども）。 */
  label: z.string(),
  /** 表記ゆれの組の書き方（自動の組は書き方の集合で当てる）。 */
  forms: z.array(z.string()).optional(),
  at: z.number(),
})
export const RulePreferenceSchema = z.object({
  /** 'dict:<VariantGroup.id>'（数の書き方は 'dict:numeral:<助数詞>'）/ 'auto:<原形を並べたもの>' */
  group: z.string(),
  /** そろえる先（辞書の組は書き方の名前、数は '算用'／'漢数字'、自動の組は原形）。 */
  preferred: z.string(),
  forms: z.array(z.string()),
  at: z.number(),
})
export const DeclinedSuggestionSchema = z.object({
  kind: z.string(), // 'exception' | 'preference'
  /** 例外の提案は rule.key、表記の好みの提案は '<組>|<直した書き方>'。 */
  key: z.string(),
  label: z.string(),
  at: z.number(),
})
export const ProofreadRulesSchema = z.object({
  workId: z.string(),
  exceptions: z.array(RuleExceptionSchema).optional().default([]),
  preferences: z.array(RulePreferenceSchema).optional().default([]),
  declined: z.array(DeclinedSuggestionSchema).optional().default([]),
  /** 同期の LWW に使う。 */
  updatedAt: z.number(),
})
```

- **旧レコード**：今回からの新設なので無い。読めなければ決まりなし。
- **同期**：
  - サーバの改修は要らない。サーバは接頭辞を絞っていない（`functions/api/sync/work.ts:55-57`）
  - LWW はレコード丸ごと（`src/core/sync/plan.ts:176-184`）。2台で同時に別々の決まりを足すと、負けた側の決まりは消える。推敲の種類は synclost にも退避しない（`src/ui/sync/sync-service.ts:449-450`）
  - 決まりの欄を持たない旧版のバックアップ・ライブを復元・取り込みすると、決まりは空に置き換わる（`replaceAll`・`src/ui/backup/backup-service.ts:180-190`）
  - どちらも受け入れる（COT-59 の外した語と同じ）。決まりは作者の手間を省く設定で原稿は失わず、カードや提案からすぐ作り直せるため
  - 旧版のクライアントは、知らない接頭辞を作品として取りに行き、`WorkSchema` で失敗して何も書かない（COT-59 と同じ）
- **バックアップ**：

  ```ts
  proofreadRules: z.array(ProofreadRulesSchema.nullable().catch(null)).optional().default([])
  ```

  `deserializeBackup` で null を捨てる（COT-59 の `nameDismissals` と同じ）。
- **publish・MCP**：
  - publish バンドルには出さない。grove への publish バンドルは作品（`Work`）から組み立てる（`src/ui/_api/publish.ts:157`）
  - AI 連携用のライブスナップショットは `serializeBackup(gather())` そのもの（`src/ui/backup/backup-service.ts:110-113`）なので、決まりも暗号化して載る。MCP のツールは決まりを読み書きせず、書き戻しは `...snap` で保つ（`functions/api/_lib/mcp-server.ts:889`）ので、AI の変更を取り込んだ後も残る
- **削除**：作品の完全削除で `removeByWork`。ゴミ箱へ移すだけでは消さない。

### 指摘の欄（保存しない）

```ts
// src/core/proofread/types.ts
export interface VariantRef {
  /** 'dict:<id>' / 'dict:numeral:<助数詞>' / 'auto:<原形をソートして | でつないだもの>' */
  group: string
  /** この出現の書き方（辞書の組は書き方の名前、数は '算用'／'漢数字'、自動の組は原形）。 */
  form: string
  /** 組の書き方（そろえる先の候補）。 */
  forms: string[]
  /** 数の書き方なら助数詞（表示用）。 */
  numeral?: string
}
export interface Finding {
  // …既存の欄…
  rule?: { key: string; label: string }
  variant?: VariantRef
}
```

- `Finding` は保存しない。推敲の判断の記録（`ProofreadDecisionSchema`）は変えない。
- 表記ゆれの `rule.key` は `variant:<group>`。表示名は `forms.join('・')`。

## 決まりの当て方

- 例外：`applyExceptions(findings, exceptions)` が次に当たる指摘を取り除く
  - `rule.key` が一致する（ら抜き言葉・同じ語の連続、辞書の表記ゆれの組）
  - 自動の表記ゆれは、組のキーが一致するか、この出現の書き方が例外の `forms` に入っている
  - 自動の組は、作品に新しい書き方が増えると組のキーが変わるため、書き方の集合でも当てる
- 表記の好み（辞書の組・数）：
  - `variantFindingsForLine(text, counts, preferences)` で見る組は、混ざっている組と好みのある組を合わせたもの
  - 好みの書き方の出現は出さない
  - ほかの書き方は、説明を差し替えて出す
    - 語：「「子供」は、この作品の表記「子ども」と違います。」
    - 数：「「3人」は、この作品の数の書き方（漢数字）と違います。」
- 表記の好み（自動の組）：`autoVariantHits(tokens, counts, excluded, preferences)` で、トークンの原形がどこかの好みの `forms` に入っていれば、組の集計（`counts.groupOf`）より先に判断する
  - 原形が好みの書き方なら出さない
  - そうでなければ、好みの説明で出す（組の集計に無くても）
- 例外と表記の好みは、同じ組に同時に持たない。`setPreference` は同じ組の例外を消し、`addException` は同じ組の好みを消す。
- 辞書の表記ゆれと自動の表記ゆれが重なったときに、辞書を優先する既存の扱い（`index.ts:92-95`）は保つ。ただし重なりの判定は、**好みを当てる前の辞書の出現**（好みで隠した書き方も含む）で行う
  - `variantFindingsForLine` は今までどおり指摘の配列（好みを当てた後）を返す。好みを当てる前の全出現の位置は、新しい `variantSpansForLine` が返す
  - `proofreadNovel` は自動の表記ゆれを `variantSpansForLine` の位置と照らす（既存の呼び出しと variants.test.ts の配列の期待は変わらない）
  - こうしないと、辞書の組で好みにした書き方（子ども）が、自動の表記ゆれとして旧い説明で出直す。ている／て居る のように辞書の表示名と原形が違う組も、位置で照らすので防げる

## 提案（`suggestRule`）

```ts
export function suggestRule(input: {
  /** 直前に判断した指摘（いまの話）。 */
  last: { finding: Finding; verdict: 'fix' | 'keep' } | null
  /** 作品の全話の判断（いまの話の最新を含む）。 */
  records: ReadonlyArray<ProofreadRecord>
  rules: WorkRules
}): RuleSuggestion | null
```

- 例外の提案：
  - `last.verdict === 'keep'`、かつ `last.finding.code` がら抜き言葉か同じ語の連続
  - 作品の全話の判断のうち、`code` と `text` が同じで `verdict === 'keep'` のものが3件以上
  - その例外がまだ無く、`declined` にも無ければ提案する
- 表記の好みの提案：
  - `last.verdict === 'fix'`、かつ `last.finding.variant` がある
  - 作品の全話の `code === 'variant'` かつ `verdict === 'fix'` の判断を、`variantFormOf(group, text)` で組の書き方に当て直し、`last` と同じ組・同じ書き方のものが2件以上
  - `variantFormOf` の当て直し方：
    - 辞書の組・数：判断の文字列に組の各書き方の正規表現（`VARIANT_GROUPS` の `forms[].re`・`variants.ts:71-307`）を当てる。辞書の組の文字列には前後の文字が入る（`${V}事[がをにはもでだ]`・`variants.ts:83-84`）ので、表示名では比べない。数は「3人」「5人」がどちらも「算用」になる
    - 自動の組：判断の文字列が `last.finding.text` と同じものだけ（原形に戻す手がかりが判断に残っていないため）
  - その組にまだ好みも例外も無く、`declined` に無ければ提案する
  - そろえる先は、`forms` から直した書き方を除いたもの。1つならそのまま、2つ以上ならメニューで選ばせる
  - 文言：
    - 語：「「子供」を2回直すと決めました。この作品は「子ども」にそろえますか？」
    - 数：「算用数字の「人」を2回直すと決めました。この作品の「人」は漢数字にそろえますか？」
- 例外の提案の数え方は、判断に残っている `code`・`text`・`verdict` で比べる。活用で文字列が変わる言葉（食べれる／食べれ）は、別々に数える（仮定。提案の線は初期値）。
- 直前の判断が線を超えたときだけ提案する（直前の判断が対象外なら null）。
- 画面側：
  - 「直前に判断した指摘」は、いまの話の判断のうち `decidedAt` が最も新しいもの
  - その判断に当たる指摘を、いまの話の指摘から引く
  - 作品の全話の判断は、判断を保存したあとと同期の取り込みのあとに `listByWork` で読み直す

## UI

### 画面: 推敲画面（`#/write` の推敲・PC だけ）

- 現状: `screens/proofread-findings-desktop.png`（撮影用に一時コピーで会員の判定だけを外して撮った。確認する項目は表記ゆれ・同じ語の連続・ら抜き言葉。カードは「直す」（primary・sm）「このまま」（outline・sm）の行と、2件以上のときの「同じ指摘をすべてこのまま（N件）」（ghost）が折り返して並ぶ。右の欄は約 370px）
- 変更点（番号はプロトタイプと対応）:
  - ① 見出しの「確認する項目」の右に、同じ見た目の `Button variant="outline" size="sm"` で「この作品の決まり（N）」を置く（0件なら数なし）。`aria-expanded` で開閉する
  - ② 開くと、見出しの下（「確認する項目」の欄の下）に一覧の欄が出る
    - 欄の中身（決まりの一覧と「提案しない言葉」）を1つの `max-h-48 overflow-y-auto`（約 12 行）の中に入れ、中でスクロールする。見出し（`proofread-view.tsx:263` の `shrink-0`）が伸びて、本文と右の欄（`:311` の `min-h-0 flex-1`）を押しつぶさないため
    - 行：決まりの中身と `Button size="xs" variant="ghost"` の「戻す」
    - 0件の案内：「決まりはまだありません。指摘のカードから作れます。」
    - 欄の最後に開閉「提案しない言葉（N）」（0件なら出さない）
  - ③ 未判断のカード（ら抜き言葉・同じ語の連続）の「直す」「このまま」の右に、`Button size="sm" variant="ghost"` の「この作品では指摘しない」
  - ④ 未判断のカード（表記ゆれ）の「直す」「このまま」の右に、`DropdownMenu`（`src/ui/components/ui/dropdown-menu.tsx`・編集しない）の「この作品の決まりにする」
    - 項目：書き方ごとの「◯◯にそろえる」。数は「算用数字にそろえる」「漢数字にそろえる」
    - 区切り線のあとに「書き分けを許す」
  - ⑤ 好みに合わない表記ゆれのカードは、説明を「「子供」は、この作品の表記「子ども」と違います。」にする
  - ⑥ 提案を1件出す
    - 置き場所：`proofread-view.tsx` の絞り込みのチップ（「未判断 N」など）と一覧のスクロール（`listRef`・`:371`）の間。スクロールの外なので、下のほうのカードで判断しても見える。未判断が0件で一覧が「未判断の指摘はありません」になっても出る（`FindingList` は0件で空の文言だけを返すため、`FindingList` の中には置かない・`finding-list.tsx:70-72`）
    - 「未判断」を選んでいるときだけ。`role="status"` の入れ物は常に置き、中身だけを入れ替える
    - 例外：「「見れる」を3回このままにしました。この作品では指摘しないようにしますか？」［指摘しない］［提案しない］
    - 好み：「「子供」を2回直すと決めました。この作品は「子ども」にそろえますか？」［子どもにそろえる］［提案しない］
    - 数：「算用数字の「人」を2回直すと決めました。この作品の「人」は漢数字にそろえますか？」［漢数字にそろえる］［提案しない］
- 状態:
  - 決まり0件：①の数なし・②の案内
  - くわしい確認の準備中：品詞を使う指摘（ら抜き言葉・自動の表記ゆれ）がまだ無いので、それらのカードも提案も出ない。辞書の表記ゆれと同じ語の連続は出る
  - 決まりの記録が読めない：決まりなしとして出す
  - ゲスト・スマホ：推敲画面が出ない（COT-40 のまま）
  - 無料会員・有料会員：同じ。決まりの同期は、有料の同期が動いているときだけ効く
- フォーカス:
  - 「この作品では指摘しない」や「◯◯にそろえる」でカードが消えたら、次のカードの「本文で見る」へ移す（無ければ前のカード、どちらも無ければ一覧の見出し）
  - 「戻す」で行が消えたら、次の行の「戻す」へ移す（無ければ前の行、どちらも無ければ欄の見出し）
  - 提案のボタンを押して提案が消えたら、一覧の最初のカードの「本文で見る」へ移す
- 使う共通部品:
  - 既存：`Button`（`src/ui/components/ui/button.tsx`）・`DropdownMenu` 一式（`dropdown-menu.tsx`）・`FindingList` のカード
  - 新規：欄（`work-rules-panel.tsx`）と提案（`rule-suggestion.tsx`）
- 文言:
  - ボタン：「この作品の決まり（N）」「この作品では指摘しない」「この作品の決まりにする」「◯◯にそろえる」「書き分けを許す」「戻す」「指摘しない」「提案しない」
  - 読み上げ名：
    - 「見れるをこの作品では指摘しない」
    - 「子供・子どもの決まりを選ぶ」
    - 「見れるの決まりを戻す」
    - 「見れるの提案を戻す」
  - 一覧の行：
    - 例外：「見れる」— ら抜き言葉は指摘しない
    - 同じ語の連続：「言った言った」— 同じ語の連続は指摘しない
    - 書き分け：「子供・子ども」— 書き分けを許す
    - 表記の好み：「子ども」にそろえる（子供・子ども）
    - 数：「人」の数は漢数字にそろえる
    - 行の書き方：例外と書き分けは「中身 — 理由」、表記の好みと数は中身だけ（ダッシュも理由も付けない）
  - 「辞書」は使わない

### 推敲画面の準備中の表示（FR-7）

- `proofread-view.tsx:481` の「（辞書の読み込みは初回のみ）」→「（初回だけ時間がかかります）」
- `:487` の読み上げ名「辞書の読み込み」→「くわしい確認の準備」
- 推敲画面の文言から「辞書」を無くす（ヘルプのライセンス表記は推敲画面の外なので残す）

### 画面: バックアップの取り込み（`ImportDialog`）とヘルプ

- 文字を1行ずつ足すだけで、配置は変わらない。撮影しない
- 取り込み：「推敲の決まり：N作品」、警告文の列挙に「推敲の決まり」
- ヘルプ：「推敲する」の説明の「確かめたい項目は…」の後ろに、FR-6 の2文を足す

## ロジック・API

- core（`work-rules.ts`）：
  - 決まりの操作：`addException(rules, workId, finding, now)`・`setPreference(rules, workId, variant, preferred, now)`・`removeRule(rules, key, now)`・`decline(rules, workId, suggestion, now)`・`undecline(rules, key, now)`
  - いずれも、同じ参照を返すか、`updatedAt` を進めた新しい記録を返す
  - 表示名：`ruleLabel(entry)`・`suggestionText(suggestion)`
- `proofreadNovel(blocks, { disabled, baseCounts, morph, rules })`（`index.ts:67`）
- `ProofreadView` の props を足す：`rulesRepo?: ProofreadRulesRepo`（`get`・`save`）
- `ProofreadRecordRepo` に `listByWork?` を足す（`ProofreadRepository.listByWork` は既にある・`src/core/storage/proofreadRepository.ts`。Root の `withSyncTouch` は包んでいないメソッドもそのまま通す・`src/ui/sync/sync-touch.ts:50-68`）

## テスト計画

| 層 | 何を固定するか | 置き場所 |
|---|---|---|
| unit | スキーマ（欄が無い記録は空で読む・updatedAt が無いと読めない）・決まりの足す／戻す／置き換え（例外⇔好みの両方向）・`applyExceptions`（ら抜きの活用違い・同じ語の連続・辞書の組・自動の組の書き方の集合）・`suggestRule`（3回／2回の線・直前の判断が対象外なら null・declined・既にある決まり・書き方が3つ以上の組・事／こと の文字列違い「た事が」「る事に」を同じ書き方として数える・数「3人」「5人」を同じ書き方として数える）・表示名と提案の文言（語・数） | `src/core/proofread/work-rules.test.ts` |
| unit | 辞書の表記ゆれ：好みのある組は混ざっていなくても見る・好みの書き方は出さない・説明の差し替え・数の書き方（助数詞ごと）・`rule`／`variant` の欄・`variantSpansForLine`（好みで隠した出現も位置を返す）・`variantFormOf`（「た事が」「る事に」→ 事、「3人」「5人」→ 算用）。既存の `variantFindingsForLine` のテスト（配列を期待する9か所）はそのまま通る | `src/core/proofread/variants.test.ts`（既存に追記） |
| unit | 自動の表記ゆれ：好みの当て方（組の集計に無い書き方も出す）・`variant` の欄 | `src/core/proofread/morph/auto-variant.test.ts`（既存に追記） |
| unit | ら抜き言葉の `rule.key`（食べれる・食べれない → 「食べれる」）・同じ語の連続の `rule.key` | `morph/ra-nuki.test.ts`・`rules.test.ts`（既存に追記） |
| unit | `proofreadNovel` に決まりを渡したときの指摘（例外で消える・好みで1つだけ残る・決まりが無いときは今までと同じ）。辞書の組に好みあり＋くわしい確認あり（自動の組も子供／子どもを見る）で、好みの書き方が自動の表記ゆれとして出直さない | `src/core/proofread/index.test.ts`（既存に追記・トークンは `morph/fixtures.ts` の実物の出力） |
| unit | リポジトリ（接頭辞・`listRaw`・`removeByWork`・ほかの推敲の記録の復元で消えない）・バックアップ（往復・旧形式・壊れた要素） | `src/core/storage/proofreadRulesRepository.test.ts`・`src/core/backup/index.test.ts` |
| integration | 同期：送る・受ける・tombstone・masked・recordLost に入らない・workId の食い違いは採らない | `src/ui/sync/sync-service.test.ts`（既存に追記） |
| integration | カードのボタンとメニュー（項目ごとに出る・出ない）、例外と好みで指摘が消える、決まりの欄（数・行・戻す・0件・提案しない言葉・決まり30件と提案しない言葉20件で欄の中身が1つのスクロールに収まる）、提案（線・ボタン・提案しない・未判断以外では出ない・未判断が0件になった直後も出る・一覧のスクロールの外に出る・`role="status"` の入れ物が常にある）、フォーカス、読み上げ名、準備中を含めて推敲画面の文字と読み上げ名に「辞書」が無い（FR-7） | `src/ui/components/ProofreadView/proofread-view.test.tsx`（既存に追記・偽の repo と解析器） |
| integration | 作品の完全削除（purgeWork・30日の期限切れ・ゴミ箱を空にする）で `proofread-rules:` も消え、ゴミ箱へ移すだけなら残る | `src/ui/store/editorStore.test.ts`（COT-59 の外した語のテストと同じ形） |
| integration | 取り込みの件数と警告文 | `src/ui/components/ImportDialog/import-dialog.test.tsx` |
| e2e | ヘルプの「推敲する」に新しい2文がある（ゲストで見られる範囲） | `e2e/smoke.spec.ts`（COT-59 のヘルプのテストに追記） |
| e2e | 推敲画面は無料会員以上なので、ゲストで走る e2e では扱わない（COT-40 と同じ） | — |
| 手動 | 実物の画面（会員の判定だけを外した一時コピー）で、カード・メニュー・欄・提案を見る | design.md 末尾 |
| 手動 | NFR-1：1話1万字・決まり100件で `proofreadNovel` を決まりあり／なしで回し、差が 10ms 未満であることを Node で測る（一時的なテストファイルで計測し、値を実装メモに残す。CI には入れない） | design.md 末尾 |

## リスク・未決事項

- **提案の数え方**：表記ゆれの辞書の組と数は、判断の文字列を組の書き方に当て直して数える。ら抜き言葉・同じ語の連続・自動の組は文字列で数えるので、活用で文字列が変わる言葉は別々に数える。線（3回・2回）は初期値で、使ってみて変える
- **自動の表記ゆれの組は変わる**：作品に新しい書き方が増えると、組のキーが変わる。例外と好みは書き方の集合でも当てるので、決めた書き方は効き続ける。増えた書き方は新しく指摘に出る
- **2台で同時に決まりを作ると、負けた側の決まりは消える**（LWW・synclost にも残らない）。旧版のバックアップを復元すると決まりは空になる。どちらも受け入れる（データモデル節の理由のとおり）
- **例外で指摘が消えても、「直す」と決めた箇所は「直す箇所」に残る**。作者が直すか「外す」まで（推敲の判断の扱いのまま）
- **くわしい確認の準備中**は、品詞を使う指摘が無いので、それらへの例外・好み・提案も動かない（準備ができれば効く）

## 実装メモ（2026-10-20）

### 仕様から変えたこと・足したこと
- **提案の「直前の判断」はこの画面の操作で持つ**：`decidedAt` の最も新しい判断ではなく、`ProofreadView` で直前に「直す／このまま」を押した指摘（`lastAction`）を使う。話を替えたら忘れる。話を開き直しただけで古い判断から提案が出ないようにするため
- **作品の全話の判断の読み込み**：ほかの話は、話を替えたときと同期の取り込みのあとに `listByWork` で読み直す。いまの話は画面の最新の記録（保存を待たない）を足して数える。最初は `listByWork` を毎回の描画で `bind` していて、効果が回り続けてテストが止まった。repo そのものを依存にして直した
- **決まりで指摘が0件になったとき**：一覧（`FindingList`）ごと「気になる箇所は見つかりませんでした」に替わるので、フォーカスは「未判断」のチップへ移す（チップに ref を渡せるようにした）
- **提案の入れ物**：`RuleSuggestionBox` の `role="status"` の要素を常に描く（`empty:hidden` は付けない。表示を消すと読み上げが届かないことがあるため）
- **既存のテスト**：辞書の表記ゆれの指摘に `rule`・`variant` の欄が付くので、完全一致で比べていた2件（variants.test.ts・index.test.ts）に欄を書き足した
- **同期・バックアップ・取り込み・完全削除の配線**はサブエージェントに任せた（COT-59 の外した語と同じ形。中身の workId が同期 id と違う記録は採らない）

### 実測
- NFR-1：1話 10,229 字・決まり101件（例外96・好み5）で `proofreadNovel` を20回の平均で比べた。決まりなし 9.83ms・決まりあり 9.36ms（指摘が 1,674 件から 744 件に減るぶん、かえって速い）。差は 10ms 未満

### 確かめたこと
- テスト 214 ファイル・2,979 件、型、Biome（CI と同じ範囲・エラー 0）、build（プリキャッシュに辞書と wasm 無し）、e2e 44 件（直列）
- 実物の画面（会員の判定だけを外した一時コピー）：カードの「この作品では指摘しない」、表記ゆれのメニュー、「子どもにそろえる」で説明が替わる、「見れる」を3回このままにすると提案が出て「指摘しない」で例外になる、決まりの一覧

### 確かめていないこと
- Safari・Firefox、実機の大きな作品での使い心地。提案の線（3回・2回）の妥当さ

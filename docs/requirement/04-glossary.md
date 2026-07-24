# 04 — @参照 / オブジェクト辞書（P1 設計）

> 本書は [01-mvp-scope.md](./01-mvp-scope.md) §5 と [02-notation-and-format.md](./02-notation-and-format.md) §2 の「P1」行を**詳細化**するもの。2026-06 の grill セッションで確定。

## 0. P1 の目標と非目標

- **目標**: **著者向けの辞書**（登場人物・地名・用語など）。本文に `[[名前]]` で参照を張り、**辞書を育てながら書ける**。執筆支援に振り切る ＝ 参照サジェスト・設定の整合性確認・登場話の把握・辞書名リネームの本文伝播。
- **非目標（行き先を明記）**:
  - **読者向けの図鑑閲覧 ＋ 段階開示（ネタバレゲート）** → **P1+**（読者・公開PFが存在して初めて意味を持つ。§12）。
  - **画像／図鑑ビジュアル化** → **P1.1**（テキストカードで先に成立させる。§10）。

> 設計判断の根拠: 段階開示は「読者が辞書を閲覧できる」ことに従属し、読者は P1+。P1（ローカル・著者専用）では読者がゼロなので段階開示は投機。一方、辞書を**執筆支援ツール**として見る価値は読者非依存で今すぐ立つ。よって P1 は著者向けに限定する。

## 1. スコープ = 作品ごと（per-work）

- 辞書は作品固有。正本 `Work` に **後方互換 optional** で抱かせる: `Work.glossary?: GlossaryEntry[]`。
- `[[名前]]` の解決は**現在開いている作品の辞書のみ**を見る（別作品の同名と衝突しない）。
- 既存の永続化（`repo.saveWork` / バンドル / スナップショット）は `Work` 単位なので、glossary は**追加実装ほぼ無し**で往復する（§7）。
- シリーズ横断の共有辞書は将来（複数 Work を「シリーズ」に束ねる P1+）。今は YAGNI。

## 2. 記法と正本スキーマ

### 2.1 記法

- 正本記法は **`[[名前]]` のみ**。区切りは `]]` または改行まで、前後は trim。
  - **未終端**（同一行に `]]` が無いまま改行/行末）も**改行/行末を終端に ref 化**する（ルビ等の「閉じ括弧欠落＝フォールバック」とは異なる）。例: 行末 `[[未完` → `ref(name:'未完')`。
  - **空**（`[[]]` / `[[　]]`）も trim 後の `name:''` で **常に ref**（パーサは中身を判定しない）。`name:''` は描画時に常に未解決になる。
- 表示テキスト指定（`[[名前｜表示]]` の wiki 風）は **P1 では入れない**。需要が出れば既存 `[[名前]]` を壊さず後方互換で追加する。
- **パーサは純関数で辞書を見ない**。よって `[[ ... ]]` は中身の存在に関わらず常に `{type:'ref', name}` になる。entry が存在するか（**resolved / unresolved**）は**描画時の判定**であり、未解決 ref は「点線グレー ＋ クリックで新規作成」UX に使う。
- 既知制約: literal な `[[...]]` を地の文に書くとこれは正本記法そのものなので ref 解釈される（ルビ `《《》》` 等に escape が無いのと同水準）。日本語小説で `[[` は稀のため **P1 では escape を入れない**。必要になれば `\[[` 等を後方互換で追加（P1.1）。

### 2.2 正本スキーマ追加（Zod・`src/core/schema`）

```ts
// Inline（discriminatedUnion）に ref を追加
type Inline =
  | { type: 'text'; text: string }
  | { type: 'ruby'; base: string; reading: string }
  | { type: 'emphasisDots'; text: string }
  | { type: 'ref'; name: string }            // ← P1 追加（@参照）

// 辞書エントリ
type GlossaryEntry = {
  id: string            // 安定id（React key・将来の画像紐付け用）。本文 ref は name ベース解決なので id は解決に使わない
  name: string          // 主表示名 ＝ 解決キー
  aliases: string[]     // 別名でも解決。リネーム時に旧名をここへ自動追加（§3 ①）
  category?: string     // 図鑑のグループ/フィルタ用。自由入力（既存値をオートコンプリート）
  reading?: string      // 読み（五十音ソート・かなフィルタ用・任意）
  summary?: string      // 一言（辞書カードの表面）
  body?: string         // 説明本文（複数行プレーン。P1 ではネスト記法なし）
  createdAt: number
  updatedAt: number
  // 画像（imageId 等）は P1.1、spoiler/reveal は P1+ で後方互換追加（§10・§12）
}

// Work に後方互換 optional で追加
type Work = {
  id: string
  title: string
  episodes: Episode[]
  glossary?: GlossaryEntry[]                  // ← P1 追加
  // 既存メタ（author/description/updatedAt 等）はそのまま
}
```

## 3. 解決とリネーム

### 3.1 解決

- `resolveRef(name, entries)`: `name` ＋ `aliases[]` を **trim 後の完全一致**で照合（大小区別あり。日本語は無関係、ラテン語句は著者が alias で制御）。一致が無ければ `undefined`（= 未解決）。
- フィルタ（`@` サジェスト・辞書検索）は別物で、**`name` ＋ `aliases` ＋ `reading` の部分一致**（かな入力で漢字名 entry を引ける）。

### 3.2 リネーム（記法ベースでの本文伝播）

「辞書名を変えたら本文も変わる」を**記法ベースで実現**する。真の id 間接参照（live）は現アーキ（textarea＝記法を純関数で都度再パース）と衝突しリッチエディタ化が必要なため**採らない**。代わりに:

| 方式 | 仕組み | 挙動 | 採否 |
|---|---|---|---|
| ① 自動エイリアス | リネーム時に旧名を `aliases[]` へ自動追加 | 本文を触らず、既存 `[[旧名]]` も**即座に新エントリへ解決され続ける**（壊れない） | **採用** |
| ② 本文一括書換 | 全話の **ref inline のみ** `name===旧名` → 新名に精密置換（プレーンな同名文字列は不変） | 本文の見た目も新名に統一 | **採用（オプション）** |
| ③ id 間接参照 | ref が安定 id を持ち表示名を都度解決 | テキスト不変で表示だけ変わる | **不採用**（現アーキ衝突・往復ロスレス劣化） |

- 実装: 純関数 `renameEntry(work, entryId, newName, {rewriteBody})` が ① を常に、② を `rewriteBody=true` のときに行い**新 Work を返す**。UI は**確認ダイアログ**で「①のみ（本文はそのまま、解決は維持）／①＋②（本文も統一）」を提示。
- **削除**: entry を消すと既存 `[[name]]` ref は**未解決（点線グレー）に変わる**＝本文からは消えない。

## 4. エディタ（土台 B）と挿入 UX

### 4.1 土台

- **B = プレーン `<textarea>` ＋ ハイライト重ね（透明 textarea の裏に同寸ミラー層）**。ref を**自然なグレートークン**として視認できる（編集は textarea のまま）。
- `core` は純関数のまま（`[[名前]]`→ref のパーサ）、**テキスト/フォルダ往復のロスレス性を維持**（Claude Code 連携が生きる）。依存ゼロ・自作。

### 4.2 挿入 UX

- **`@`** が主トリガ（「@参照」由来。mention 感覚）。**`[[`** 直打ちも補助トリガ（正本記法そのもの）。
- `@` の後ろの文字列で **name＋aliases＋reading** を部分一致フィルタ。↑↓ で選択、Enter 確定、Esc 離脱。**確定時はトリガ文字（`@` / 打ちかけ `[[`）が消えて `[[名前]]` が入る**。
- **該当なし時**: 候補末尾に「『○○』を新規作成」→ その名前で entry を作成し `[[○○]]` を挿入（クイック作成）。
- **`@` の逃げ道**（本文で普通に `@` を使いたい場合）:
  - `@` は**正本記法ではなく UI トリガにすぎない** → **候補を能動的に選択しない限り常に literal**。
  - 発火抑制ヒューリスティック: `@` の**直前が非空白**（メール `foo@bar` 等）→ 出さない。`@` の**直後が空白/改行** → 出さない/即閉じ。mention は「行頭か空白直後の `@`」のみ自然発火。
  - Esc でいつでも確定離脱（literal のまま）。
  - 「`@` トリガ OFF・`[[` のみ」の設定は **P1.1**。

### 4.3 クリックの責務分担

- **プレビュー**: グレーリンク → クリックで**図鑑詳細（右 aside ペイン）を開く**。未解決 ref は点線グレー → クリックで新規作成。
- **エディタ（textarea＋overlay）**: ref は**視認のみ**（ホバーでツールチップ程度）。開くのはプレビューに集約（textarea 上クリック→パネルは実装が重く責務が濁る）。

## 5. 往復と書き出し（degrade）

`blocksToKakuyomu` が「カクヨム書き出し」と「ロスレス往復」を兼任していたが、ref 追加で責務が分岐するため**ロスレス責務を切り出す**。

- **`blocksToNotation(blocks)` を新設**（core）: ref を `[[名前]]` で**保持**するロスレス正本記法シリアライザ。ruby/傍点/シーン区切り/空行は現 `blocksToKakuyomu` と同一出力。
  - 用途: **editorStore の話オープン/復元**（`openWork`/`openEpisode`/`restoreSnapshot`/`deleteEpisode`）と **folder 往復**がこれを使う（現在 `blocksToKakuyomu` を使っている箇所を差し替え）。
  - 副次効果: folder 経由で Claude Code が `[[名前]]` を見て編集でき、再 import で ref が保たれる。
- **`toEpub` は `blocksToHtml` を共有している**（`episodeToXhtml` が `blocksToHtml(ep.blocks)` を直接呼ぶ）。よって `blocksToHtml` に **ref 描画モードを引数化**し、EPUB は**プレーンモード**（ref→テキストノード）、プレビューは**リンクモード**（resolved=グレーリンク / unresolved=点線）で呼び分ける。EPUB をプレーンにするのに辞書は渡さない＝**exporter は辞書非依存**を保つ（API 形は §8・D-GLOS-PREVIEW-API）。

| ターゲット | ref の扱い | 備考 |
|---|---|---|
| 小説家になろう | `名前`（プレーン） | 独自記法は外部非対応 |
| カクヨム | `名前`（プレーン） | 往復は `blocksToNotation` が担うので degrade してよい |
| EPUB | `名前`（プレーン） | リンク先＝読者向け用語集 appendix は **P1+**（§12） |
| HTML プレビュー（著者） | **グレーの自然リンク**（青・下線なし）→ クリックで図鑑詳細。未解決は点線グレー→新規作成 | 著者の利便 |
| editor 往復 / folder 往復 | `[[名前]]`（ロスレス） | `blocksToNotation` |

## 6. 辞書 UI（著者向け）

- **ナビ**: SideNav に work-scoped な行を追加（`NavKey += 'glossary'`、アイコン `BookMarked`）。**名称は「辞書」**（P1 はテキスト中心。画像が載る P1.1 以降に「図鑑」へ昇格）。
- **辞書ページ（メイン）**: entry の**カードグリッド**（name / category / summary）。上部に**検索**（name＋aliases＋reading 部分一致＝§3.1・§8 の `matchesQuery` を @ サジェストと共用。body/category/summary は検索対象外）＋**カテゴリ絞り込みチップ**＋ソート（五十音/更新順）＋「**+ 新規エントリ**」。
- **詳細/編集ダイアログ**（`WorkMetaDialog` パターン流用）: name / aliases / category / reading / summary / body。**算出情報**として「**登場話**（この entry を参照している話の一覧）」「参照数」を表示。name 変更時は §3.2 ①②の確認を提示。削除は確認つき。
- **執筆中のチラ見**: プレビューのグレーリンク → 右 **aside ペイン**（履歴と同じ枠を流用）に entry 詳細をピーク表示。

## 7. 永続化

- glossary は **Work JSON 内**に持つ → 既存の `repo.saveWork` / バンドル / スナップショットに相乗り（追加実装ほぼ無し）。
- **`BUNDLE_VERSION` は 1 のまま**（glossary は optional 加算。literal を上げると既存 version:1 バンドルが弾かれる）。
- 辞書編集時は `repo.saveWork` で保存。**スナップショットは従来どおり話保存時のみ**取得（その時点の glossary も一緒に入る）。辞書編集ごとの自動スナップショットは取らない（ノイズ回避）。
- スナップショット**復元は話本文のみ**をエディタへ読み込む現状実装を維持（glossary を巻き戻して上書きしない＝辞書編集の消失を防ぐ）。`editorStore.restoreSnapshot` は `draft` だけ差し替え `work.glossary` に触れない（core `restoreSnapshot` は Work 全体を返すが、UI は当該話 blocks のみ採用）。
- **folder 往復は manifest.json に `glossary` を載せる**（現 Manifest は `{id,title,episodes}` のみ＝そのままだと往復で辞書本体が脱落する）。本文 ref は `blocksToNotation` で `[[名前]]` として各話 `.txt` に保たれ、entry 辞書本体は manifest が運ぶ＝**Work 全体がロスレス往復**。Claude Code 側からの glossary 編集は P1 では非目標（保全のみ）。

## 8. core 純関数（TDD の主戦場）

```ts
// schema:   Inline += ref / Work += glossary? / GlossaryEntry
// parser:   parseInlines: "[[名前]]" → { type:'ref', name:'名前' }   // ]] / 改行まで, trim
// 往復:     blocksToNotation(blocks): string                          // ref→[[名前]], 他は現Kakuyomu出力と同一
// 解決:     resolveRef(name, entries): GlossaryEntry | undefined       // name+aliases, trim 完全一致
// 算出:     findAppearances(work, entry): { episodeIds: string[]; refCount: number }
//             episodeIds=登場話id（話順・同話内は重複しない一意）, refCount=全話の ref inline 総数（同話内も加算）
// リネーム: renameEntry(work, entryId, newName, {rewriteBody}): Work   // ①自動alias ＋ ②本文一括書換(任意)
//             newName===現name は no-op / newName が現aliasesにあれば昇格し循環(name と同値の alias)を残さない
// degrade:  toNarou/toKakuyomu/toEpub の ref → name（プレーン）。**exporter は辞書非依存**（entries を受け取らない）
// preview:  blocksToHtml(blocks, opts?) で ref 描画を引数化。
//             preview: resolved=グレーリンク span / unresolved=点線、EPUB: プレーン（ref→テキストノード）
```

## 9. 不変条件（テストで担保）

- `[[名前]]` → ref → `blocksToNotation` → `[[名前]]` が**恒等**（ロスレス往復）。
- ref を含む正本 → なろう / カクヨム / EPUB が `名前`（プレーン）に degrade する。
- `resolveRef` が name / alias を引く。未定義は `undefined`。
- `renameEntry`: ① で旧名が `aliases` に入り既存 ref が解決され続ける、② で本文 `[[旧名]]`→`[[新名]]` が置換され、**プレーンな同名文字列は不変**。
- folder 往復で本文 `[[名前]]` と **Work.glossary（manifest 経由）の両方**が保持される（Work 全体ロスレス）。
- スナップショット復元は**本文のみ**戻し、現行 glossary を温存する（巻き戻さない）。
- `findAppearances`: 同話内に同 entry の ref が複数あっても **登場話は一意**（重複しない）、**refCount は加算**。未参照 entry は `episodeIds:[]` / `refCount:0`。
- 既存 MVP の往復恒等（ルビ / 傍点 / 空行 / 行構造）が **ref 追加後も不変**（回帰防止）。
- 不正な記法（ルビ等の閉じ括弧欠落）でパーサが壊れない（フォールバック挙動）。※ `[[` 未終端は §2.1 のとおり ref 化であり「壊れ」ではない。

## 10. 実装順序と線引き

### 実装順（ボトムアップ／core から TDD）

| 段 | 内容 |
|---|---|
| **P1-a: core** | ① schema(ref/glossary/GlossaryEntry) ② parser `[[名前]]`→ref ③ `blocksToNotation` 新設＋editorStore/folder 差替 ④ なろう/カクヨム/EPUB の degrade(→`名前`) ⑤ toHtml(プレビュー) ref→グレーリンク＋未解決 ⑥ resolveRef / findAppearances / renameEntry(①②) |
| **P1-b: 挿入UX** | ⑦ `@` サジェスト（caret ポップアップ・絞込・選択挿入・クイック作成・`@` 逃げ道）＋ `[[` 補助 ⑧ textarea ハイライト重ね（グレートークン） |
| **P1-c: 辞書UI** | ⑨ SideNav 辞書行＋ルーティング ⑩ 辞書ページ（カードグリッド/検索/カテゴリ/ソート/新規） ⑪ 詳細ダイアログ（項目＋登場話/参照数＋リネーム①②確認＋削除確認） ⑫ プレビューリンク→aside ピーク |
| **P1-d: 統合** | ⑬ saveWork 結線・バンドル/スナップショット確認・e2e |

> ⑧ overlay は **P1.1 へ送る**ことで確定（D-GLOS-OVERLAY-SCOPE）。P1 はエディタを textarea のまま維持し、ref のリンク化・解決/未解決の可視化は**プレビュー側のみ**。⑦の `@` 挿入＋プレビューリンクで機能は成立する。

### 決定事項（P1 UI・確定済み）

`docs/test-cases.html` の `DECISIONS` と対応。core 実装・テスト済みのものは関数名を併記。

| ID | 決定 |
|---|---|
| **D-GLOS-UNIQUE** | 作成・リネームとも、他 entry の `name`/`alias` との**完全同名は拒否**（throw）。`resolveRef` を 0/1 件で決定的に保つ。 |
| **D-GLOS-QUICKCREATE** | `@` 該当なしは **`name` のみで即作成**し `[[name]]` を挿入。詳細は辞書画面で後編集（執筆を止めない）。 |
| **D-GLOS-SUGGEST-ORDER** | サジェストは**一致度順（前方一致＞部分一致）＋上限8件**。同ランクは `sortEntries` でタイブレーク。空 query は五十音順に先頭8件。(`suggestEntries`) |
| **D-GLOS-SUGGEST-TRIGGER** | 半角 `@`／全角 `＠`(U+FF20) の双方でトリガ。句読点・記号・空白・行頭の直後も発火。直前が文字/数字なら抑制（メール逃げ道）。IME 変換中(`isComposing`)抑制は UI 層。(`shouldTriggerSuggest`) |
| **D-GLOS-SORT** | 五十音ソートで `reading` 欠落 entry は `name` を比較キーにフォールバック（末尾/先頭固定なし）。UTF-16 コードポイント順で決定的。(`sortEntries`) |
| **D-GLOS-CATEGORY-MULTI** | `category` は**単一の自由入力**（`string?`）。複数タグは持たない。絞り込みは `categoriesOf` で出現カテゴリを列挙。 |
| **D-GLOS-OVERLAY-SCOPE** | エディタ ref overlay 視認は **P1.1 送り**。P1 はプレビュー側のみリンク化。 |
| **D-GLOS-PREVIEW-API** | `blocksToHtml(blocks, resolvedNames?: Set<string>)`。プレビューは解決済み名 Set を渡し 解決=`span.ref`／未解決=`ref--unresolved`。EPUB は引数なし＝プレーン化で辞書非依存。 |

### 線引き

| 区分 | 項目 |
|---|---|
| **P1（今回）** | P1-a〜d（overlay を除く）（著者向け辞書・`@`/`[[` 挿入・辞書ページ・リネーム①②・degrade・**プレビュー**のグレーリンク／未解決点線・aside ピーク） |
| **P1.1（近い後続）** | **エディタ ref overlay 視認**（D-GLOS-OVERLAY-SCOPE）・entry 画像（アップロード＋blob ストア＋図鑑ビジュアル化／名称を「図鑑」へ昇格）・`@` トリガ OFF 設定・`\[[` literal escape（必要なら） |
| **P1+（読者PFと同時）** | 読者向け図鑑閲覧・段階開示（ネタバレゲート＋初出 ref 自動算出）・EPUB ref→用語集 appendix リンク＋appendix 生成 |

## 11. 受け入れ条件（ドラフト）

- [ ] 本文に `@` でサジェストを開き、選択すると `[[名前]]` が挿入される（該当なしはクイック作成）。
- [ ] `@` を本文で literal に使える（選択しなければ残る／メール・行中 `@` で誤発火しない）。
- [ ] `[[名前]]` が正本 ref にパースされ、`blocksToNotation` 往復で恒等。
- [ ] プレビューで resolved ref がグレーの自然リンク、未解決が点線で描画される。
- [ ] なろう / カクヨム / EPUB 書き出しで ref が `名前`（プレーン）に degrade する。
- [ ] folder 往復（Claude Code 橋）で `[[名前]]` が保持される。
- [ ] 辞書ページで entry を CRUD でき、検索・カテゴリ絞り込みができる。
- [ ] entry 詳細に「登場話・参照数」が算出表示される。
- [ ] 辞書名リネームで ①（既存 ref が解決維持）、②（本文一括書換）が選べる。
- [ ] glossary がバンドル export → 別端末 import で復元される。

## 12. P1+ 設計メモ（将来・本書では実装しない）

- **読者向け図鑑閲覧**: 公開PF で読者が辞書/図鑑を閲覧。自前PF の差別化（なろう/カクヨムが持たない構造化・ネタバレ対応の設定閲覧）。
- **段階開示**: 読者の読了話数に応じて開示を制御。**初出は ref から自動算出**（その entry を参照した最初の話）、ネタバレ欄のみ手動の reveal 話指定。スキーマは `GlossaryEntry` に `spoiler?` / `spoilerRevealFromEpisodeId?` 等を後方互換追加。図鑑に「N話時点で見る」セレクタ。
- **EPUB**: ref → 巻末用語集 appendix へのリンク＋appendix 生成。
</content>
</invoke>

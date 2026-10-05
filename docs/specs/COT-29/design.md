# 設計 — COT-29 作品全体の検索・置換

プロトタイプ: `docs/specs/COT-29/prototype.html`（ローカル）

## 方針
本文の記法テキストを検索する純関数と、保存・履歴を扱うストア操作を分ける。現在話は draft を使う。
既存「置換」入口を「検索・置換」にし、「この話」と「作品全体」を切り替える。この話の従来操作は維持する。
結果はオフセット付きで返す。保存時は結果の元テキストと現在の作品を再検証する。
全話の保存は1つの Work レコードの更新。話ごとの連続 save は行わない。

## 変更ファイル
以下の新規ファイル・関数は提案であり、現在の実装ではない。
| 種別 | パス | 責務 / 変更内容 | 要件ID |
|---|---|---|---|
| 新規 | `src/core/search/workSearch.ts` | 検索・置換計画・結果位置/抜粋 | FR-1,3,4,5 |
| 新規 | `src/core/storage/workMutationLock.ts` | 同一作品のローカル書き込み区間の共有排他 | FR-7 |
| 変更 | `src/ui/store/editorStore.ts`（現行:25,45,238,362） | 置換状態/操作、Work変更の直列化、履歴保護、下書き整合 | FR-2,3,4,6,7 |
| 変更 | `src/core/storage/idbStore.ts`（現行:35） | put成功でなくtransaction.oncompleteで成功通知、abortを失敗通知 | FR-6 |
| 変更 | `src/ui/sync/sync-service.ts`（現行:417,451,589,628） | ローカル作品の受信・ゴミ箱・削除の書き込みを共有排他に参加させる | FR-7 |
| 変更 | `src/ui/Root.tsx`（現行:261） | dirtyに置換中フラグを加え同期受信を見送る | FR-7 |
| 変更 | `src/ui/App.tsx`（現行:159,232,653,747） | 検索パネル・確認・保存エラー・移動を配線、操作中は作品変更を無効化 | FR-1〜7 |
| 新規 | `src/ui/components/WorkSearchPanel/work-search-panel.tsx` | 作品全体の入力・結果・状態・1件置換 | FR-1,3,4 |
| 変更 | `src/ui/components/EditorPane/replace-panel.tsx`（現行:26） | 既存「この話」モードのラベルと共通枠への統合 | FR-1 |
| 変更 | `src/ui/components/EditorPane/editor-pane.tsx`（現行:25,285） | selectRangeハンドル・readOnly・行へのスクロール | FR-2,7 |
| 新規/変更 | `src/core/search/workSearch.test.ts`, `src/core/storage/workMutationLock.test.ts`, `src/ui/components/WorkSearchPanel/work-search-panel.test.tsx`, `src/ui/store/editorStore.test.ts`, `src/core/storage/idbStore.test.ts`, `src/ui/sync/sync-service.test.ts`, `src/ui/components/EditorPane/editor-pane.test.tsx`, `e2e/work-search.spec.ts` | 下記テスト | FR-1〜7 |
| 変更 | `docs/CODEMAP.md` | 検索モジュール・ストア操作・共有排他の索引更新 | FR-5 |

## データモデル
Work/Episode/Block の Zod 差分なし（`src/core/schema/index.ts:61,219`）。永続化キー・IndexedDBのversionも不変。
検索結果・検索語・操作中フラグはメモリだけ。旧作品は現行 WorkRepository で読み出す（`src/core/storage/workRepository.ts:55`）。
変更話だけ `{...episode, blocks: reconcileBlockIds(oldBlocks, parseEpisodeBody(nextText))}`（`src/core/parser/reconcileBlockIds.ts:23`）。他話は同じ参照。作品の他フィールドは最新 Work をspreadする。
ルビ/参照は記法中の語も置換される。記法記号を置換すると通常の本文編集と同様に意味が変わるため、パネルに「ルビや参照の記法も検索します」を表示する。用語集項目の改名はしない。
演出譜は書き換えない。変更行のblock id引継ぎは既存規則に従い、行の削除・分割時は既存編集と同じアンカーの制約がある。
バックアップ・同期・publishバンドル・MCPは既存 Work 型のまま。新しいリモートAPIなし。

## UI
### 画面: 執筆（ルート `#/write`）
- 現状: `screens/writer-desktop.png`, `screens/writer-mobile.png`, `screens/replace-desktop.png`, `screens/replace-mobile.png`。
- ①入口: ツールバー「検索・置換」。狭幅はアイコンに aria-label を設定する。話なしでも入口を出す。
- ②共通枠: 初期タブ「この話」（既存置換）。「作品全体」で検索入力・置換入力・本文範囲の説明を表示。desktopは右側の幅360pxのパネル、mobileは全幅のシートで最大高さ85dvh、結果だけスクロール。プレビュータブからも本文タブに切り替えて開く。
- ③結果: 件数/話数、話名・行・抜粋。移動ボタンと「この1件を置換」は別々のボタン（入れ子にしない）。最大100件を描画、追加表示する。
- ④全置換: 件数ゼロ・検索中・同じ置換語・処理中は無効。ConfirmDialogで件数・話数を確認。キャンセルでは何もしない。
- ⑤移動: モバイルは閉じる、desktopはパネルを残す。本文タブに切替、React commit後にハンドルを呼んで一致選択・行スクロール。同一話でも未保存があれば保存する。
- 状態: 初期/話なし/0件/検索中/履歴保存失敗/本文保存失敗/古い結果/保存後補助処理失敗。処理中「置換しています」、成功「N件を置換しました」。オフライン・ゲスト・無料会員も同じ表示。クラウド同期状態は既存ヘッダに任せる。
- エラー: 「置換できませんでした。本文は変更していません。もう一度お試しください」。競合は「本文が変わりました。検索し直してください」。保存後の補助処理失敗は「置換は保存しました。履歴や一覧の表示を更新できませんでした」。保存失敗した移動は「保存できませんでした。本文を確認して、もう一度お試しください」。
- モバイル: 393px枠でモック。44px操作領域、入力は16px、ソフトキーボード表示時も閉じる操作に到達できる。
- 使う共通部品: Button/Input/Label/Dialog（`docs/CODEMAP.md` §3）、ConfirmDialog（`src/ui/components/ConfirmDialog/confirm-dialog.tsx:1`）、useToast（`src/ui/components/Toast/toast.tsx:1`）。shadcnコピーは編集しない。
- 文言: 上記。toc-copyの敬体と用語に従う。
- 撮影後の確認メモ: 4枚を目視済み。desktopは248pxのサイドバーと本文/紙色プレビュー、上部の高さ約60pxのツールバー。現在の置換は280pxの浮きカード。mobileは上部「本文/プレビュー」切替と全幅の置換カード。背景は暖色の白、緑の選択状態、控えめな境界・角丸8pxを踏襲する。新パネルは本文を覆う浮き枠とし、mobileでは結果が増えても本文全体を覆い切らない高さ上限を設ける。

## ロジック・API
### 純関数（新規提案）
`SearchSource = {episodeId:string; title:string; text:string}`。
`SearchMatch = {episodeId:string; start:number; end:number; line:number; occurrence:number; excerpt:string; excerptMatchStart:number; excerptMatchEnd:number}`。
`searchWork(sources: readonly SearchSource[], query:string): SearchMatch[]` はUTF-16オフセット（textareaと一致）。非重複indexOf走査でendから次を探す。抜粋境界はサロゲートペアを割らない。行数を毎一致で先頭から走査せず、話ごとに改行位置を先に計算する。
`planReplacement(sources, query, replacement, target: SearchMatch|'all'): {episodeId:string; before:string; after:string; count:number}[]` はbeforeの一致を検証し、対象話内の位置の降順で置換する。同じ語/no-matchは空計画。$置換展開なし。
### ストア（新規提案）
`EditorState.workOperation: 'idle'|'replacing'|'navigating'` と `replaceWorkMatches({workId, sources, query, replacement, target}): Promise<{count:number; committed:boolean}>` を追加する。sources は確認画面時点の全話テキスト・話順を含み、保存時に再計算して比較する。
1. 入口でworkOperationを設定、Appで本文/記法/話切替/作品情報/用語集更新/ライブラリ移動を停止。ストアにもガードを置き、Appだけのdisableに依存しない。自動保存は進行中のものを待ち、新たなsaveは同じキューに入れる。
2. 既存serializeGlossary（`src/ui/store/editorStore.ts:238`）を作品操作全体のキューに広げ、save、用語集変更、話追加/削除/改名/並替、作品メタ、作品切替/再読み込み/インポート/ゴミ箱操作を参加させる。キュー内部から公開saveを呼んでデッドロックさせず内部関数を分ける。setDraftは処理中拒否し、IME確定前には開始しない。先行saveが完了したら再検証し、古いsourcesなら中止する。
3. 新規 `withWorkMutationLock(workId, fn)` は同じ作品のストア処理と同期のローカル変更に共通の排他を与える。Web Locksがあれば `navigator.locks.request('novel-studio:work:'+id, ...)`、ない場合はモジュール共有Promiseキュー。同じロックの二重取得を禁止。ローカル書き込みをする同期のpullContent/ゴミ箱移動/復元/削除も参加し、ロック内でdirty/workOperation・planHash・現行内容を再検証する。ネットワーク取得はロック外でよい。作業中のpushは既存保存版のみで、完了通知で次のpushが起動する。
4. ロック取得後repo.getWorkの全内容をstate.workと比較（updatedAtのみでは不可、存在なしも競合）。不一致なら書かず下書きを保持して中止する。外部変更は、下書きを保護した既存の競合退避/履歴確認を経て最新作品を読み直すまで再試行しない。
5. 現在draftをparse/reconcileして置換前Workを構築。`snapshotRepo.append(before, now(), genId())` をawaitする（`src/core/snapshot/snapshotRepository.ts:28`）。append成功直後に返却されたsnapshotsをstateへ反映し、`appendNextSnapshot=true` にする。これは本文保存の成否にかかわらず維持する。履歴の成功後だけ `repo.saveWork(after)` を1回実行（`src/core/storage/workRepository.ts:55`）。IdbStoreはtransaction完了まで成功としない。全Workが単一putなので本文の一部話だけ成功という状態はない。本文保存失敗ならwork/draftを維持し、追加済みsnapshotsと保護フラグは維持する。以後の下書き編集→自動保存でも追加履歴をrecordで上書きしない。
6. 保存成功が確定したら即座にwork/draft/dirty/status/snapshotsを更新し、現在draftは変更後の生テキストを保持（正規化でカーソルをずらさない）。手順5で設定済みの `appendNextSnapshot=true` を維持して次のsaveが置換前履歴をrecordで上書きしない（現行フラグ:`src/ui/store/editorStore.ts:199`）。以後のrecordは新しい最新履歴だけを集約する。
7. work.updatedAtは `max(now(), old.updatedAt+1)`。setがuseAutoSyncのstore.subscribeへ届くため直接touchSyncは不要（`src/ui/hooks/use-auto-sync.ts:32`）。活動記録は純増減を1回だけ、一覧再取得は補助処理。補助処理失敗を保存失敗に分類せずcommit済みを返す。finallyで操作中を解除する。
8. 履歴は従来最大20版（`src/core/snapshot/snapshotRepository.ts:12`）。連続した1件置換で古い版が通常の上限で押し出されることは許容。無変更でappendしない。
### 移動（新規提案）
App側で元一致を再検証し、キュー内でsave→保存結果再検索→openEpisodeを行う。保存前後の出現順位と前後文脈が一意に対応する場合だけ選択位置を再算出する。save失敗・対応不能なら話を開かない。
`EditorPaneHandle.selectRange(start,end)` を追加し、setSelectionRange、focus、改行基準のスクロールを行う。折り返し・設定フォントサイズを反映したtextareaミラーで範囲の縦位置を測り、scrollTopを設定する。選択だけで行が見えると仮定しない。保存/再描画完了後に呼ぶ。

## テスト計画
| 層 | 何を固定するか | 置き場所 |
|---|---|---|
| unit | 全話順・空語・0件・非重複・UTF-16/絵文字・改行番号・記法・$文字・空置換・検索語を含む置換語・1件と全件・無変更 | `src/core/search/workSearch.test.ts`（新規） |
| unit | 同一作品の排他・例外後の再開・別作品独立・Web Locks経由 | `src/core/storage/workMutationLock.test.ts`（新規） |
| integration | dirty下書きが履歴と本文に入る、未変更フィールド/block id保持、履歴失敗/put失敗/tx abort/補助処理失敗、履歴集約保護（append成功→本文保存失敗→下書き編集→自動保存でも置換前版が残る）、保存回数1、通知/活動1回 | `src/ui/store/editorStore.test.ts`, `src/core/storage/idbStore.test.ts` |
| integration | 遅い自動保存/用語集更新との順序、古い結果中止、同期ネットワーク待ち中の置換→再検証、pull/delete/ゴミ箱と置換の排他、外部書込で中止 | `src/ui/store/editorStore.test.ts`, `src/ui/sync/sync-service.test.ts` |
| integration | 初期/空/読み込み/エラー・1件と全件・キャンセル・disabled・ゲスト等にゲートなし、100件追加・IME、結果移動、モバイル閉じる | `src/ui/components/WorkSearchPanel/work-search-panel.test.tsx`（新規）, `src/ui/components/EditorPane/editor-pane.test.tsx` |
| e2e | 2話作成→dirty検索→別話の一致選択/スクロール→1件→全件確認/キャンセル/空置換→再読込→各話を履歴から復元、393pxでも同手順 | `e2e/work-search.spec.ts`（新規） |

## リスク・未決事項
- Web Locks非対応環境では排他は同じタブ内に限る。同時に複数タブで同じ作品を編集する保護は既存制約が残る。全内容比較で取得前の変化は検出するが、別タブの後続無条件保存までは防げない。
- 検索は記法対象。ルビの読みや参照も一致する。プレーン表示文字だけの検索は対象外。
- 履歴の一括復元はしない。全話復元は既存履歴で話ごとに行う（`src/ui/store/editorStore.ts:390`）。
- 排他対象を置換だけに限定すると保存/同期の巻き戻しが残るため、既存Work変更処理も参加させる。
- 未決: なし。性能測定・実ブラウザのスクロール確認は実装時の完了条件。

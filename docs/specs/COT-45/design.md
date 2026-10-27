# 設計 — COT-45 集中モードとタイプライタースクロール

プロトタイプ: `docs/specs/COT-45/prototype.html`（ローカル）

実装後の画面レビューによる追加・変更は `refinement.md` を優先する（本文全幅・表示設定・縦書き入力）。

## 方針
Appで集中表示と端末設定を統括する。同じDOM位置のEditorPaneを維持し、周辺だけ非表示にする。追従はtextarea内のscrollTopで完結させる。全画面は明示操作とし、保存・同期ロジックを変えない。

## 変更ファイル
以下の行番号は既存の変更起点。新規パスは提案であり既存exportではない。
| 種別 | パス | 責務 / 変更内容 | 要件ID |
|---|---|---|---|
| 変更 | `src/ui/App.tsx:140`、`:712`、`:927` | 端末設定、入口、集中時の周辺表示、本文を維持、操作列 | FR-1〜5 |
| 変更 | `src/ui/components/AppShell/app-shell.tsx:6`、`:48` | optionalな集中表示用prop。通常の既存呼び出しは不変。ヘッダ・ナビ・asideとスクリムを非表示 | FR-1 |
| 変更 | `src/ui/components/TopAppBar/top-app-bar.tsx:52` | SaveIndicatorを新共通部品へ抽出し通常表示でも利用 | FR-4 |
| 新規 | `src/ui/components/SaveStatus/save-status.tsx` | 既存SaveState判定と見た目を移設。集中時は狭幅でもラベルを表示 | FR-4 |
| 変更 | `src/ui/components/EditorPane/editor-pane.tsx:34`、`:417` | optionalな集中・追従prop、スクロール計測、IMEと既存補助入力との調停 | FR-1,3,5 |
| 新規 | `src/ui/hooks/use-writing-mode.ts` | 双方向booleanの端末保存、ショートカット、Fullscreenの状態と所有管理 | FR-1,2,5 |
| 新規 | `src/ui/hooks/use-typewriter-scroll.ts` | rAF計測とscrollTopの補正、viewport監視と解除 | FR-3,5 |
| 変更 | `src/ui/index.css:12` | 既存トークンを使う集中幅・余白。通常エディタのスタイルは維持 | FR-1,3 |
| 変更 | `docs/CODEMAP.md:175` | 部品・フック・設定キーを追記 | 全体 |

## データモデル
Work/Episode/Zod/IndexedDBへの変更なし。localStorageキー `ns-writing-focus` / `ns-writing-typewriter` に '1'/'0'。未設定・不正値・読取失敗はfalse。書込み失敗時もReact stateは更新。useLocalFlag（`src/ui/hooks/use-local-flag.ts:8`）は一方向の既存契約なので変更しない。同期、バックアップ、publish、MCPへの波及なし。

## UI
### 画面: 執筆（ルート `#/write`）
- 現状: `screens/writer-desktop.png`、`screens/writer-mobile.png`。
- ①通常ツールバーに「集中モード」と「入力行を中央に保つ」を追加。狭幅は短いラベル「行を中央に」、aria-labelは完全形。必要なら行を折り返す。
- ②集中時は本文だけを幅上限800pxで中央に配置。既存本文フォント15px・行高2.1・左右36pxを踏襲。393pxでは左右24px。
- ③上部の最小操作列に「集中モードを終了」、追従切替、対応時のみ全画面、保存状態。PCは高さ44px、スマホは2行88pxまで。hoverで隠さない。保存状態はrole=status、更新はpolite。
- ④中央追従。線や行の強調は実画面に出さない。モックの補助説明のみ。
- 状態: 空本文は既存placeholder。話なしは既存空状態、モード無効。読み込み中・描画エラー時は集中を適用せず復帰操作を残す。オフライン・ゲスト・無料・有料で同じ動作。readOnlyでは本文の操作禁止を維持し、追従しない。
- スマホ: キーボードが開いた可視領域と本文矩形の交差から操作列・候補バーを除く。集中時はNotationBarと脚本チェックを隠すがRefSuggestBarは候補がある間だけ残す。
- 使う共通部品: Button、Tooltip、useToast、EditorPane、TopAppBarの保存判定、既存RefSuggest/RefSuggestBar。SaveStateIndicatorは全作品のバックアップ情報用なので使わない。
- 文言: 「集中モード」「集中モードを終了」「入力行を中央に保つ」「全画面にする」「全画面を終了」。UI文言はtoc-copyの用語・簡潔さを適用。
- 集中開始時に検索・パネルは非表示にするが開閉stateを保持。モバイルpreviewから入る場合は本文を一時表示し、終了時に元のpaneへ戻す。EditorPaneの条件分岐やkeyを変更せず、選択・undo・未保存draftを保持する。

## ロジック・API
- 新規フックのシグネチャ案: useWritingMode({ eligible, editorRef }) → { focus, typewriter, toggleFocus, toggleTypewriter, fullscreen, toggleFullscreen, fullscreenAvailable }。既存useLocalFlagとは分離。
- eligibleは話あり・activeScreenがepisodes・通常の編集画面。設定のfocusと有効な集中表示を分離し、話なしや別画面に集中を漏らさない。
- Alt+Shift+Fはbubbleで処理し、defaultPrevented、repeat、isComposing、keyCode229、dialog表示時は無視。キーイベントとcompositionの状態を併用。Escapeは既存候補・脚本・ブラウザに譲る。
- Fullscreen APIは機能検出する。ユーザーのクリック内でdocument.documentElement.requestFullscreen()を呼ぶ。トーストやダイアログのportalも全画面内に保つ。既存全画面の所有権を奪わず、本フックが開始した場合だけ終了する。fullscreenchangeで同期しunmountで解除・リスナーを除去する。Promise拒否はcatchし通知、focus設定は変えない。
- `getCaretCoordinates`（`src/ui/_utils/caretCoordinates.ts:42`）のtopはscrollTopを引いた要素内座標。本文矩形のtopを加え、height/2を足した行中心と可視領域中心との差deltaを現scrollTopへ加える。二重にscrollTopを引かない。
- 追従オンのときのみtextareaに可視本文高さ/2の上下paddingを適用し、端の行も中央へ寄せる。paddingはCSSレイアウトだけで本文valueには入れない。クランプは0〜scrollHeight-clientHeight。オン／オフ切替時は選択と本文を保持し、オフでは同じ行が見えるよう補正する。
- input/select/compositionendとReactのvalue反映後にrAFを予約。ResizeObserver、visualViewport resize/scroll、フォント完了で再計測する。選択中・非フォーカス・IME中・readOnlyは抑止。rAFとobserverは解除する。手動scrollは再計測のトリガにしない。プログラムによるscrollでループしない。
- 中央へ移動したあと既存refreshで候補座標を更新する（`editor-pane.tsx:127`）。候補バー高が変わったときは可視領域を再計算する。1回のイベントで測定・補正は1回、幅変更後にフレームを跨いで安定させる。
- 保存は`store.setDraft`と既存autosaveを維持（`src/ui/store/editorStore.ts:514`、`:518`）。保存エラーの専用statusを新設しない。既存トーストとdirtyを維持し、集中モードで覆わない。
- サーバAPI・coreの追加なし。

## テスト計画
| 層 | 何を固定するか | 置き場所 |
|---|---|---|
| unit | 双方向保存、旧キーに影響なし、保存不可、キー除外条件、Fullscreen拒否・外部終了・所有権 | 新規 `src/ui/hooks/use-writing-mode.test.tsx` |
| integration | 集中出入りで同じtextarea・draft・選択維持、周辺とスクリムを除外、保存の全状態とトースト、話なし・readOnly、候補・IME | `src/ui/components/EditorPane/editor-pane.test.tsx`（既存）、新規フック/保存部品テスト |
| e2e | 通常/集中×追従on/off、先頭末尾・長文折返し・クリック矢印・手動scroll後の再開、文字サイズ/幅、保存後reload、復帰後undo・元pane・パネル | 新規 `e2e/writing-mode.spec.ts` |
| 実機 | iOS Safari/Android ChromeでIME中の非移動、キーボード表示と回転、候補バー・終了操作の可視性、非対応全画面 | 実装PRに結果記録 |

happy-domでは実レイアウトの中央位置を証明しない。Playwrightでは行中心と可視本文中心の差が1行高以下であることを数値assertし、内容・選択範囲も比較する。pnpm typecheck/test/lint/buildと対象e2eを実施する。

## リスク・未決事項
textareaの大きなpaddingは折返し計測にも影響するため、実寸e2eを必須にする。getCaretCoordinatesのミラーは長文で負荷が増えるためrAFで集約し、長文10万字で連続入力時の遅延を実測する（目標：計測処理p95 16ms以下、超過時は再利用ミラー等を検討）。OS予約キーはボタンで代替。実機検証は未実行で実装工程に残す。

撮影メモ: 既存localhost:5173（/home/dende/novel-studio）を再利用。App・EditorPane・AppShell・index.cssが本worktreeと同一であることをバイト比較で確認した。PCは左248px・上部2段・本文左右36px、スマホは本文/プレビューの切替と記法バーを目視した。ゲスト撮影。ソフトキーボード自体の撮影は未実施。新しいサーバは起動していない。

# 画面レビューの反映 — COT-45

## 利用者の追加要求と対応
| 要求 | 対応 |
|---|---|
| 集中モードと行を中央にをダッシュの右へ | 通常の記法列の後ろへ配置 |
| 集中時もショートカットを出したり隠したい | 「表示」→「記法・ショートカットを表示」。記法挿入ボタンとキー表示を共通化 |
| 選択中の緑のハイライトがノイズ | 常時の選択背景を除去。ホバーも中立色 |
| 操作ボタンも出したり隠したい | 「表示」→「操作ボタンを表示」。隠しても保存と「表示」メニューは残る |
| エディタでも縦書きしたい | 通常画面の「本文」横書き／縦書きの2つのトグルボタン、集中時の「表示」→「本文を縦書きにする」。プレビューとは別設定 |
| 集中時は全体を使いたい | 本文欄の800px上限を解除。既存のプレビュー非表示を継続 |
| スクロールバーを隅で目立たなく | 全幅の本文textareaの端にthin・淡色で表示 |

## 実装
- `FocusToolbar`が集中表示の操作・表示メニュー・任意の`NotationButtons`を持つ。メニューは操作列を隠しても残し、集中終了も選べる。
- `NotationButtons`は通常画面と集中時で共用。表示切替は記法のキー操作自体を無効化しない。
- localStorage: `ns-writing-shortcuts`（既定0）、`ns-writing-hide-controls`（既定0）、`ns-writing-vertical`（既定0）。既存の集中・追従キーと独立。
- 縦書きは同じtextareaに`writing-mode: vertical-rl`を適用する。本文文字列と保存形式は変えない。[ブラウザ標準のフォーム縦書き](https://developer.chrome.com/blog/vertical-form-controls)を使用。
- 縦書きのキャレットは高さで折り返し、右端基準と負のscrollLeftから位置を求める。中央追従は左右paddingとscrollLeftで調整する。IME変換中・範囲選択中は自動移動しない。
- 縦書きのホイールは列方向へ移動。スクロールできるときだけイベントを消費し、Ctrl+ホイールはブラウザに渡す。

## 検証と画像
- PC / 393pxで先頭・途中・末尾の列の中央誤差が1列幅以内になることを実測。
- ブラウザテストを追加：ボタンの左右順序、表示設定の独立性と再読込、操作復帰、縦横切替で同じtextarea・選択を維持、全幅、淡いスクロールバー、縦書きのIMEと手動スクロール。
- `screens/refined-toolbar-desktop.png` / `refined-toolbar-mobile.png`: 通常表示。
- `screens/refined-vertical-desktop.png` / `refined-vertical-mobile.png`: 縦書きと中央追従。
- `screens/refined-shortcuts-desktop.png` / `refined-shortcuts-mobile.png`: 操作ボタンを隠し、ショートカットを表示。
- iOS/Android実機のIME・ソフトキーボードは未確認。

## 検証結果
型チェック・lint・build通過。unit/結合3,022件（既存todo 1件）、全e2e 50件が通過。

本文の向きはプレビューと同じ見た目の2ボタンで切り替える。選択中はaria-pressedと背景で示し、選択済みのボタンを押しても反転しない。

![本文の横書き・縦書きトグル](screens/orientation-toggle.png)

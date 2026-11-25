# コトノハ-grove- 直接投稿契約 v8（leaf 側）

公開の管理画面の「コトノハ-grove- へ渡す情報」で、あらすじの下に気分とキャッチコピーを置く。装丁・モチーフ・帯は折りたたみの中に置く。投稿成功時に `Work.platform.presentation` を既存の公開設定と一緒に保存し、同期とバックアップにも含める。タイトル・作品形式・表紙画像などは従来の作品情報で設定する。

## 送信と取り込み

`work.platform.presentation` に有効な項目が一つでもある場合は `schemaVersion: 8` を送る。空の設定はオブジェクトごと省略し、v2〜v7 の選び方に戻る。

| キー | 送信値 |
| --- | --- |
| `mood` | `{ tone, pace }` または `null`。両軸とも 0〜100 の整数。tone は左の「しっとり・落ち着いた」から右の「明るい・あたたかい」、pace は下の「じっくり読む」から上の「テンポよく進む」 |
| `catchcopy` | 前後の空白を除いた一行、120字まで。空は `null` |
| `binding` | `moss`、`washi`、`indigo`、`burgundy`、`celadon`、`umber`、`ivorygold`、`slate`、または `null` |
| `motif` | `lighthouse`、`clock`、`botanical`、`stars`、`letter`、`hourglass`、`train`、`musicbox`、または `null` |
| `obiText` | 前後の空白を除いた文言、25字まで。空は `null` |
| `showObi` | `true` または `false` |

文字数は grove の書斎と同じく Unicode コードポイントで数える。欠落キーは grove の既存値を保持し、値があれば該当項目だけ上書きする。`null` は grove で未設定に戻す。`showObi` の解除を `null` で表す仕様はなく、`false` が非表示の指定になる。不完全な座標、範囲外の値、未知の ID、上限を超える文言は当該項目だけを省略する。

保存した指定は再投稿のたびに送る。フォームの「見た目の送信設定をすべて外す」はキーを省略する操作で、grove の書斎に保存済みの値を保持する。v8 未対応の grove から 409 `unsupported-schema-version` が返った場合も、この操作で見た目の設定を外して再投稿できる。

## v8 のサウンドノベル更新

v8 のバンドル直下（`schemaVersion`・`work` と同じ階層）に任意の `gameUpdate` を置く。`gameUpdate: true` のときだけ、`episodes[].game` を全話ぶんの宣言として反映する。同梱されたプレイヤーを更新し、`game` のない話の保存済みプレイヤーを解除する。全話で省略した場合は全解除になる。

`gameUpdate` を省略した v8 は、バンドルに残っている話の既存プレイヤーを維持する。leaf は見た目だけの更新や、選択を残したままの下書きへの切り替えで省略する。v2〜v7 ではこのキーを送らず、従来の取り込み契約に従う。

grove の旧 v8 実装は版番号だけでプレイヤーを反映する。leaf の v8 を有効にする前に、grove の取り込み側が `gameUpdate` を解釈することを確認する。

---
name: release-promo
description: コトノハ（leaf）の新機能をリリースするときの紹介一式——note 記事の原稿・記事に載せるスクリーンショット・X に投稿する紹介動画——を作る。「リリースの note 記事を書いて」「機能紹介の記事とスクショを」「X 用の動画を撮って」「紹介動画を作って」と頼まれたら使う。撮影は会員判定を外した一時コピーで行い、本体の作業ツリーは書き換えない。
---

# release-promo — リリースの紹介記事・スクショ・X 動画

新機能を紹介する3点を作り、`C:\Users\miyuk\Downloads\コトノハ<テーマ>紹介\`（WSL では `/mnt/c/Users/miyuk/Downloads/…`）にまとめて渡す。

```
コトノハ<テーマ>紹介/
  note-article.md            記事の原稿（[画像: …] とキャプションの目印入り）
  images/leaf-*.png          記事に貼るスクショ（10〜13枚）
  コトノハ_<テーマ>紹介.mp4    X 用の動画（1280×800・35〜45秒・音なし・テロップ入り）
  撮影スクリプト/              今回の台本と見本の本文（次回の参考）
```

道具はこのスキルの `scripts/`（共通部品）と `examples/`（2026-10 の推敲リリースの台本＝雛形）。
作業中の一時ファイルは scratchpad に置き、`<作業>` と書く。

## 1. 紹介する範囲を決める

1. 前回の記事の日付を確かめる（メモリの note-release-articles、または `references/article-style.md` の手本一覧）。
2. まだ紹介していない機能を洗い出す。
   ```bash
   git fetch -q origin main stg
   git log --oneline origin/main..origin/stg --no-merges | grep -E "feat"   # stg にだけある機能
   git log --oneline --since=<前回の記事の日付> origin/main --no-merges | grep -E "feat"   # 本番に出た機能
   ```
3. 範囲が割れるときだけユーザーに聞く（例：「推敲だけ」か「stg の未リリース分すべて」か）。
4. **stg にしかない機能を紹介するなら、記事と動画は main へのリリース後に出す**と報告に書く。

機能ごとに、画面の正確な文言を集める：`docs/specs/<COT-xx>/spec.md`、ヘルプ（`src/ui/components/HelpPage/help-page.tsx`）、ボタンやダイアログの文言（`grep -rn` で該当コンポーネント）。記事に書く事実はここから取り、推測で書かない。

## 2. 撮影用の一時コピーを用意する

```bash
.claude/skills/release-promo/scripts/setup-env.sh <作業> origin/stg   # 紹介する版を指定
cd <作業>/wt && VITE_CLERK_PUBLISHABLE_KEY= ./node_modules/.bin/vite --config vite.promo.config.ts   # バックグラウンドで
```

- 会員判定（`Root.tsx` の `canUseCreativeTools`、`export-dialog.tsx` の `gameUnlocked`）を外し、ゲストのまま無料登録・有料の画面を撮れるようにする。外せなかったときは setup-env.sh が知らせるので、判定の書き方に合わせてスクリプトを直す。
- 5174 番で起こす（5173 は本人の開発用に空けておく）。`curl` で 200 を確かめてから撮る。
- 撮影中に不具合を見つけたら、撮影を止めて原因を調べ、ユーザーに報告する。直すなら本体で別コミットにする（例：2026-10-22「直す箇所」が戻っても出ない不具合を見つけて直した）。

## 3. 見本の作品を作る

紹介する機能がはっきり写る短い作品（2〜3話・1話300字前後）を書く。

- 指摘や分析を見せる機能なら、**わざと引っかかる箇所**を入れる（表記ゆれ・ら抜き・「〜た」の連続など）。`examples/proofread-story.txt` が例。
- 実在の作品・人物・他の作者の文章は使わない。
- 見本はテキストの取り込み（`importText`）で作ると速い。見出し行（「第1話　帰郷」）で話に分かれる。

## 4. スクショを撮る

`examples/proofread-shots.mjs` を `<作業>` へ写し、今回の機能に合わせて書き換えて回す。

```bash
node <作業>/shots.mjs <作業>/shots
```

- 1440×900・2倍で撮る（`openPage(browser, { scale: 2 })`）。ヒーローは画面全体、細部は要素（`el`）か `clip` で切り取る。
- headless の Chromium は日本語の UI 文字列を持たず、`<input type="file">` が英語（Choose File）で写る。写り込む画面は `above()` でその手前までを切り取る。
- 名前は `leaf-<機能>.png`（grove なら `grove-…`）。
- **撮った PNG はすべて Read で目で見る。** 一覧が1件ずつで弱い、文言が切れている、英語が写っているなどは、見本の本文か台本を直して撮り直す。

## 5. X 用の動画を撮る

`examples/proofread-video.mjs` を `<作業>` へ写して書き換え、録画してから書き出す。

```bash
node <作業>/video.mjs <作業>/video
.claude/skills/release-promo/scripts/encode.sh <作業>/video <作業>/video/promo.mp4
```

- 1280×800（前回と同じ）。タイトル（約2.5秒）→ 場面ごとにテロップ1本＋操作 → 終わりの画面（約3.5秒）で、全体を 35〜45 秒に収める。
- テロップは1場面1本・30字以内・です・ます（toc-copy の作法）。X は音なしで流れることが多いので、テロップだけで流れが分かるようにする。
- 終わりの画面は「コトノハ-leaf-」「登録なしで、すぐに書き始められます」「cotonoha-leaf.org」。使うのに条件がある機能は、小さく1行添える（例「推敲の画面はパソコンで、無料のアカウント登録をすると使えます」）。
- 録画は CDP の screencast（`startRecording`）。Playwright の recordVideo は文字がにじむので使わない。
- `encode.sh` が作る `tile.png` と、途中のコマを数枚 Read で見て、テロップの重なり・空白の時間・文字のにじみを確かめる。

## 6. 記事を書く

`references/article-style.md` を読んでから書く（本人の手直しから抽出した規則。手本の記事の取り方もここにある）。

- 原稿は `note-article.md`。スクショは `[画像: ファイル名]`＋`（キャプション: …）` の目印で置く。
- 書いたら **natural-japanese スキル（Skill ツールで読み込む）をフルで回し、AI っぽさを消す**。手順・コマンド・レビューの頼み方は `references/article-style.md` の「AI っぽさの点検」。lint だけで済ませない（構造と読みやすさのレビューまでやる）。
- 「最後に」は本人が自分の言葉で書き直す節。経緯や体験を作らない。

## 7. まとめて渡す・片付ける

1. Downloads のフォルダへ、原稿・`images/`・動画・`撮影スクリプト/`（今回の台本と見本の本文）を置く。記事の `[画像: …]` がすべて `images/` にあるか確かめる。
2. 片付け：`scripts/teardown-env.sh <作業>`（vite を止めて worktree を消す）。本体の `git status` が汚れていないことを確かめる。
3. SendUserFile で原稿・動画・ヒーロー画像を送る。
4. 報告に書くこと：置き場所、記事の字数と画像の枚数、動画の長さ、撮影中に見つけた不具合とその扱い、**公開の前に確かめてほしいこと**（stg だけの機能ならリリース後に出すこと、冒頭の「前回の記事から◯週間」の数え方、「最後に」を本人の言葉に直すこと）。
5. メモリの note-release-articles に、今回の原稿の置き場所と範囲を1行足す。本人が手直しした公開版を見せてくれたら、違いを `references/article-style.md` に足す。

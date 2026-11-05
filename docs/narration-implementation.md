# 朗読制作の実装・検証メモ

設計の正本は [朗読書き出し機能設計](requirement/13-narration.md)。
開発開始点は origin/stg の cdda3ca。作業ブランチは feat/narration-studio。
本番リリースは stg での動作・演技品質確認後の別工程。

## 実装境界

- 執筆画面の「朗読制作」から専用ルートへ。遷移前に本文を保存する。
- 作品の声・スタイル・配役・辞書と、話／場面／連続段落の演技を本文とは別に保存。
- 個別の読み > 原稿ルビ > 長い辞書語 > モデルの読み。指示は範囲と原文を照合し、本文変更で対応が不確かなものは適用しない。
- 原稿を句読点で区切り、原文参照（blockId/spanId）を保つ。区切りのない800文字超は生成前に案内する。
- 同じ設定の採用音声・未採用候補を再利用する。意図した「この範囲を試す」は新しい生成になる。
- 画面から独立したストア、IndexedDBの採用テイク、D1ジョブ、Durable Object alarmで画面移動／再読込後も復元。
- 元／候補を前後の音声を含めて聴き、同一範囲なら再生位置を保って切り替える。採用は明示操作。
- MP3は44100HzのMPEG-1 Layer IIIフレームを検査し、ID3/Xingを取り除いて結合。間はreservoir無効の無音MP3を使い、TTSを呼ばず変更できる。入力音量はFishのnormalize_loudnessで揃える。
- MP3に辞書・人物ID・演技指示を埋め込まない。欠落／未採用／変更ありは書き出し前に停止する。
- 設定と音声は端末のIndexedDBに保存。**現時点では既存のクラウド同期・JSON全体バックアップには含まれない**。完成MP3の書き出しを案内する。
- 公開投稿・サウンドノベルへの音声同梱は今回の実装に含めない。

## サーバーと原価

`0011_narration.sql` を Pages より先に適用。
D1 batch内のトリガーで文字枠を予約し、成功だけ消費、失敗／未着手キャンセルは返却する。
予約時の期間を保持し、JSTの月境界や年額会員にも月次枠を適用する。
日次入力バイト上限は `NARRATION_DAILY_BYTE_LIMIT`（既定1,000,000）。失敗を含めた保守的な合計で停止する。
試行IDはtake ID。結果不明は自動再送せず予約を保留し、事業者側での成功／失敗を確認して運営が確定する。
D1ロックで環境全体1区間ずつ。プロバイダーの429は失敗として返却し、作者が時間をおいて再試行する。

原稿スナップショットは既存ENCRYPTION_KEYで暗号化したR2。
音声はprivate R2のユーザーprefix内に保存し、Clerk認証＋所有者照合のAPIだけで取得。
署名付きの公開URLは発行しない。
音声は生成から7日、原稿スナップショットは30日で時間単位のcronが削除する。
期限切れでも端末に取得済みならその音声を再利用する。
ジョブ・利用量台帳は無料体験の再付与防止と原価調査のため残す。

## stg構成

- Pages: stg.novel-studio-b2m.pages.dev
- Worker: novel-studio-narration-stg（workers/narration/wrangler.toml）
- D1: novel-studio-stg / R2: novel-studio-media-stg
- Pages preview: NARRATION_DISPATCH_URLでWorkerへ接続
- WorkerはjobごとのランダムcapabilityをD1で照合し、Pagesの実行APIを呼ぶ。FishのキーはPagesから出さない。
- Pages用のGitHubトークンは新しいWorkerへの権限を持たないため、Worker変更時はログイン済みターミナルで先に `pnpm exec wrangler deploy --config workers/narration/wrangler.toml` を実行する。成功後にstgへマージし、GitHub Deploy workflowでPagesを配備する。

## 公開切り替え

現在はstaff限定、s2.1-pro-free固定。有料モデルへの自動フォールバックはない。
NARRATION_RELEASE=1 と NARRATION_PAID_ENABLED=1 の両方を明示設定しない限り有料モデルに送信しない。
料金公開・Stripe価格作成・本番のWorker作成はこの変更では行わない。
既存STRIPE_PRICE_MONTHLY/YEARLYはbasic、追加プランは
NARRATION_PRICE_STANDARD/PLUS/PREMIUMをサーバー側のprice IDに対応付ける。

声の初期目録はユーザー設定済みのFISH_NARRATION_VOICE_ID（Shiori）だけ。
追加する声は利用条件・日本語の試聴を確認したうえで、NARRATION_VOICESに
id/label/description/version/referenceId/sampleUrlの配列を設定する。
sampleUrlは自サイトの /narration-samples/ 以下のみ。声クローン作成や未確認の公開声を自動で提供しない。

## 公開前に残る品質・運用確認

- Drama 3の日本語演技品質、接続点・声色・音量は実音声で評価する。固定の無音fixtureによるE2Eは演技品質の証明ではない。
- 追加の声の利用条件・既成サンプルを揃える。
- 説明なしで一話の生成／演技修正／前の読みへの復帰ができるか、作者による操作確認。
- アクセントの高低編集、文中の語句単位の選択、複数話の一括生成、設定のクラウド同期・バックアップ統合は未実装。設計書の完成条件すべてを満たした扱いにはしない。
- 本番環境の料金・保存量・問い合わせ対応を含めた原価評価後に公開可否を決める。

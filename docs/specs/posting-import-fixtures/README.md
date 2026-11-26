# Leaf 投稿サイト原稿取込の検証用ファイル

2026年11月27日。すべて架空の連作「青い灯りの観測日誌」を使っています。元原稿は manuscript/ の3話で、改行とルビ・傍点の記法を除いた本文は949字、1,001字、991字です。作品単位の検証用ファイルは全3話、1話用TXTは第1話を収録しています。`expectations.json` に期待する作品タイトル・各話タイトル・本文・順序、`results.txt` に検証結果を収録しています。

| フォルダ | 中身 |
| --- | --- |
| `observed/` | カクヨム・カクヨム互換、なろう（2023年と2026年に観測された書式）、アカツキのTXT ZIP。公開資料から確認できた項目で最小限の原稿を組み立てています。相対パスを自然順に並べるフォルダ例も含みます。 |
| `mock/` | ノベルアップ＋、TALES、アルファポリス、ソリスピアの仮書式。公式または作者の記事で確認したファイル形式・文字コード・見出しだけを使い、公開情報から判明しなかった欄名や話境界を仮置きしています。横方向の見出しと縦書きの本文があるエブリスタ想定PDF、およびハーメルン想定の標準EPUBも含みます。 |
| `fallback/` | 本文TXT・貼り付け向けの記法サンプル。pixiv小説、テラーノベル、ノベマ！、野いちご、ベリーズカフェ、NOVEL DAYSの一般小説記法と、EUC-JP・ISO-2022-JPの復号例。 |
| `rejected/` | 画像を改名したTXT、破損ZIP、必要な本文欄がないZIP、対応文書がないZIP、格納パスが不正なZIP。取込でエラーにすることを確かめるための入力です。 |

## 何が分かっていて、何を仮置きしたか

- カクヨムは話別UTF-8 TXT、`about.txt`、話ファイルの連番、タイトル本文欄。互換ZIPの差分として、作品情報に汎用の付記を入れた例も生成。NoveLandやMonokakiMeisterのバイト単位の再現には各ツールの生成物が必要。 [公式ヘルプ](https://kakuyomu.jp/help/entry/download_works) · [作者の解析スクリプト](https://kakuyomu.jp/works/16816700429022171658/episodes/16816700429022437779) · [NoveLandの互換出力](https://noveland.discourse.group/t/topic/386) · [MonokakiMeisterの書式解説](https://note.com/lumidina/n/nbc5f3a490e0b)
- なろうはNコード付きの公開話TXTと開始・タイトル・本文の見出しを、作者が公開した2種類の書式に合わせた。下書きの内部書式、短編、最終話の末尾はサンプルの対象外。 [公式ヘルプ](https://syosetu.com/helpcenter/helppage/helppageid/90) · [2023年のWordマクロ](https://note.com/makomako_makkun/n/nee42c1df49ab) · [2026年の取得例](https://99nyorituryo.hatenablog.com/entry/2026/06/06/015826)
- アカツキは `0000_目次.txt`、`0001_話名.txt`、UTF-8・CRLF。先頭行の正式名と、空白を除いたファイル名を両方用意した。 [公式出力案内](https://www.akatsuki-novels.com/supports/changes) · [公開ZIPの確認例](https://www.akatsuki-novels.com/stories/index/novel_id~1007)
- ノベルアップ＋は `episode_00001.txt` と話別UTF-8 TXT、TALESは作者が確認した `about.txt` の `# タイトル` を採用。両サービスの話ファイルの本文区切り、TALESの話ファイル名、ノベルアップ＋の作品設定ファイル名は仮。 [ノベルアップ＋公式ヘルプ](https://novelup.plus/help/detail/作品ダウンロード機能について) · [TALES公式ヘルプ](https://tales.help-note.com/hc/ja/articles/50435070833561) · [TALESとカクヨムの比較例](https://note.com/mare3/n/nd39beb36ad80)
- アルファポリスは作者が選択したと報告したShift_JIS系（CP932）・CRLFで、単一TXTと同じTXTを含むZIPを用意。ソリスピアは公式に案内のある作品テキストを模したUTF-8 TXT。両方の見出しは検証用の仮書式。 [アルファポリスの取得例](https://kakuyomu.jp/works/1177354054884734501/episodes/1177354054884734512) · [ソリスピア公式ガイド](https://solispia.com/guide/writer)
- PDFは文字層・話のしおり・右から左の読順を検証するための縦書きサンプル。エブリスタ固有の格納形式や挿絵の復元には未使用。EPUBは標準の目次、spineの順序、XHTMLルビを確認する例。 [エブリスタ公式のバックアップ案内](https://estar.jp/announces/2521) · [ハーメルン運営の出力案内](https://syosetu.org/?kid=87539&mode=kappo_view&uid=1)
- NOVEL DAYSは2026年12月7日15:00に作者用本文データの配布を始める予定。公開されている一般小説の本文記法だけをTXTで再現。 [公式の日程変更](https://novel.daysneo.com/info/20261125.html) · [記法の公式マニュアル](https://novel.daysneo.com/manual.html)

## テストの実行

`verify_fixtures.py` は上記の架空ファイルを生成し、本体から独立した検証用読み取りコードで照合します。動作にはPython 3.10以上と `reportlab`、`PyMuPDF` が必要です。スクリプトを実行すると同じフォルダにファイルと結果が再生成されます。

```sh
python verify_fixtures.py
```

検証結果は、実際の投稿サイトの出力すべてに互換性があることを示すものではありません。アプリ本体での回帰テストは `src/core/importer/site-portability.test.ts` と `e2e/posting-portability.spec.ts` で実行します。

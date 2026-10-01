import { ChevronDown, ExternalLink, MessagesSquare } from 'lucide-react'
import type { ReactNode } from 'react'
import { PageLayout } from '@/ui/components/PageLayout/page-layout'

// お問い合わせフォーム（Google フォーム）。回答者向けの公開 viewform URL。
const CONTACT_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSejYPwhIV7xu0ENl1gMDt8HetvlaJ8eD0eO4VCNImwx9b10wg/viewform'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="mb-3 font-semibold font-serif text-[18px] text-on-surface">{title}</h2>
      {children}
    </section>
  )
}

/** 使い方の 1 項目（見出し＋説明）。 */
function HowTo({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="border-outline-variant/20 border-b py-3.5 last:border-b-0">
      <div className="font-medium text-[14px] text-on-surface">{term}</div>
      <p className="mt-1 text-[13px] text-on-surface-variant leading-relaxed">{children}</p>
    </div>
  )
}

/** よくある質問（開閉式）。 */
function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group border-outline-variant/20 border-b py-1 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 font-medium text-[14px] text-on-surface transition-colors hover:text-primary">
        {q}
        <ChevronDown className="size-4 shrink-0 text-on-surface-variant transition-transform group-open:rotate-180" />
      </summary>
      <p className="pb-3.5 text-[13px] text-on-surface-variant leading-relaxed">{children}</p>
    </details>
  )
}

/** ヘルプページ（基本の使い方・AI 連携の設定・よくある質問・お問い合わせ）。 */
export function HelpPage() {
  // AI 側に登録する MCP サーバーの URL。接続画面（McpConnectDialog）と同じ値。
  const mcpUrl = `${window.location.origin}/api/mcp`
  return (
    <PageLayout
      title="ヘルプ"
      description="コトノハ-leaf- の使い方と、よくある質問をまとめました。"
    >
      <Section title="基本の使い方">
        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-1">
          <HowTo term="作品をつくる">
            マイライブラリの「新規プロジェクト」から作品を作成します。タイトルはあとから変更できます。
          </HowTo>
          <HowTo term="本文を書く">
            作品を開いて「本文を書く」へ。話（エピソード）ごとに分けて執筆でき、書いた内容はこの端末に自動保存されます。
          </HowTo>
          <HowTo term="用語集と @参照">
            人物・場所・用語などを「用語集」に登録できます。本文中に{' '}
            <code className="rounded bg-surface-container-high px-1 py-0.5 font-mono text-[12px]">
              @名前
            </code>{' '}
            と書くと、その用語集項目へのリンクになります（未登録の名前は麦色で表示されます）。
          </HowTo>
          <HowTo term="書き出す">
            「書き出し」から、縦書き対応の
            EPUB（電子書籍）や、話ごとのテキストなどの形式で出力できます。
          </HowTo>
          <HowTo term="バックアップする">
            「データ管理」からバックアップの書き出し／取り込みができます。有料会員は端末間の自動同期に加え、
            クラウドへの自動バックアップも行われます。
          </HowTo>
        </div>
      </Section>

      <Section title="脚本を書く">
        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-1">
          <HowTo term="作品の形式を選ぶ">
            作品情報の「形式」で「脚本」を選びます。本文の文字はそのままです。
          </HowTo>
          <HowTo term="柱・ト書き・セリフ">
            ○・〇で始まる行は柱です。行頭を空けた行はト書きとして 3 字下がります。
            行頭の名前（補足も可）に「」・『』が続く行と、鉤括弧で始まる行はセリフです。
            それ以外の行もト書きになります。
          </HowTo>
          <HowTo term="書式を確認する">
            本文の下の「脚本の書式チェック」で、話者名のないセリフ、括弧の対応、柱の有無、セリフ末尾の句点、縦書きでの算用数字、カメラワークの指示、用語集の「人物」にない話者を確認できます。
            確認候補を押すと該当行を選択します。本文は自動で書き換えません。
            ト書きの3字下げ、柱の前の空行、！？の後ろの1マスは表示・書き出し時に自動で揃うので、打っても打たなくても同じです。
          </HowTo>
          <HowTo term="ト書きを書く">
            脚本では Tab で行頭を全角3字に下げ、Shift+Tab で戻せます。字下げした行で Enter
            を押すと、次の行も字下げされたまま続きます。セリフや柱を書く行では Shift+Tab
            で字下げを外します。Esc を押した直後の Tab
            は本文から次の項目へ移動します。スマホでは記法バーの「ト書き」「ト書き解除」を使います。
          </HowTo>
          <HowTo term="ショートカット">
            本文の入力中に、各ボタンの下にあるキーで記法を挿入できます。Mac では Ctrl の代わりに ⌘
            を使います。
          </HowTo>
          <HowTo term="記法を入れる">
            「場面転換」で現在行の前に *** の行を入れ、「柱」で行頭に ○
            を入れます。この2つは脚本だけのボタンです。「セリフ」は小説でも使え、選択した文字を「」で囲みます。選択がないときは「」の内側から書き始められます。「三点リーダー」「ダッシュ」は……と――を2マス分まとめて入れます（小説でも使えます）。脚本ではツールバーの
            ⓘ から書き方をいつでも見られます。
          </HowTo>
          <HowTo term="書き出す">
            プレビューは原稿用紙（縦書き 20字×20行、または横書き
            40字×40行）になり、枚数が分かります。文字の大きさは設定の読書サイズに従います。
            書き出しは「脚本（提出用）」です。Word（A4 または B5・縦書き
            20字×20行・柱書き／ト書き／セリフの段落スタイル付き）か、体裁を整えた .txt
            を選べます。ページ番号は本文の 1
            頁目から入ります。表紙・登場人物表（用語集の「人物」）・梗概（作品情報で書く結末までのあらすじ）を付けられます。EPUB・なろう・カクヨムは小説だけです。コトノハ-grove-
            の表示にも脚本の体裁が反映されます。
          </HowTo>
        </div>
      </Section>

      {/* AI 連携（MCP）の設定手順。有料の機能なので、中身の前にそれを言う（toc-copy）。
          手順の文言は接続画面（McpConnectDialog）と揃える。 */}
      <Section title="AI に読み書きさせる（MCP）">
        <p className="mb-3 text-[13px] text-on-surface-variant leading-relaxed">
          ここから先は、有料のクラウド版の機能です。お使いの AI チャットにコトノハ-leaf-
          をつなぐと、AI
          が作品の本文・用語集・世界観設定・プロットを読み、直した本文を書き戻せます。
          動作確認済みの AI は <strong>Claude</strong> と <strong>ChatGPT</strong> です。
          どちらもログインで認証するので、トークンの貼り付けは要りません。
        </p>
        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-1">
          <HowTo term="1. コトノハ側で接続をオンにする">
            マイライブラリの「データ管理」→「AI に接続（MCP）」を開きます。
            同意にチェックして「接続する」を押すと、AI 側に登録する URL と手順が表示されます。URL は{' '}
            <code className="rounded bg-surface-container-high px-1 py-0.5 font-mono text-[12px]">
              {mcpUrl}
            </code>{' '}
            です。
          </HowTo>
          <HowTo term="2a. Claude につなぐ">
            Claude の設定 →「コネクタ」→「カスタムコネクタを追加」。「リモート MCP サーバーの
            URL」に上の URL を貼って追加し、「接続」を押します。表示されるコトノハ-leaf-
            のログイン画面で「許可する」を選べば完了です。
          </HowTo>
          <HowTo term="2b. ChatGPT につなぐ">
            先に開発者モードをオンにします。ChatGPT の設定 →「プラグイン」→
            一覧の下の「開発者モード」を開き、スイッチをオン。 次に左メニューの「プラグイン」→
            右上の「＋」→「アプリを作成」→「MCP アプリを作成」。名前（例：コトノハ）を入力し、
            「サーバーの URL」に上の URL を貼ります。認証は OAuth
            のまま、注意事項を読んで「理解したうえで、続行します」にチェックし、「作成する」。
            「サインイン」を押すとコトノハ-leaf-
            のログイン画面が開くので、「許可する」を選べば完了です。
          </HowTo>
          <HowTo term="AI が直した内容を原稿に反映する">
            AI
            の編集はクラウドに入り、この端末の原稿はすぐには変わりません。マイライブラリの「データ管理」→「AIの変更を取り込む」を押したときに反映されます。
          </HowTo>
          <HowTo term="接続をやめる">
            「AI に接続（MCP）」の画面で「接続を解除」を押します。AI
            側に出した許可も同時に無効になります。
          </HowTo>
        </div>
      </Section>

      <Section title="よくある質問">
        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-1">
          <Faq q="データはどこに保存されますか？">
            この端末のブラウザ内（IndexedDB）に保存されます。無料の範囲では、サーバーへ自動送信されることはありません。
            有料会員は、端末間の自動同期と自動バックアップのため、暗号化のうえクラウドにも保存されます。
          </Faq>
          <Faq q="複数の端末で使えますか？">
            使えます。有料会員は、同じアカウントでログインした端末間で、作品・用語集・構想メモなどが自動的に同期されます。
            無料の範囲では、バックアップの書き出し／取り込みで原稿を移してください。
          </Faq>
          <Faq q="同期はいつ動いていますか？　両方の端末で直したらどうなりますか？">
            同期は編集のたびに自動で走り、動いている間だけ画面上部に「同期中…」と出ます。
            同じものを両方の端末で直したときは新しい方を採用し、
            <strong>採用しなかった側の内容もこの端末に残します</strong>
            。作品は執筆画面の「履歴」に「同期で退避」として、それ以外は「データ管理 →
            同期で退避した版」に残り、ファイルへ書き出せます。退避は最大 20
            件までで、古いものから消えます。
          </Faq>
          <Faq q="無料で使える範囲は？">
            執筆・用語集・書き出し・端末内バックアップ（ファイルへの書き出し／取り込み）は、
            登録なしでも無料で使えます。
            <strong>
              プロット・世界観設定・アウトライン・相関図・マインドマップは、無料のアカウント登録で使えます
            </strong>
            。端末間の自動同期・クラウドバックアップ・AI 連携は有料会員向けの機能です。
          </Faq>
          <Faq q="掲示板は誰が読めますか？　書くのに何が要りますか？">
            掲示板は公開の場です。ログインしていない人も、検索から辿り着いた人も読めます。
            書き込むには、無料のアカウント登録と、掲示板で使う表示名の設定が必要です（有料プランの契約は要りません）。
            表示名はあとから変えられ、変えると過去の投稿の表示も新しい名前に切り替わります。書き方の目安は{' '}
            <a href="/board-guidelines" className="text-primary hover:underline">
              掲示板ガイドライン
            </a>
            にまとめました。
          </Faq>
          <Faq q="退会・解約したいです">
            有料会員はアカウントメニューから解約できます。解約後も、この端末に保存された原稿はそのまま残ります。
          </Faq>
          <Faq q="スマートフォンでも書けますか？">
            設定やヘルプの閲覧はできますが、執筆は画面の広い
            PC・タブレットでの利用を想定しています。
          </Faq>
        </div>
      </Section>

      <Section title="お問い合わせ">
        <p className="text-[14px] text-on-surface-variant leading-relaxed">
          うまく動かないところや、ほしい機能があれば、掲示板かフォームからお知らせください。
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {/* みんなで話す側。書いた声のその後（運営ステータス）が見えることが掲示板の価値なので、
              「読まれて終わりではない」ことを先に言う。 */}
          <div className="flex flex-col rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-4">
            <div className="font-medium text-[14px] text-on-surface">掲示板で話す</div>
            <p className="mt-1.5 flex-1 text-[13px] text-on-surface-variant leading-relaxed">
              要望と不具合のスレッドには、運営が「検討中」「実装済み」といった状況を付けていきます。
              同じことで困っている人の書き込みが、すでにあるかもしれません。読むだけならログインは要りません。
            </p>
            <a
              href="#/board"
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 font-medium font-sans text-[14px] text-primary-foreground no-underline shadow-xs transition-colors hover:bg-primary/90"
            >
              <MessagesSquare className="size-4" aria-hidden />
              掲示板を開く
            </a>
          </div>

          {/* 個別に伝える側。記名式にした以上、名前を出さずに言える口を残しておく（D-BOARD-FORM）。 */}
          <div className="flex flex-col rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-4">
            <div className="font-medium text-[14px] text-on-surface">フォームで個別に伝える</div>
            <p className="mt-1.5 flex-1 text-[13px] text-on-surface-variant leading-relaxed">
              掲示板は記名式で、書いたものは誰からでも読めます。名前を出しては言いにくいことは、こちらへどうぞ。
              フォームの内容は運営だけが読みます。
            </p>
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-md border border-outline-variant/50 px-5 py-2.5 font-medium font-sans text-[14px] text-on-surface no-underline transition-colors hover:border-primary hover:text-primary"
            >
              お問い合わせフォームを開く
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </div>
        </div>
      </Section>
    </PageLayout>
  )
}

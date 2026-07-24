import { ChevronDown, ExternalLink } from 'lucide-react'
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

/** ヘルプページ（基本の使い方・よくある質問・お問い合わせ）。 */
export function HelpPage() {
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
          <HowTo term="図鑑と @参照">
            人物・場所・用語などを「図鑑」に登録できます。本文中に{' '}
            <code className="rounded bg-surface-container-high px-1 py-0.5 font-mono text-[12px]">
              @名前
            </code>{' '}
            と書くと、その図鑑項目へのリンクになります（未登録の名前は麦色で表示されます）。
          </HowTo>
          <HowTo term="書き出す">
            「書き出し」から、縦書き対応の
            EPUB（電子書籍）や、話ごとのテキストなどの形式で出力できます。
          </HowTo>
          <HowTo term="バックアップする">
            「データ管理」からバックアップの書き出し／取り込みができます。有料会員はクラウドバックアップも利用できます。
          </HowTo>
        </div>
      </Section>

      <Section title="よくある質問">
        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-1">
          <Faq q="データはどこに保存されますか？">
            この端末のブラウザ内（IndexedDB）に保存され、サーバーへ自動送信されることはありません。有料会員はクラウドへ手動でバックアップできます。
          </Faq>
          <Faq q="複数の端末で使えますか？">
            使えますが、端末間の自動同期はありません。バックアップの書き出し／取り込み（会員はクラウドバックアップ／復元）で原稿を移してください。
          </Faq>
          <Faq q="無料で使える範囲は？">
            執筆・図鑑・書き出し・端末内バックアップはすべて無料で使えます。クラウドバックアップと
            AI 連携は有料会員向けの機能です。
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
          うまく動かない点や、こんな機能がほしいという要望があれば、下記のフォームからお気軽にお知らせください。
        </p>
        <a
          href={CONTACT_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 font-medium font-sans text-[14px] text-primary-foreground no-underline shadow-xs transition-colors hover:bg-primary/90"
        >
          お問い合わせフォームを開く
          <ExternalLink className="size-4" aria-hidden />
        </a>
      </Section>
    </PageLayout>
  )
}

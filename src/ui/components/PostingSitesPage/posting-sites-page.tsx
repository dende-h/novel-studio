import { ExternalLink } from 'lucide-react'
import { POSTING_SITES, type PostingSite, siteHost } from '@/core/sites'
import { coverTone } from '@/ui/_utils/cover-tone'
import { PageLayout } from '@/ui/components/PageLayout/page-layout'

/**
 * サイト 1 件の札。了承をとった「サイト名・URL・紹介文」だけで組み、相手の画像は読み込まない
 * （開くたびに相手のサーバへ通信が飛ぶことも無い）。左の札はサイト名の頭文字。
 */
function SiteCard({ site }: { site: PostingSite }) {
  const initial = [...site.name][0] ?? ''
  return (
    <a
      href={site.url}
      target="_blank"
      // noreferrer は付けない。どこから来た読み手かを相手のサイトが分かるように、
      // 既定の referrer（オリジンだけ）を渡す。
      rel="noopener"
      className="group flex gap-3.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-4 no-underline transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-md border border-outline-variant/30 font-serif text-[17px] text-on-surface"
        style={{ background: coverTone(site.name) }}
      >
        {initial}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-semibold font-serif text-[16px] text-on-surface transition-colors group-hover:text-primary">
          <span className="truncate">{site.name}</span>
          <ExternalLink aria-hidden className="size-3.5 shrink-0 text-on-surface-variant/60" />
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-on-surface-variant">
          {siteHost(site.url)}
        </span>
        <span className="mt-2 block text-[13px] text-on-surface-variant leading-relaxed">
          {site.intro}
        </span>
      </span>
    </a>
  )
}

/** 小説投稿サイトの紹介（`#/sites`）。ライブラリのサイドバーから来る一枚ものページ。 */
export function PostingSitesPage() {
  return (
    <PageLayout title="小説投稿サイト" description="書いた作品を読んでもらえる場所を紹介します。">
      <p className="text-[13px] text-on-surface-variant leading-relaxed">
        運営の方から掲載の了承をいただいたサイトだけを載せています。サイトは新しいタブで開きます。
      </p>

      <ul className="mt-5 space-y-3">
        {POSTING_SITES.map((site) => (
          <li key={site.url}>
            <SiteCard site={site} />
          </li>
        ))}
      </ul>

      <section className="mt-12 rounded-lg border border-outline-variant/30 bg-surface-container-low px-5 py-4">
        <h2 className="font-medium text-[14px] text-on-surface">掲載しているサイトの運営の方へ</h2>
        <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
          掲載をやめたいとき、紹介文を直したいときは、
          <a href="#/help" className="text-primary hover:underline">
            ヘルプのお問い合わせフォーム
          </a>
          からお知らせください。すぐに対応します。
        </p>
      </section>
    </PageLayout>
  )
}

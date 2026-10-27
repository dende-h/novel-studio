import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { POSTING_SITES, type PostingSite, siteHost } from '@/core/sites'
import { coverTone } from '@/ui/_utils/cover-tone'
import { PageLayout } from '@/ui/components/PageLayout/page-layout'

/**
 * サイト 1 件の札。上にバナー（相手の og:image）、下にサイト名・ドメイン・紹介文。
 *
 * バナーは**切り抜かない**。絵の中に作者のクレジットが入っていることがあるので、
 * OGP の比率（1200×630）の箱に全体を収め、比率が違う画像は余白で受ける。
 * 箱の大きさを先に決めておくので、遅れて届いても下の文字が動かない。
 * 読み込めなければ（相手の差し替え・オフライン）サイト名の札に倒す。
 */
function SiteCard({ site }: { site: PostingSite }) {
  const [bannerBroken, setBannerBroken] = useState(false)
  const showBanner = site.banner !== undefined && !bannerBroken
  return (
    <a
      href={site.url}
      target="_blank"
      // noreferrer は付けない。どこから来た読み手かを相手のサイトが分かるように、
      // 既定の referrer（オリジンだけ）を渡す。
      rel="noopener"
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest no-underline transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="block aspect-[1200/630] border-outline-variant/20 border-b bg-surface-container-low">
        {showBanner ? (
          <img
            src={site.banner}
            // 名前が下にあるので画像は飾り扱い（読み上げで同じ内容を二度聞かせない）。
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setBannerBroken(true)}
            className="size-full object-contain"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-full items-center justify-center px-4 text-center font-semibold font-serif text-[20px] text-on-surface"
            style={{ background: coverTone(site.name) }}
          >
            {site.name}
          </span>
        )}
      </span>
      <span className="block p-4">
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
export function PostingSitesPage({
  sites = POSTING_SITES,
}: {
  /** 並べるサイト。既定は掲載中の一覧（テストで差し替える）。 */
  sites?: readonly PostingSite[]
}) {
  return (
    <PageLayout title="小説投稿サイト" description="書いた作品を読んでもらえる場所を紹介します。">
      <p className="text-[13px] text-on-surface-variant leading-relaxed">
        運営の方から掲載の了承をいただいたサイトだけを載せています。サイトは新しいタブで開きます。
      </p>

      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {sites.map((site) => (
          <li key={site.url}>
            <SiteCard site={site} />
          </li>
        ))}
      </ul>

      <section className="mt-12 rounded-lg border border-outline-variant/30 bg-surface-container-low px-5 py-4">
        <h2 className="font-medium text-[14px] text-on-surface">掲載しているサイトの運営の方へ</h2>
        <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
          掲載をやめたいとき、紹介文やバナーを直したいときは、
          <a href="#/help" className="text-primary hover:underline">
            ヘルプのお問い合わせフォーム
          </a>
          からお知らせください。すぐに対応します。
        </p>
      </section>
    </PageLayout>
  )
}

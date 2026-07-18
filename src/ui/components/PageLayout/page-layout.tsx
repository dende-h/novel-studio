import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

interface PageLayoutProps {
  title: string
  /** タイトル下の一言説明（任意）。 */
  description?: string
  children: ReactNode
}

/**
 * 設定・ヘルプ等の一枚ものページ共通レイアウト。
 * アプリ本体（サイドバー付き）とは独立した読み物／設定画面として、法務ページと同じ骨格で描く。
 * ブランドヘッダー＝ホームへ戻る、本文は 720px 中央寄せ。
 */
export function PageLayout({ title, description, children }: PageLayoutProps) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* ヘッダー（ブランド＝ホームへ戻る） */}
      <header className="flex h-14 items-center border-outline-variant/30 border-b bg-surface-container-lowest px-5">
        <a
          href="#/"
          className="font-bold font-serif text-[19px] text-on-surface no-underline tracking-[0.01em] transition-opacity hover:opacity-80"
        >
          コトノハ
          <span className="ml-0.5 font-medium text-[13px] text-wheat-700 tracking-[0.06em]">
            -leaf-
          </span>
        </a>
      </header>

      <main className="mx-auto max-w-[720px] px-6 py-12 pb-20">
        <a
          href="#/"
          className="mb-8 inline-flex items-center gap-1.5 text-[13px] text-on-surface-variant no-underline transition-colors hover:text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden />
          アプリへ戻る
        </a>

        <h1 className="font-semibold font-serif text-[28px] text-on-surface">{title}</h1>
        {description ? (
          <p className="mt-2 text-[14px] text-on-surface-variant">{description}</p>
        ) : null}

        <div className="mt-8">{children}</div>

        <footer className="mt-14 border-outline-variant/30 border-t pt-6 text-[12px] text-on-surface-variant">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href="#/help" className="text-on-surface-variant hover:text-primary">
              ヘルプ
            </a>
            <a href="#/settings" className="text-on-surface-variant hover:text-primary">
              設定
            </a>
            <a href="#/terms" className="text-on-surface-variant hover:text-primary">
              利用規約
            </a>
            <a href="#/privacy" className="text-on-surface-variant hover:text-primary">
              プライバシーポリシー
            </a>
            <span className="ml-auto font-serif">
              コトノハ
              <span className="ml-0.5 font-medium text-[0.72em] text-wheat-700 tracking-[0.06em]">
                -leaf-
              </span>
            </span>
          </div>
        </footer>
      </main>
    </div>
  )
}

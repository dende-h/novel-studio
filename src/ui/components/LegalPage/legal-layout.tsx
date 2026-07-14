import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

interface LegalLayoutProps {
  title: string
  /** 制定・改定日の表記（例: 「2026年7月14日 制定」）。 */
  dateLine: string
  children: ReactNode
}

/**
 * 利用規約・プライバシーポリシー等の文書ページ共通レイアウト。
 * アプリ本体とは独立した読み物なので、サイドバーを持たない一枚もののドキュメントとして描く。
 * 見出しは条文（h2）＋本文（p/ul）を想定し、子要素側は素の HTML で書けるようにする。
 */
export function LegalLayout({ title, dateLine, children }: LegalLayoutProps) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* ヘッダー（ブランド＝ホームへ戻る） */}
      <header className="flex h-14 items-center border-outline-variant/30 border-b bg-surface-container-lowest px-5">
        <a
          href="#/"
          className="font-bold font-serif text-[19px] text-on-surface no-underline tracking-[0.01em] transition-opacity hover:opacity-80"
        >
          novel-studio
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
        <p className="mt-2 text-[12px] text-on-surface-variant">{dateLine}</p>

        {/* 条文本文。h2=条・見出し、p/ul=本文のスタイルをまとめて当てる。 */}
        <div
          className={
            'mt-8 leading-relaxed ' +
            '[&_h2]:mt-9 [&_h2]:mb-2.5 [&_h2]:font-semibold [&_h2]:font-serif [&_h2]:text-[17px] [&_h2]:text-on-surface ' +
            '[&_p]:mt-2.5 [&_p]:text-[14px] [&_p]:text-foreground ' +
            '[&_ul]:mt-2.5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_li]:text-[14px] ' +
            '[&_ol]:mt-2.5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6 [&_ol_li]:text-[14px]'
          }
        >
          {children}
        </div>

        <footer className="mt-14 border-outline-variant/30 border-t pt-6 text-[12px] text-on-surface-variant">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href="#/terms" className="text-on-surface-variant hover:text-primary">
              利用規約
            </a>
            <a href="#/privacy" className="text-on-surface-variant hover:text-primary">
              プライバシーポリシー
            </a>
            <a href="#/tokushoho" className="text-on-surface-variant hover:text-primary">
              特定商取引法に基づく表記
            </a>
            <span className="ml-auto font-serif">novel-studio</span>
          </div>
        </footer>
      </main>
    </div>
  )
}

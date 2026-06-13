import type { ReactElement } from 'react'

interface LandingPageProps {
  onStart: () => void
  hasWorks: boolean
}

interface Feature {
  title: string
  body: string
  icon: ReactElement
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const FEATURES: Feature[] = [
  {
    title: 'ローカルファースト',
    body: '原稿は端末内（IndexedDB）に保存。ログイン不要で、オフラインでも書けます。',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    ),
  },
  {
    title: '縦書きEPUB',
    body: '1作品＝1冊として、縦書きのEPUBに書き出し。電子書籍リーダーでそのまま読めます。',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
        <path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2z" />
        <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
      </svg>
    ),
  },
  {
    title: 'なろう・カクヨム記法',
    body: 'ルビや傍点を保ったまま、各投稿サイトの記法へワンクリックで変換します。',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
        <path d="M4 7h16M4 12h16M4 17h10" />
      </svg>
    ),
  },
  {
    title: 'ルビ・傍点',
    body: '｜親文字《よみ》や《《傍点》》をそのまま記述。書いた瞬間に組版を確認できます。',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
        <path d="M7 18 11 6l4 12M8.5 14h5" />
        <circle cx="18" cy="7" r="1" />
      </svg>
    ),
  },
  {
    title: 'ライブプレビュー',
    body: '入力と同時に整形結果を表示。執筆のリズムを止めません。',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    title: 'バックアップ自由',
    body: '全作品をバンドルJSONやフォルダに書き出し／取り込み。データはあなたのものです。',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5M12 15V3" />
      </svg>
    ),
  },
]

const STEPS: { n: string; title: string; body: string }[] = [
  { n: '01', title: '作品をつくる', body: '「新規作品」からタイトルを付けるだけ。連載＝複数話をまとめて管理します。' },
  { n: '02', title: '話を書く', body: '記法のまま書けば、入力中に自動保存。隣のペインに組版プレビューが追従します。' },
  { n: '03', title: '書き出す', body: '縦書きEPUB、なろう／カクヨム記法、バックアップ用バンドルへ自在に出力。' },
]

/** アプリの入り口（ローカルファースト小説執筆ツールの紹介＋執筆導線）。 */
export function LandingPage({ onStart, hasWorks }: LandingPageProps) {
  const ctaLabel = hasWorks ? '執筆を再開' : '書き始める'

  return (
    <div className="min-h-dvh bg-[#f7f5f0] text-stone-900">
      {/* ヘッダー */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <h1 className="font-serif text-xl tracking-tight">novel-studio</h1>
        <button
          type="button"
          onClick={onStart}
          className="rounded-full border border-stone-300 px-4 py-1.5 text-sm transition hover:border-stone-900"
        >
          開く
        </button>
      </header>

      {/* ヒーロー */}
      <section className="mx-auto grid max-w-5xl items-center gap-10 px-6 pt-10 pb-20 md:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="mb-4 inline-block rounded-full bg-stone-900/5 px-3 py-1 text-stone-600 text-xs">
            ローカルファースト・登録不要
          </p>
          <h2 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
            ローカルで書いて、
            <br />
            どこへでも持ち出す。
          </h2>
          <p className="mt-6 max-w-md text-stone-600 leading-8">
            ブラウザだけで完結する小説執筆ツール。データは端末内に保存され、
            オフラインでも書けます。書いた原稿は縦書きEPUBや各投稿サイトの記法へそのまま。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onStart}
              className="rounded-full bg-stone-900 px-6 py-3 font-medium text-[#f7f5f0] text-sm transition hover:bg-stone-700"
            >
              {ctaLabel}
            </button>
            <span className="text-stone-500 text-xs">サーバ不要・あなたのデータはあなたの端末に</span>
          </div>
        </div>

        {/* 縦書きの組版サンプル */}
        <div className="hidden justify-center md:flex">
          <div
            className="h-72 rounded-lg border border-stone-200 bg-white px-7 py-6 text-[15px] leading-8 shadow-sm"
            style={{ writingMode: 'vertical-rl' }}
          >
            <p>
              夜の<ruby>帳<rt>とばり</rt></ruby>が下りる。
              <em className="dots">確かに</em>、彼女はそこにいた。
            </p>
          </div>
        </div>
      </section>

      {/* 特徴 */}
      <section className="border-stone-200 border-y bg-white/60">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h3 className="mb-10 text-center font-serif text-2xl">書くことに集中するための道具</h3>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-xl border border-stone-200 bg-white p-6">
                <div className="mb-3 h-6 w-6 text-stone-700">{f.icon}</div>
                <h4 className="font-medium text-base">{f.title}</h4>
                <p className="mt-2 text-sm text-stone-600 leading-7">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 使い方 */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h3 className="mb-10 text-center font-serif text-2xl">はじめ方は3ステップ</h3>
        <ol className="grid gap-8 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n}>
              <div className="font-serif text-3xl text-stone-300">{s.n}</div>
              <h4 className="mt-2 font-medium text-base">{s.title}</h4>
              <p className="mt-2 text-sm text-stone-600 leading-7">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 末尾CTA */}
      <section className="bg-stone-900 text-[#f7f5f0]">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-6 py-16 text-center">
          <h3 className="font-serif text-2xl md:text-3xl">物語を、いま書き始めよう。</h3>
          <p className="max-w-md text-sm text-stone-300 leading-7">
            インストールも会員登録も不要。ブラウザを開けば、それが原稿用紙です。
          </p>
          <button
            type="button"
            onClick={onStart}
            className="rounded-full bg-[#f7f5f0] px-6 py-3 font-medium text-sm text-stone-900 transition hover:bg-white"
          >
            今すぐはじめる
          </button>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-6 py-8 text-center text-stone-400 text-xs">
        novel-studio — ローカルファーストの小説執筆ツール
      </footer>
    </div>
  )
}

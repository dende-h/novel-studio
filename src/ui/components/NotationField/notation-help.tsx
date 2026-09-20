import type { ReactNode } from 'react'
import { FieldHelp } from '@/ui/components/FieldHelp/field-help'

/**
 * 記法つき入力欄（プロットの要約・メモ、世界観設定、用語集の公開情報・作者メモ）の
 * ラベル横に置くⓘボタン。押すと、その欄で使える記法（マークダウンと @／[[用語]] 参照）の
 * 一覧をダイアログで出す。どの画面でも同じ説明を出したいので 1 部品に集約する。
 * 本文（エピソード）はマークダウン非対応のため、本文エディタには置かない。
 *
 * ボタンとダイアログの器は `FieldHelp`（欄の説明の共通部品）。ここは中身だけを持つ。
 */
export function NotationHelpButton({ className }: { className?: string }) {
  return (
    <FieldHelp
      title="この欄で使える記法"
      ariaLabel="使える記法の説明を開く"
      description="書いた記号は「プレビュー」で反映されます（本文の執筆エリアではマークダウンは使えません）。"
      className={className}
    >
      <Section title="用語集の参照">
        <Row syntax="@">
          打つと用語集のサジェストが開き、選ぶと [[名前]] が入ります。無い語はその場で登録できます。
        </Row>
        <Row syntax="[[用語]]">
          プレビューで用語集へのリンクになります（クリックでその用語を確認。緑＝登録済み、
          麦色＝未登録）。
        </Row>
      </Section>
      <Section title="マークダウン">
        <Row syntax="**強調**">太字になります。</Row>
        <Row syntax="# 見出し">
          行頭の # で見出しに。<code className="mx-0.5">##</code>
          <code className="mx-0.5">###</code> で段階が下がります（3 段まで）。
        </Row>
        <Row syntax="- 箇条書き">
          行頭の「- 」で箇条書きに。行頭を字下げ（スペース 2 つ・タブ・全角スペース）すると 1
          段深くなります（3 階層まで）。
        </Row>
        <Row syntax="1. 番号付き">
          行頭の「1. 」で番号付きに。字下げの階層は箇条書きと同じです（3 階層まで）。
        </Row>
        <Row syntax="> 引用">行頭の「&gt; 」で引用に。</Row>
        <Row syntax="---">ハイフン 3 つだけの行が区切り線になります。</Row>
        <Row syntax="| 見出し | 見出し |">
          行を | で始めて | で終えると表に。2 行目を
          <code className="mx-0.5">| --- | --- |</code>
          にすると 1 行目が見出し行になります。
        </Row>
      </Section>
      <Section title="本文と同じ記法">
        <Row syntax="｜親文字《よみ》">
          ルビ。親文字が漢字だけなら ｜ を省いて
          <code className="mx-0.5">漢字《かんじ》</code> と書けます。
        </Row>
        <Row syntax="《《傍点》》">文字の上に点を打ちます。</Row>
      </Section>
    </FieldHelp>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-[12px] text-on-surface-variant/80 tracking-wide">{title}</h3>
      <dl className="space-y-2">{children}</dl>
    </section>
  )
}

/** 記法 1 つぶんの行（左：書き方、右：説明）。 */
function Row({ syntax, children }: { syntax: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="shrink-0">
        <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-[12px] text-on-surface">
          {syntax}
        </code>
      </dt>
      <dd className="min-w-0 text-[12.5px] text-on-surface-variant leading-relaxed">{children}</dd>
    </div>
  )
}

import { useMemo } from 'react'
import { DELETED_BODY_TEXT, HIDDEN_BODY_TEXT } from '@/core/board/permission'
import { boardBodyToHtml } from '@/core/board/render'
import { cn } from '@/lib/utils'

/**
 * 掲示板本文のブロック要素の見た目。`src/ui/index.css` の `.notation-preview` を
 * Tailwind へ写したもの。掲示板は横組みの UI 文字で読むので、明朝・縦組み・読書サイズの
 * `.preview` 系クラスは付けない（小説本文と取り違えないための区別でもある）。
 *
 * 当てているのは `boardBodyToHtml` が出しうる要素だけ
 * （h1〜h3・ul/ol・blockquote・hr・.md-table/table/th/td・p.blank・a）。
 * `p.blank` の高さがいちばん効く — 空行は空段落として残る仕様で、
 * `public/board-guidelines.html` の「一行あけるとネタバレを避けられる」案内がこれを前提に
 * 書いてある。高さを与えないと空段落が潰れ、案内どおりに書いた人の意図が消える。
 */
const BODY_STYLE = [
  'text-sm leading-7 text-on-surface [overflow-wrap:anywhere]',
  // 先頭要素の上余白は落とす（カードの内側で 1 行ぶん浮く）
  '[&>*:first-child]:mt-0',
  // 見出しは UI の階層を壊さない控えめな段差（h1 でもカードの見出しを超えない）
  '[&_h1]:mt-4 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:leading-6 [&_h1]:font-semibold',
  '[&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:text-[0.9375rem] [&_h2]:leading-6 [&_h2]:font-semibold',
  '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:leading-6 [&_h3]:font-semibold',
  '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:ps-6 [&_ul_ul]:list-[circle] [&_ul_ul_ul]:list-[square]',
  '[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:ps-6',
  // 入れ子のリストは外側の余白を重ねない（親項目との間が空きすぎる）
  '[&_li>ul]:my-0 [&_li>ol]:my-0',
  '[&_blockquote]:my-2 [&_blockquote]:border-s-2 [&_blockquote]:border-outline-variant/60',
  '[&_blockquote]:ps-3 [&_blockquote]:text-on-surface-variant',
  '[&_hr]:my-3 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-outline-variant/50',
  // 横に長い表は投稿の幅を押し広げず、表だけが横スクロールする
  '[&_.md-table]:my-2 [&_.md-table]:overflow-x-auto',
  '[&_table]:border-collapse [&_table]:text-xs [&_table]:leading-6',
  '[&_th]:border [&_td]:border [&_th]:border-outline-variant/40 [&_td]:border-outline-variant/40',
  '[&_th]:px-2 [&_td]:px-2 [&_th]:py-1 [&_td]:py-1 [&_th]:text-start [&_td]:text-start',
  '[&_th]:bg-surface-container-high [&_th]:font-semibold',
  // 空行（p.blank）は 1 行ぶんの高さを持たせる。ここが潰れると段落の間が消える
  '[&_p.blank]:min-h-[1em]',
  '[&_a]:text-forest-700 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-forest-800',
].join(' ')

interface BoardBodyProps {
  /** 投稿の生テキスト。描画は boardBodyToHtml に任せる */
  body: string
  /** 本人が削除した投稿 */
  deleted?: boolean
  /** 運営が非表示にした投稿 */
  hidden?: boolean
  className?: string
}

/**
 * 掲示板の投稿本文。`boardBodyToHtml`（全エスケープ済み）をそのまま描く。
 *
 * **削除・非表示のときは本文を組み立てず、伏字だけを出す。** サーバも伏字に差し替えて返す
 * （`visiblePost`・設計 §7-6）が、画面でも同じ判断を持つ＝どちらかが緩んでも本文は漏れない。
 * 伏字の文言はサーバと同じ定数を使う（2 か所に別の文が育たないように）。
 */
export function BoardBody({ body, deleted = false, hidden = false, className }: BoardBodyProps) {
  const masked = deleted || hidden
  // 伏字のときは本文を HTML にすらしない（作った文字列がどこかで漏れる経路を残さない）。
  const html = useMemo(() => (masked ? '' : boardBodyToHtml(body)), [masked, body])

  if (masked) {
    // 削除と非表示が重なったら削除を先に出す（本人の意思のほうを優先・permission.ts と同じ順）。
    return (
      <p className={cn('text-sm leading-7 text-on-surface-variant/70', className)}>
        {deleted ? DELETED_BODY_TEXT : HIDDEN_BODY_TEXT}
      </p>
    )
  }

  return (
    <div
      // biome-ignore lint/security/noDangerouslySetInnerHtml: core/board/render が全エスケープ済みの安全な HTML
      dangerouslySetInnerHTML={{ __html: html }}
      className={cn(BODY_STYLE, className)}
    />
  )
}

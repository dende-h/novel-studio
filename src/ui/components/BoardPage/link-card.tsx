import { Globe } from 'lucide-react'
import { useState } from 'react'
import type { LinkCard } from '@/core/board/types'
import { cn } from '@/lib/utils'
import { Badge } from '@/ui/components/ui/badge'
import { Card } from '@/ui/components/ui/card'

/**
 * 投稿に貼られた外部リンクのカード（設計 09-board §3.2）。
 *
 * 守っているのは 3 つ。
 * 1. **ドメインを必ず出す。** タイトルは相手サイトが自由に名乗れる文字列なので、
 *    ドメインを添えないと「見た目と飛び先が違うリンク」を運営が配ることになる。
 * 2. **画像は `imageUrl` が空でないときだけ。** 許可表の外のホストはサーバが空文字にしている
 *    （D-BOARD-OGPIMG）。画面側でも空を見て出し分ける＝どちらかが緩んでも任意の画像は出ない。
 * 3. **枠の大きさを先に決める。** 縦横比を固定した箱に入れ、読み込みに失敗したら箱ごと畳む。
 *    画像の実寸で高さが決まると、遅れて届いた 1 枚で読んでいた行が飛ぶ。
 *
 * `kind === 'work'` は grove（コトノハ-grove-）の作品カード。表紙の縦長比と「作品」バッジで、
 * ただのリンクではなく作品だと分かるようにする（D-BOARD-WORKCARD）。
 */
export function BoardLinkCard({ card }: { card: LinkCard }) {
  // 画像は他所のサーバにあり、いつ消えてもおかしくない。壊れた枠を残さず畳む。
  const [imageBroken, setImageBroken] = useState(false)
  const isWork = card.kind === 'work'
  const showImage = card.imageUrl !== '' && !imageBroken
  // タイトルが取れなかった URL（kind: 'none'）は URL そのものを見出しにする。
  const heading = card.title.trim() !== '' ? card.title : card.url
  // サイト名はドメインの補足。同じ文字列なら重ねて出さない。
  const siteName = card.siteName.trim() !== '' && card.siteName !== card.host ? card.siteName : ''

  return (
    <a
      href={card.url}
      target="_blank"
      rel="nofollow ugc noopener noreferrer"
      className="block rounded-xl no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {/* Card の既定は縦積み・py-6 の「節のカード」。リンク 1 本ぶんの小さな札に詰める。 */}
      <Card
        className={cn(
          'flex-row gap-0 overflow-hidden py-0 transition-colors',
          isWork
            ? 'border-forest-400/60 bg-forest-50/50 hover:bg-forest-50'
            : 'hover:bg-surface-container-low',
        )}
      >
        {showImage && (
          <div
            className={cn(
              'shrink-0 self-start overflow-hidden bg-surface-container',
              // 作品は表紙（縦長）、それ以外は OGP の 1.91:1。読み込み前から高さが決まる。
              isWork ? 'aspect-[3/4] w-20' : 'aspect-[1.91/1] w-32',
            )}
          >
            <img
              src={card.imageUrl}
              // 見出し・説明が隣にあるので画像は飾り扱い（読み上げで同じ内容を二度聞かせない）。
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImageBroken(true)}
              className="size-full object-cover"
            />
          </div>
        )}
        <div className="min-w-0 flex-1 px-3 py-2">
          {isWork && (
            <Badge variant="secondary" className="mb-1">
              作品
            </Badge>
          )}
          <div className="line-clamp-2 text-sm font-medium text-on-surface [overflow-wrap:anywhere]">
            {heading}
          </div>
          {card.description !== '' && (
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-on-surface-variant">
              {card.description}
            </p>
          )}
          <div className="mt-1 flex items-center gap-1 text-xs text-on-surface-variant">
            <Globe className="size-3 shrink-0" aria-hidden="true" />
            {siteName !== '' && (
              <>
                <span className="truncate">{siteName}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="truncate">{card.host}</span>
          </div>
        </div>
      </Card>
    </a>
  )
}

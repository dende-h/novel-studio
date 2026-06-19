import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

interface ZoomableImageProps {
  /** 画像の data URL／URL。 */
  src: string
  /** アクセシブル名のもと（例: 用語名・「表紙」）。拡大表示の alt／見出しにも使う。 */
  alt: string
  /** トリガの <img>（サムネ）に当てる class。既存の見た目をそのまま渡す。 */
  className?: string
  /** トリガ button（ラッパ）に足す class。margin などレイアウト用。 */
  wrapperClassName?: string
}

/**
 * クリック（／Enter・Space）でモーダル拡大表示できる画像。
 * 図鑑サムネ・作品表紙など、小さく置かれた画像を原寸（ビューポート内に収まる範囲）で見るための共通部品。
 * Radix Dialog をそのまま使い、フォーカストラップ・Escape・スクロールロック・背景クリックで閉じるを得る。
 */
export function ZoomableImage({ src, alt, className, wrapperClassName }: ZoomableImageProps) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger
        aria-label={`${alt}を拡大表示`}
        className={cn(
          // w-fit で画像サイズに収縮（block 単体だと通常フローでカード幅まで広がりクリック域が過大になる）。
          'block w-fit shrink-0 cursor-zoom-in rounded-md outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          wrapperClassName,
        )}
      >
        {/* トリガ自身に aria-label があるので内側画像は装飾扱い（読み上げ二重化を避ける）。 */}
        <img src={src} alt="" className={className} />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          // 画像のみの拡大表示なので説明文は持たない（Radix の aria-describedby 警告を抑止）。
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">{alt}（拡大表示）</DialogPrimitive.Title>
          <img
            src={src}
            alt={alt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          />
          <DialogPrimitive.Close
            aria-label="拡大表示を閉じる"
            className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white outline-none transition-colors hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <X className="size-5" aria-hidden />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

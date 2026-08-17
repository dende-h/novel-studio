import { Cloud, LoaderCircle } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Button } from '@/ui/components/ui/button'

// 料金カード（Stripe 直課金・JPY）。サインイン済みユーザーだけがここに来るので lazy import。
const CloudPricing = lazy(() => import('@/ui/auth/cloud-pricing'))

interface SyncOnboardingProps {
  /** 案内を閉じて元の画面へ戻る。 */
  onDismiss: () => void
}

/**
 * クラウド同期（有料）の案内。
 *
 * かつては「未課金でサインイン済み」に対してこれを全画面で強制表示し、
 * 「購読する or サインアウトしてゲストに戻る」の二択に収束させていた（旧 §1.1
 * 「アカウント＝有料会員だけが持つ」）。
 * novel platform とアカウントを共有する以上、platform に無料登録しただけの人が
 * ここへ閉じ込められてしまうため、強制表示をやめて **任意の案内** に変えた。
 * 未課金でも書けるし公開もできる。ここで売るのは「制作中の資産を守る」ことだけ。
 *
 * 意図的に fixed オーバーレイにせず通常フローの全画面にしている：Clerk の Checkout ドロワー
 * （fixed ポータル）が自前オーバーレイと z 争いを起こさず、素直に上へ重なるようにするため。
 */
export function SyncOnboarding({ onDismiss }: SyncOnboardingProps) {
  return (
    <div className="min-h-dvh w-full overflow-y-auto bg-background font-sans">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-6 py-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-surface-container text-primary">
          <Cloud className="size-8" aria-hidden />
        </div>
        <div className="space-y-3">
          <h1 className="font-serif text-3xl text-on-surface">クラウド同期を始める</h1>
          <p className="mx-auto max-w-xl text-on-surface-variant leading-relaxed">
            複数端末での同期・自動バックアップ・版の履歴・AI/MCP アクセスをまとめて。 初回は 30
            日間無料でお試しできます。 書く・出す・公開する・ローカル保存はこれまでどおり無料です。
            守りたい原稿があるときにご検討ください。
          </p>
        </div>
        <div className="w-full">
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-12 text-on-surface-variant text-sm">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                料金プランを読み込み中…
              </div>
            }
          >
            <CloudPricing />
          </Suspense>
        </div>
        <Button
          variant="ghost"
          onClick={onDismiss}
          className="text-on-surface-variant hover:text-primary"
        >
          いまはしない
        </Button>
      </div>
    </div>
  )
}

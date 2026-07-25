import { Cloud, LoaderCircle } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Button } from '@/ui/components/ui/button'

// 料金カード（Stripe 直課金・JPY）。サインイン済みユーザーだけがここに来るので lazy import。
const CloudPricing = lazy(() => import('@/ui/auth/cloud-pricing'))

interface SyncOnboardingProps {
  /** 「ローカルのまま使う」＝サインアウトしてゲスト（同期オフ）に戻す。 */
  onUseLocal: () => void
}

/**
 * 未課金でサインイン済みのユーザーに出す全画面オンボーディング（Phase 4）。
 *
 * 仕様（§1.1「アカウント＝有料会員だけが持つ」）に沿い、「ログインしたが未課金」という中途半端な
 * ヘッダー状態を残さない。サインイン後に課金外だと分かったら、この画面で **購読する** か
 * **ローカルのまま使う（＝サインアウトしてゲストに戻る）** の二択に収束させる。購読の窓をここで
 * 残すことで「未課金は即サインアウト」の要望を、課金導線を壊さずに実現する。
 *
 * 意図的に fixed オーバーレイにせず通常フローの全画面にしている：Clerk の Checkout ドロワー
 * （fixed ポータル）が自前オーバーレイと z 争いを起こさず、素直に上へ重なるようにするため。
 */
export function SyncOnboarding({ onUseLocal }: SyncOnboardingProps) {
  return (
    <div className="min-h-dvh w-full overflow-y-auto bg-background font-sans">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-6 py-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-surface-container text-primary">
          <Cloud className="size-8" aria-hidden />
        </div>
        <div className="space-y-3">
          <h1 className="font-serif text-3xl text-on-surface">クラウド同期を始める</h1>
          <p className="mx-auto max-w-xl text-on-surface-variant leading-relaxed">
            複数端末での同期・自動バックアップ・AI/MCP
            アクセスをまとめて。書く・出す・ローカル保存は
            これまでどおり無料です。同期を使うにはプランの購読が必要です。
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
          onClick={onUseLocal}
          className="text-on-surface-variant hover:text-primary"
        >
          ローカルのまま使う（今はしない）
        </Button>
      </div>
    </div>
  )
}

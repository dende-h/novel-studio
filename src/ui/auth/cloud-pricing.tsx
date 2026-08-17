import { Check, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { type PlanInterval, startCheckout } from '@/ui/_api/billing'
import { useAuth } from '@/ui/auth/auth-context'
import { Button } from '@/ui/components/ui/button'

/**
 * クラウド版（有料）の料金カード。Stripe Checkout（JPY）へ遷移する。SyncOnboarding から使う。
 * 会員状態の取得先は D1（/api/billing/status）、決済は Stripe 直課金。
 */

const FEATURES = [
  'アウトライン・相関図・マインドマップ',
  '全データ暗号化のクラウドバックアップ＆復元',
  'AI に読み書きさせる（Claude・Genspark／MCP）',
  '複数端末で同じ原稿を同期',
]

const PLANS: Array<{
  interval: PlanInterval
  label: string
  price: string
  note: string
  highlight?: boolean
}> = [
  { interval: 'monthly', label: '月額プラン', price: '¥500', note: '／ 月' },
  { interval: 'yearly', label: '年額プラン', price: '¥4,800', note: '／ 年', highlight: true },
]

export default function CloudPricing() {
  const { getToken } = useAuth()
  const [busy, setBusy] = useState<PlanInterval | null>(null)

  const subscribe = async (plan: PlanInterval) => {
    setBusy(plan)
    const ok = await startCheckout(getToken, plan)
    if (!ok) setBusy(null) // 成功時は Stripe へ遷移するのでリセット不要。
  }

  return (
    <div className="w-full">
      <p className="mx-auto mb-4 max-w-xl rounded-lg bg-primary/10 px-4 py-2.5 font-sans text-[13px] text-primary">
        初回のご契約には <strong className="font-semibold">30 日間の無料トライアル</strong>
        が付きます。期間中に解約すれば料金はかかりません（お支払い方法の登録が必要です）。
      </p>
      <div className="mx-auto grid max-w-xl gap-4 sm:grid-cols-2">
        {PLANS.map((p) => (
          <div
            key={p.interval}
            className={cn(
              'rounded-2xl border p-6 text-left',
              p.highlight
                ? 'border-primary bg-surface-container'
                : 'border-outline-variant/40 bg-surface-container-lowest',
            )}
          >
            {p.highlight ? (
              <div className="mb-2 inline-block rounded-full bg-primary/15 px-3 py-1 font-sans text-primary text-xs">
                約2か月分お得
              </div>
            ) : null}
            <div className="font-sans text-on-surface-variant text-sm">{p.label}</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-serif text-3xl text-on-surface">{p.price}</span>
              <span className="text-on-surface-variant text-sm">{p.note}</span>
            </div>
            <Button
              onClick={() => void subscribe(p.interval)}
              disabled={busy !== null}
              className="mt-4 w-full"
            >
              {busy === p.interval ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                '購読する'
              )}
            </Button>
          </div>
        ))}
      </div>

      <ul className="mx-auto mt-6 max-w-md space-y-2">
        {FEATURES.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 text-left font-sans text-on-surface-variant text-sm"
          >
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
      <p className="mt-4 font-sans text-on-surface-variant text-xs">
        いつでも解約できます。無料の執筆・書き出し・ローカル保存はそのまま使えます。
      </p>
    </div>
  )
}

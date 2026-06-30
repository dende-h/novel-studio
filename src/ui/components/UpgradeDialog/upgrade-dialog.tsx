import { LoaderCircle } from 'lucide-react'
import { lazy, Suspense } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

// 料金表は @clerk/clerk-react を含むので別チャンク（ゲストの主バンドルに混ぜない）。
// ダイアログを開いたときだけ読み込む＝サインイン済み（既に Clerk チャンク取得済み）ユーザー限定。
const ClerkPricing = lazy(() => import('@/ui/auth/clerk-pricing'))

interface UpgradeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 「アップグレードで同期」課金導線（Phase 4 Slice E）。サインイン済みだが未課金のユーザーに
 * 有料クラウド束（同期／複数端末／自動バックアップ／AI・MCP アクセス）の料金表を見せ、Clerk
 * Billing の checkout に繋ぐ。課金成立で `has({ plan })` が真になり `deriveStatus` が member へ遷移し、
 * 同期が起動する。Clerk 無効（pk なし）な環境では呼び出し元の AccountControl 自体が描画されない。
 */
export function UpgradeDialog({ open, onOpenChange }: UpgradeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">アップグレードで同期</DialogTitle>
          <DialogDescription>
            クラウド同期・複数端末・自動バックアップ・AI/MCP アクセスをまとめて。
            書く・出す・ローカル保存はこれまでどおり無料です。
          </DialogDescription>
        </DialogHeader>
        <Suspense
          fallback={
            <div className="flex items-center justify-center gap-2 py-10 text-on-surface-variant text-sm">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              料金プランを読み込み中…
            </div>
          }
        >
          <ClerkPricing />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}

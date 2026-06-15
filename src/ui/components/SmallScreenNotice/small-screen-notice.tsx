import { MonitorSmartphone } from 'lucide-react'

/**
 * 狭い画面（スマートフォン等）向けの非対応案内。
 *
 * 対応下限は iPad mini の横画面相当の幅（lg = 1024px）。それ未満では本体を覆う
 * 全面オーバーレイで「非対応」を案内する。表示制御は CSS（lg:hidden）のみで行うため、
 * 画面回転・リサイズに JS なしで追従する。lg 以上では display:none となり、
 * フォーカス・スクリーンリーダーの対象にもならない。
 */
export function SmallScreenNotice() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-background px-8 text-center font-sans lg:hidden">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-surface-container text-primary">
        <MonitorSmartphone className="size-8" aria-hidden />
      </div>
      <p className="font-serif text-on-surface text-xl">スマートフォンには対応していません</p>
      <p className="max-w-sm text-on-surface-variant text-sm leading-relaxed">
        novel-studio はタブレットの横画面（iPad mini 程度の幅）以上でご利用いただけます。
        画面を横向きにするか、より大きな画面の端末でお開きください。
      </p>
    </div>
  )
}

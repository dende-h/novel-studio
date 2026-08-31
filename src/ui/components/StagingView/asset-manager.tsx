import { CloudUpload, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { HOSTED_ASSET_LIMIT, type UserGameAsset } from '@/core/game/assets'
import type { HostedPutResult } from '@/ui/_api/game-assets'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

/**
 * 持ち込み素材の管理（一覧・削除・クラウド保管の状態）。演出エディタから開く。
 * ローカル（この端末）が正で、クラウド保管は会員だけの「ほかの端末へ運ぶ」控え（D-GAME-PRICE）。
 */

interface AssetManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** この端末の素材（新しい順）。 */
  assets: UserGameAsset[]
  /** クラウドに保管中の素材 id。null ＝ 会員でない／一覧が取れていない。 */
  hostedIds: Set<string> | null
  /** 会員か（クラウド保管の操作と枚数表示を出すか）。 */
  member: boolean
  /**
   * 1 件削除。クラウド→この端末の順で消す（先にローカルを消すと、別端末からの
   * 取り込みで復活してしまう）。'failed' はクラウド側の失敗＝ローカルは残っている。
   */
  onDelete: (asset: UserGameAsset) => Promise<'ok' | 'failed'>
  /** この端末だけの素材をクラウドへ上げる（会員のみ）。 */
  onUpload: (asset: UserGameAsset) => Promise<HostedPutResult>
}

const KIND_LABELS: Record<string, string> = { bg: '背景', sprite: '立ち絵' }

/** クラウド保存の結果 → 利用者向けの短い文。'ok' は null（何も出さない）。 */
export function uploadNoticeOf(result: HostedPutResult): string | null {
  switch (result) {
    case 'ok':
      return null
    case 'limit_reached':
      return `クラウドが上限（${HOSTED_ASSET_LIMIT} 枚）です。素材はこの端末に保存されています。`
    case 'too_large':
      return 'この画像は大きすぎるため、クラウドには保存できませんでした。素材はこの端末に保存されています。'
    case 'failed':
      return 'クラウドへの保存に失敗しました。素材はこの端末に保存されています。もう一度お試しください。'
  }
}

export function AssetManager({
  open,
  onOpenChange,
  assets,
  hostedIds,
  member,
  onDelete,
  onUpload,
}: AssetManagerProps) {
  const [confirmTarget, setConfirmTarget] = useState<UserGameAsset | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const runDelete = async (asset: UserGameAsset) => {
    setBusyId(asset.id)
    setNotice(null)
    try {
      if ((await onDelete(asset)) === 'failed') {
        setNotice('クラウド側の削除に失敗しました。通信環境を確認して、もう一度お試しください。')
      }
    } finally {
      setBusyId(null)
    }
  }

  const runUpload = async (asset: UserGameAsset) => {
    setBusyId(asset.id)
    setNotice(null)
    try {
      setNotice(uploadNoticeOf(await onUpload(asset)))
    } finally {
      setBusyId(null)
    }
  }

  const confirmHosted = confirmTarget && member && (hostedIds?.has(confirmTarget.id) ?? true)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="text-left">
            <DialogTitle className="font-serif text-primary">持ち込み素材</DialogTitle>
            <DialogDescription>
              {member
                ? hostedIds
                  ? `クラウド保管 ${hostedIds.size} / ${HOSTED_ASSET_LIMIT} 枚。クラウドに保管した素材は、ほかの端末の演出エディタでも使えます。`
                  : 'クラウドの保管状況を取得できませんでした。素材はこの端末に保存されています。'
                : '素材はこの端末に保存されています。ほかの端末と共有するクラウド保管は、有料のクラウド版の機能です。'}
            </DialogDescription>
          </DialogHeader>

          {assets.length === 0 ? (
            <p className="p-2 text-on-surface-variant text-sm">
              持ち込み素材はまだありません。行を選んで、「背景」の（画像を追加…）から追加できます。
            </p>
          ) : (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto font-sans">
              {assets.map((asset) => {
                const hosted = hostedIds?.has(asset.id) ?? false
                return (
                  <li
                    key={asset.id}
                    className="flex items-center gap-3 rounded-md border border-outline-variant/30 p-2"
                  >
                    <img
                      src={asset.dataUrl}
                      alt=""
                      className="h-12 w-20 shrink-0 rounded border border-outline-variant/30 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-on-surface text-sm">{asset.name}</p>
                      <p className="mt-0.5 text-[11px] text-on-surface-variant">
                        {KIND_LABELS[asset.kind] ?? asset.kind}
                        {member ? `・${hosted ? 'クラウド保管済み' : 'この端末のみ'}` : ''}
                      </p>
                    </div>
                    {member && hostedIds && !hosted ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 gap-1 text-primary"
                        disabled={busyId === asset.id}
                        onClick={() => void runUpload(asset)}
                      >
                        <CloudUpload className="size-3.5" />
                        クラウドへ上げる
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 gap-1 text-destructive"
                      disabled={busyId === asset.id}
                      onClick={() => setConfirmTarget(asset)}
                    >
                      <Trash2 className="size-3.5" />
                      削除
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}

          {notice ? <p className="text-on-surface-variant text-xs">{notice}</p> : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmTarget(null)
        }}
        title="素材を削除しますか？"
        description={
          (confirmHosted
            ? 'この端末とクラウドの両方から削除します。'
            : 'この端末から削除します。') +
          'この素材を付けた演出の行では、書き出しにこの画像が出なくなります。'
        }
        onConfirm={() => {
          if (confirmTarget) void runDelete(confirmTarget)
        }}
      />
    </>
  )
}

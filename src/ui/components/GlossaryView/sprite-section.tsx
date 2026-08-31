import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_EXPRESSION,
  FREE_IMPORT_LIMIT,
  HOSTED_ASSET_LIMIT,
  importVerdict,
  type UserGameAsset,
} from '@/core/game/assets'
import {
  PRESET_SPRITE_TONE,
  PRESET_SPRITES,
  type PresetSprite,
  presetSpriteDataUrl,
} from '@/core/game/spritePresets'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import { gameSpriteToDataUrl } from '@/ui/_utils/imageResizer'
import { useAuth } from '@/ui/auth/auth-context'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { AssetManager, uploadNoticeOf } from '@/ui/components/StagingView/asset-manager'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import {
  type AssetHostingApi,
  createAssetHostingApi,
  pullHostedAssets,
} from '@/ui/game/asset-hosting'

/**
 * 用語集の人物 entry に出す「立ち絵」欄（図鑑側からの登録・管理・タスク #23）。
 * 実体は演出エディタと同じ素材層（GameAssetRepository・話者名で紐づく）で、
 * GlossaryEntry のスキーマには何も足さない＝公開される用語集を汚さず、同期契約も無改修。
 * 作る作業なので PC 限定（呼び出し側が max-lg:hidden で隠す。D-GAME-PC）。
 */

interface SpriteSectionProps {
  /** この人物の正式名（新しく登録する立ち絵はこの名前に紐づく） */
  name: string
  /** 別名（改名時の旧名を含む）。旧名に紐づく既存の立ち絵も一覧に出す */
  aliases: string[]
  assetRepo: GameAssetRepository
}

export function SpriteSection({ name, aliases, assetRepo }: SpriteSectionProps) {
  const auth = useAuth()
  const member = auth.status === 'member'
  const getToken = auth.getToken
  const hostingApi = useMemo<AssetHostingApi | null>(
    () => (member ? createAssetHostingApi(getToken) : null),
    [member, getToken],
  )
  // 素材は全件持つ（無料枠の枚数はテンプレ以外の総数で数えるため）。表示時に人物で絞る。
  const [assets, setAssets] = useState<UserGameAsset[]>([])
  const [hostedIds, setHostedIds] = useState<Set<string> | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{
    dataUrl: string
    tone: [string, string, string]
  } | null>(null)
  const [exprDraft, setExprDraft] = useState(DEFAULT_EXPRESSION)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<UserGameAsset | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void assetRepo.list().then((list) => {
      if (!cancelled) setAssets(list)
    })
    return () => {
      cancelled = true
    }
  }, [assetRepo])

  // 下り取り込み（演出エディタと同じ）：クラウドにあってこの端末に無い素材を引き込む。
  useEffect(() => {
    let cancelled = false
    setHostedIds(null)
    if (!hostingApi) return
    void pullHostedAssets(assetRepo, hostingApi).then(async (res) => {
      if (cancelled || !res) return
      setHostedIds(res.hostedIds)
      if (res.added.length > 0) {
        const list = await assetRepo.list()
        if (!cancelled) setAssets(list)
      }
    })
    return () => {
      cancelled = true
    }
  }, [assetRepo, hostingApi])

  const sprites = useMemo(
    () =>
      assets
        .filter(
          (a) =>
            a.kind === 'sprite' &&
            a.character &&
            (a.character === name || aliases.includes(a.character)),
        )
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    [assets, name, aliases],
  )
  const importedCount = useMemo(() => assets.filter((a) => !a.preset).length, [assets])

  const uploadToCloud = async (asset: UserGameAsset) => {
    if (!hostingApi) return 'failed' as const
    const result = await hostingApi.put(asset)
    if (result === 'ok') setHostedIds((prev) => new Set([...(prev ?? []), asset.id]))
    return result
  }

  const beginImport = () => {
    setNotice(null)
    setError(null)
    if (importVerdict(importedCount, member) === 'free_limit') {
      setNotice(
        `画像の持ち込みは、無料プランでは ${FREE_IMPORT_LIMIT} 枚までです。テンプレの背景と立ち絵は枚数に入りません。枠を空けるには、素材の管理から削除します。クラウド版では ${HOSTED_ASSET_LIMIT} 枚まで持ち込め、ほかの端末とも共有できます。`,
      )
      return
    }
    fileInputRef.current?.click()
  }

  const pickFile = async (file: File) => {
    setError(null)
    setNotice(null)
    try {
      setPending(await gameSpriteToDataUrl(file))
      setExprDraft(DEFAULT_EXPRESSION)
    } catch {
      setError('この画像は読み込めませんでした。別のファイルでお試しください。')
    }
  }

  const commitUpload = async () => {
    if (!pending) return
    const expression = exprDraft.trim() || DEFAULT_EXPRESSION
    const asset: UserGameAsset = {
      id: crypto.randomUUID(),
      kind: 'sprite',
      name: `${name}（${expression}）`,
      dataUrl: pending.dataUrl,
      tone: pending.tone,
      character: name,
      expression,
      createdAt: Date.now(),
    }
    await assetRepo.save(asset)
    setAssets((prev) => [asset, ...prev])
    setPending(null)
    if (hostingApi) void uploadToCloud(asset).then((r) => setNotice(uploadNoticeOf(r)))
  }

  /** テンプレの割り当て（この人物のテンプレ由来が既にあれば差し替え・枚数に数えない）。 */
  const pickTemplate = async (preset: PresetSprite) => {
    setNotice(null)
    setPickerOpen(false)
    const existing = assets.find((a) => a.kind === 'sprite' && a.character === name && a.preset)
    const asset: UserGameAsset = existing
      ? {
          ...existing,
          name: `${name}（${preset.label}）`,
          dataUrl: presetSpriteDataUrl(preset),
          preset: preset.key,
        }
      : {
          id: `tpl-${crypto.randomUUID()}`,
          kind: 'sprite',
          name: `${name}（${preset.label}）`,
          dataUrl: presetSpriteDataUrl(preset),
          tone: PRESET_SPRITE_TONE,
          character: name,
          expression: DEFAULT_EXPRESSION,
          preset: preset.key,
          createdAt: Date.now(),
        }
    await assetRepo.save(asset)
    setAssets((prev) =>
      existing ? prev.map((a) => (a.id === asset.id ? asset : a)) : [asset, ...prev],
    )
    if (hostingApi) void uploadToCloud(asset).then((r) => setNotice(uploadNoticeOf(r)))
  }

  /** 削除はクラウド→端末の順（演出エディタと同じ契約。先に端末を消すと下りで復活する）。 */
  const removeSprite = async (asset: UserGameAsset) => {
    setNotice(null)
    if (hostingApi && (hostedIds === null || hostedIds.has(asset.id))) {
      if (!(await hostingApi.remove(asset.id))) {
        setNotice('クラウド側の削除に失敗しました。通信環境を確認して、もう一度お試しください。')
        return
      }
      setHostedIds((prev) => {
        if (!prev) return prev
        const next = new Set(prev)
        next.delete(asset.id)
        return next
      })
    }
    await assetRepo.remove(asset.id)
    setAssets((prev) => prev.filter((a) => a.id !== asset.id))
  }

  return (
    <section className="space-y-1.5">
      <Label>立ち絵（サウンドノベル用・任意）</Label>
      <p className="text-[11px] text-on-surface-variant leading-relaxed">
        この人物のセリフで自動的に表示されます。表情を分けて登録すると、演出で切り替えられます。
      </p>

      {sprites.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {sprites.map((asset) => (
            <li
              key={asset.id}
              className="w-24 rounded-md border border-outline-variant/30 p-1.5 text-center"
            >
              <img src={asset.dataUrl} alt={asset.name} className="mx-auto h-24 object-contain" />
              <p className="mt-1 truncate text-[10px] text-on-surface-variant">
                {asset.expression?.trim() || DEFAULT_EXPRESSION}
                {asset.preset ? '・テンプレ' : ''}
              </p>
              {asset.character && asset.character !== name ? (
                <p className="truncate text-[10px] text-on-surface-variant/60">
                  旧名「{asset.character}」
                </p>
              ) : null}
              <button
                type="button"
                aria-label={`立ち絵「${asset.name}」を削除`}
                onClick={() => setConfirmTarget(asset)}
                className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-on-surface-variant/70 transition-colors hover:bg-error-container hover:text-destructive"
              >
                <Trash2 className="size-3" aria-hidden />
                削除
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {pending ? (
        <div className="space-y-2 rounded-md border border-outline-variant/30 p-2">
          <img src={pending.dataUrl} alt="追加する立ち絵" className="mx-auto h-32 object-contain" />
          <Input
            aria-label="表情名"
            value={exprDraft}
            placeholder={DEFAULT_EXPRESSION}
            onChange={(e) => setExprDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void commitUpload()}>
              追加
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPending(null)}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-primary"
            onClick={beginImport}
          >
            立ち絵を追加…
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-primary"
            onClick={() => setPickerOpen((v) => !v)}
          >
            テンプレから選ぶ…
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-on-surface-variant"
            onClick={() => setManagerOpen(true)}
          >
            素材の管理
          </Button>
        </div>
      )}

      {pickerOpen && !pending ? (
        <div className="grid max-w-md grid-cols-3 gap-2 rounded-md border border-outline-variant/30 p-2">
          {PRESET_SPRITES.map((p) => (
            <button
              key={p.key}
              type="button"
              className="rounded-md border border-outline-variant/30 p-1 hover:bg-surface-container-high"
              onClick={() => void pickTemplate(p)}
            >
              <img src={presetSpriteDataUrl(p)} alt="" className="mx-auto h-20 object-contain" />
              <span className="mt-1 block text-center text-[10px] text-on-surface-variant leading-tight">
                {p.label.replace('シルエット', '')}
              </span>
            </button>
          ))}
          <p className="col-span-3 text-[11px] text-on-surface-variant">
            テンプレの立ち絵は枚数に数えません。
          </p>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        aria-label="立ち絵の画像を選ぶ"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void pickFile(file)
        }}
      />
      {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
      {notice ? (
        <p className="text-[11px] text-on-surface-variant leading-relaxed">{notice}</p>
      ) : null}

      <AssetManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        assets={assets}
        hostedIds={hostedIds}
        member={member}
        onDelete={async (asset) => {
          if (hostingApi && (hostedIds === null || hostedIds.has(asset.id))) {
            if (!(await hostingApi.remove(asset.id))) return 'failed'
            setHostedIds((prev) => {
              if (!prev) return prev
              const next = new Set(prev)
              next.delete(asset.id)
              return next
            })
          }
          await assetRepo.remove(asset.id)
          setAssets((prev) => prev.filter((a) => a.id !== asset.id))
          return 'ok'
        }}
        onUpload={uploadToCloud}
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmTarget(null)
        }}
        title="立ち絵を削除しますか？"
        description={
          (member ? 'この端末とクラウドの両方から削除します。' : 'この端末から削除します。') +
          'この人物のセリフで、この立ち絵は表示されなくなります。'
        }
        onConfirm={() => {
          if (confirmTarget) void removeSprite(confirmTarget)
        }}
      />
    </section>
  )
}

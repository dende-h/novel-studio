import { Images, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyCues,
  type Cue,
  emptyStaging,
  findOrphanCues,
  MASKED_SPEAKER,
  patchCue,
  plainTextOfBlock,
  removeCue,
  type Staging,
  suggestSceneBreaks,
  suggestSpeaker,
  toPages,
} from '@/core/game'
import {
  DEFAULT_EXPRESSION,
  FREE_IMPORT_LIMIT,
  HOSTED_ASSET_LIMIT,
  importVerdict,
  pickSprite,
  spriteExpressionsOf,
  type UserGameAsset,
  userAssetKey,
} from '@/core/game/assets'
import { PRESET_BACKGROUNDS, presetBackground, presetBgSvg } from '@/core/game/presets'
import {
  PRESET_SPRITE_TONE,
  PRESET_SPRITES,
  type PresetSprite,
  presetSpriteDataUrl,
} from '@/core/game/spritePresets'
import { PERSON_CATEGORY } from '@/core/glossary'
import type { Work } from '@/core/schema'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import { cn } from '@/lib/utils'
import { gameBgToDataUrl, gameSpriteToDataUrl } from '@/ui/_utils/imageResizer'
import { useAuth } from '@/ui/auth/auth-context'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Switch } from '@/ui/components/ui/switch'
import {
  type AssetHostingApi,
  createAssetHostingApi,
  pullHostedAssets,
} from '@/ui/game/asset-hosting'
import { AssetManager, uploadNoticeOf } from './asset-manager'

/**
 * 演出エディタ（サウンドノベルの Staging・G1）。設計は docs/requirement/07-novel-game.md §3。
 *
 * 保存済みの本文（正本 blocks）を行ごとに並べ、話者・背景・場面の切れ目を付ける。
 * 本文は一切書き換えない（cue が blockId で張り付くだけ）。自動判定は**提案どまり**で、
 * 確定は常にユーザーが行う（D-GAME-SCENE-MANUAL / D-GAME-SPEAKER-MCP）。
 * 変更はその場で保存する（アプリ全体の自動保存の流儀に合わせる）。
 */

interface StagingViewProps {
  repo: StagingRepository
  work: Work
  /** エディタで開いている話（初期選択）。 */
  currentEpisodeId: string | null
  /** 持ち込み背景の置き場所（渡されたときだけ「画像を追加…」が出る）。 */
  assetRepo?: GameAssetRepository
}

const SELECT_CLASS =
  'w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 text-base text-on-surface outline-none focus:border-primary md:text-sm'

const TRANSITIONS: { value: NonNullable<Cue['transition']>; label: string }[] = [
  { value: 'fade', label: 'ゆっくり切り替え' },
  { value: 'cut', label: 'ぱっと切り替え' },
  { value: 'flash', label: '白いフラッシュ' },
]

/** 話者セレクトの「自由に入力…」の目印（cue には入らない）。 */
const CUSTOM_SPEAKER = '__custom__'
/** 背景セレクトの「画像を追加…」の目印（cue には入らない）。 */
const ADD_IMAGE = '__add_image__'

/** 背景キーの表示名（テンプレ／持ち込み。どちらでもなければ undefined）。 */
function bgLabelOf(key: string, assets: UserGameAsset[]): string | undefined {
  const preset = presetBackground(key)
  if (preset) return preset.label
  return assets.find((a) => userAssetKey(a.id) === key)?.name
}

/** 背景キーのプレビュー画像（テンプレは SVG を生成、持ち込みは保存済み data URL）。 */
function bgPreviewSrc(key: string | undefined, assets: UserGameAsset[]): string | undefined {
  if (!key) return undefined
  const preset = presetBackground(key)
  if (preset) return `data:image/svg+xml;utf8,${encodeURIComponent(presetBgSvg(preset))}`
  return assets.find((a) => userAssetKey(a.id) === key)?.dataUrl
}

export default function StagingView({ repo, work, currentEpisodeId, assetRepo }: StagingViewProps) {
  const episodes = work.episodes
  const [episodeId, setEpisodeId] = useState(currentEpisodeId ?? episodes[0]?.id ?? '')
  const episode = episodes.find((e) => e.id === episodeId) ?? episodes[0] ?? null
  // null ＝ 読込中。話を切り替えるたびに引き直す。
  const [staging, setStaging] = useState<Staging | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 話者の自由記述モード（選択中の行にだけ効く。行を替えたら閉じる）
  const [customSpeaker, setCustomSpeaker] = useState(false)
  const [customDraft, setCustomDraft] = useState('')
  // 立ち絵の追加（画像を選んだあと、表情名を付けて確定する2段階）
  const [pendingSprite, setPendingSprite] = useState<{
    dataUrl: string
    tone: [string, string, string]
  } | null>(null)
  const [spriteExprDraft, setSpriteExprDraft] = useState(DEFAULT_EXPRESSION)
  const spriteInputRef = useRef<HTMLInputElement>(null)
  // テンプレ立ち絵のピッカー（選択中の行にだけ効く。行を替えたら閉じる）
  const [spritePickerOpen, setSpritePickerOpen] = useState(false)
  // 持ち込み背景（この端末のローカル資産）
  const [assets, setAssets] = useState<UserGameAsset[]>([])
  const [assetError, setAssetError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // クラウド保管（R2 ホスティング・会員のみ）。ローカルが正で、クラウドは端末間で運ぶ控え。
  const auth = useAuth()
  const member = auth.status === 'member'
  const getToken = auth.getToken
  const hostingApi = useMemo<AssetHostingApi | null>(
    () => (assetRepo && member ? createAssetHostingApi(getToken) : null),
    [assetRepo, member, getToken],
  )
  // クラウドに保管中の素材 id。null ＝ 非会員／一覧が取れていない（バッジと枚数を出さない）。
  const [hostedIds, setHostedIds] = useState<Set<string> | null>(null)
  const [hostNotice, setHostNotice] = useState<string | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!assetRepo) return
    void assetRepo.list().then((list) => {
      if (!cancelled) setAssets(list)
    })
    return () => {
      cancelled = true
    }
  }, [assetRepo])

  // 下り取り込み：クラウドにあってこの端末に無い素材を、演出エディタを開いたときに引き込む。
  useEffect(() => {
    let cancelled = false
    setHostedIds(null)
    if (!assetRepo || !hostingApi) return
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

  useEffect(() => {
    let cancelled = false
    setStaging(null)
    setSelectedId(null)
    if (!episode) return
    void repo.get(work.id, episode.id).then((s) => {
      if (!cancelled) setStaging(s ?? emptyStaging(work.id, episode.id, Date.now()))
    })
    return () => {
      cancelled = true
    }
  }, [repo, work.id, episode])

  // この作品の演出（全話）で使った話者名。自由記述した名前を、別の行・別の話でも
  // 選び直せるようにする（本文からの抽出は**しない**——出所は常に演出譜だけ）。
  const [workSpeakers, setWorkSpeakers] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    void repo.listByWork(work.id).then((all) => {
      if (cancelled) return
      const names = new Set<string>()
      for (const s of all) {
        for (const c of s.cues) if (c.speaker) names.add(c.speaker)
      }
      setWorkSpeakers([...names])
    })
    return () => {
      cancelled = true
    }
  }, [repo, work.id])

  const pages = useMemo(() => (episode ? toPages(episode.blocks) : []), [episode])
  const staged = useMemo(() => applyCues(pages, staging ?? undefined), [pages, staging])
  const suggestions = useMemo(
    () => new Set(episode ? suggestSceneBreaks(episode.blocks) : []),
    [episode],
  )
  const orphans = useMemo(
    () => (staging && episode ? findOrphanCues(staging, episode) : []),
    [staging, episode],
  )
  const persons = useMemo(
    () => (work.glossary ?? []).filter((e) => PERSON_CATEGORY.test(e.category ?? '')),
    [work.glossary],
  )
  // 背景の選択肢に立ち絵を混ぜない
  const bgAssets = useMemo(() => assets.filter((a) => a.kind === 'bg'), [assets])
  // 立ち絵のある人物（登場セレクトの選択肢）
  const spriteCharacters = useMemo(() => {
    const names = new Set<string>()
    for (const a of assets) if (a.kind === 'sprite' && a.character) names.add(a.character)
    return [...names].sort((a, b) => a.localeCompare(b, 'ja'))
  }, [assets])
  // 持ち込み枚数（テンプレ由来は数えない）。無料プランは FREE_IMPORT_LIMIT まで。
  const importedCount = useMemo(() => assets.filter((a) => !a.preset).length, [assets])

  /** 画像の持ち込みを始める（無料枠の判定に通ったらファイル選択を開く）。 */
  const beginImport = (input: HTMLInputElement | null) => {
    setHostNotice(null)
    if (importVerdict(importedCount, member) === 'free_limit') {
      setHostNotice(
        `画像の持ち込みは、無料プランでは ${FREE_IMPORT_LIMIT} 枚までです。テンプレの背景と立ち絵は枚数に入りません。枠を空けるには、素材の管理から削除します。クラウド版では ${HOSTED_ASSET_LIMIT} 枚まで持ち込め、ほかの端末とも共有できます。`,
      )
      return
    }
    input?.click()
  }
  // 話者の選択肢：用語集の人物とは別に、この作品の演出で使った名前（編集中の話は保存前の分も拾う）
  const usedSpeakers = useMemo(() => {
    const names = new Set(workSpeakers)
    for (const c of staging?.cues ?? []) if (c.speaker) names.add(c.speaker)
    return [...names]
      .filter((n) => n !== MASKED_SPEAKER && !persons.some((p) => p.name === n))
      .sort((a, b) => a.localeCompare(b, 'ja'))
  }, [workSpeakers, staging, persons])
  const blockTextById = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of episode?.blocks ?? []) m.set(b.id, plainTextOfBlock(b))
    return m
  }, [episode])
  const blockIndexById = useMemo(() => {
    const m = new Map<string, number>()
    for (const [i, b] of (episode?.blocks ?? []).entries()) m.set(b.id, i)
    return m
  }, [episode])

  const selected = staged.find((p) => p.blockId === selectedId) ?? null
  // 選択行の話者に紐づく立ち絵（表情の選択肢とプレビュー）
  const speakerExpressions = useMemo(
    () =>
      selected?.speaker && selected.speaker !== MASKED_SPEAKER
        ? spriteExpressionsOf(assets, selected.speaker)
        : [],
    [assets, selected?.speaker],
  )
  const spritePreview =
    selected?.speaker && selected.speaker !== MASKED_SPEAKER
      ? pickSprite(assets, selected.speaker, selected.expression)
      : undefined
  const speakerCandidate = useMemo(() => {
    if (!episode || !selected || selected.kind !== 'dialogue') return undefined
    const index = blockIndexById.get(selected.blockId)
    if (index === undefined) return undefined
    return suggestSpeaker(episode.blocks, index, work.glossary ?? [])
  }, [episode, selected, blockIndexById, work.glossary])

  const apply = (blockId: string, patch: Parameters<typeof patchCue>[2]) => {
    if (!staging) return
    const next = patchCue(staging, blockId, patch, Date.now())
    setStaging(next)
    void repo.save(next)
  }
  const clearCue = (blockId: string) => {
    if (!staging) return
    const next = removeCue(staging, blockId, Date.now())
    setStaging(next)
    void repo.save(next)
  }
  const selectRow = (blockId: string) => {
    setSelectedId(blockId)
    setCustomSpeaker(false)
    setPendingSprite(null)
    setSpritePickerOpen(false)
  }
  const commitCustomSpeaker = (blockId: string) => {
    const name = customDraft.trim()
    setCustomSpeaker(false)
    apply(blockId, { speaker: name || undefined })
  }
  /** 画像ファイル → リサイズして保存 → その行の背景に設定。会員はクラウドにも控えを置く。 */
  const addImage = async (file: File, blockId: string) => {
    if (!assetRepo) return
    setAssetError(null)
    setHostNotice(null)
    try {
      const { dataUrl, tone } = await gameBgToDataUrl(file)
      const asset: UserGameAsset = {
        id: crypto.randomUUID(),
        kind: 'bg',
        name: file.name.replace(/\.[^.]+$/, '') || '持ち込み背景',
        dataUrl,
        tone,
        createdAt: Date.now(),
      }
      await assetRepo.save(asset)
      setAssets((prev) => [asset, ...prev])
      apply(blockId, { bg: userAssetKey(asset.id) })
      if (hostingApi) void uploadAsset(asset).then((r) => setHostNotice(uploadNoticeOf(r)))
    } catch {
      setAssetError('この画像は読み込めませんでした。別のファイルでお試しください。')
    }
  }

  /** 1 件をクラウドへ保存し、成功なら保管中バッジを更新する（追加時と管理画面の共通経路）。 */
  const uploadAsset = async (asset: UserGameAsset) => {
    if (!hostingApi) return 'failed' as const
    const result = await hostingApi.put(asset)
    if (result === 'ok') {
      setHostedIds((prev) => new Set([...(prev ?? []), asset.id]))
    }
    return result
  }

  /** 立ち絵の画像ファイル → リサイズだけ済ませ、表情名の入力（commitSprite）を待つ。 */
  const pickSpriteFile = async (file: File) => {
    setAssetError(null)
    setHostNotice(null)
    try {
      setPendingSprite(await gameSpriteToDataUrl(file))
      setSpriteExprDraft(DEFAULT_EXPRESSION)
    } catch {
      setAssetError('この画像は読み込めませんでした。別のファイルでお試しください。')
    }
  }

  /**
   * テンプレ立ち絵を話者へ割り当てる（無料でも使える・枚数に数えない）。
   * 同じ話者のテンプレ割り当てが既にあれば差し替える（持ち込んだ絵には触れない）。
   */
  const pickTemplateSprite = async (speaker: string, preset: PresetSprite) => {
    if (!assetRepo) return
    setHostNotice(null)
    setSpritePickerOpen(false)
    const existing = assets.find((a) => a.kind === 'sprite' && a.character === speaker && a.preset)
    const asset: UserGameAsset = existing
      ? {
          ...existing,
          name: `${speaker}（${preset.label}）`,
          dataUrl: presetSpriteDataUrl(preset),
          preset: preset.key,
        }
      : {
          id: `tpl-${crypto.randomUUID()}`,
          kind: 'sprite',
          name: `${speaker}（${preset.label}）`,
          dataUrl: presetSpriteDataUrl(preset),
          tone: PRESET_SPRITE_TONE,
          character: speaker,
          expression: DEFAULT_EXPRESSION,
          preset: preset.key,
          createdAt: Date.now(),
        }
    await assetRepo.save(asset)
    setAssets((prev) =>
      existing ? prev.map((a) => (a.id === asset.id ? asset : a)) : [asset, ...prev],
    )
    if (hostingApi) void uploadAsset(asset).then((r) => setHostNotice(uploadNoticeOf(r)))
  }

  /** 立ち絵を確定保存する（話者に自動で紐づく。会員はクラウドにも控えを置く）。 */
  const commitSprite = async (speaker: string) => {
    if (!assetRepo || !pendingSprite) return
    const expression = spriteExprDraft.trim() || DEFAULT_EXPRESSION
    const asset: UserGameAsset = {
      id: crypto.randomUUID(),
      kind: 'sprite',
      name: `${speaker}（${expression}）`,
      dataUrl: pendingSprite.dataUrl,
      tone: pendingSprite.tone,
      character: speaker,
      expression,
      createdAt: Date.now(),
    }
    await assetRepo.save(asset)
    setAssets((prev) => [asset, ...prev])
    setPendingSprite(null)
    if (hostingApi) void uploadAsset(asset).then((r) => setHostNotice(uploadNoticeOf(r)))
  }

  /**
   * 1 件削除。クラウド→この端末の順（先にローカルを消すと、次の下り取り込みで復活する）。
   * 保管状況が取れていないとき（hostedIds === null）もクラウド側の削除を試す（冪等）。
   */
  const deleteAsset = async (asset: UserGameAsset): Promise<'ok' | 'failed'> => {
    if (!assetRepo) return 'failed'
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
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col font-sans">
      <header className="shrink-0 border-outline-variant/30 border-b px-6 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <h2 className="font-serif text-primary text-xl">演出（サウンドノベル）</h2>
            <p className="mt-0.5 text-on-surface-variant text-xs">
              話者・背景・場面の切れ目を行ごとに付けます。付けた演出は、書き出しの「サウンドノベル」で使われます。本文は変わりません。
            </p>
          </div>
          {assetRepo ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto gap-2 text-primary"
              onClick={() => setManagerOpen(true)}
            >
              <Images className="size-4" />
              素材の管理
            </Button>
          ) : null}
          <label
            className={cn(
              'flex items-center gap-2 text-on-surface-variant text-xs',
              !assetRepo && 'ml-auto',
            )}
          >
            話
            <select
              value={episode?.id ?? ''}
              onChange={(e) => setEpisodeId(e.target.value)}
              className={cn(SELECT_CLASS, 'w-56')}
            >
              {episodes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 行の一覧 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {orphans.length > 0 && staging ? (
            <section className="mb-4 rounded-md border border-outline-variant/40 bg-surface-container-low p-3">
              <h3 className="font-medium text-on-surface text-sm">行き先を失った演出</h3>
              <p className="mt-0.5 text-on-surface-variant text-xs">
                本文の変更で、張り付いていた行が無くなった演出です。不要なら外してください。
              </p>
              <ul className="mt-2 space-y-1">
                {orphans.map((cue) => (
                  <li
                    key={cue.blockId}
                    className="flex items-center justify-between gap-3 rounded border border-outline-variant/30 px-2 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate text-on-surface-variant">
                      {describeCue(cue, assets)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 gap-1 text-destructive"
                      onClick={() => clearCue(cue.blockId)}
                    >
                      <Trash2 className="size-3.5" />
                      外す
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!episode || episode.blocks.length === 0 ? (
            <p className="p-6 text-center text-on-surface-variant text-sm">
              この話にはまだ本文がありません。エディタで書いて保存すると、ここに行が並びます。
            </p>
          ) : staging === null ? (
            <p className="p-6 text-center text-on-surface-variant text-sm">読み込んでいます…</p>
          ) : (
            <ul className="mx-auto max-w-3xl space-y-1">
              {staged.map((page) => {
                const active = page.blockId === selectedId
                const bgLabel = page.bg ? bgLabelOf(page.bg, assets) : undefined
                const suggested = suggestions.has(page.blockId) && !page.sceneBreak
                return (
                  <li key={page.blockId}>
                    {page.beat > 0 ? (
                      <div className="my-1 flex items-center gap-2 px-2 text-[11px] text-on-surface-variant/60">
                        <span className="h-px flex-1 bg-outline-variant/40" />
                        間（空行 {page.beat}）
                        <span className="h-px flex-1 bg-outline-variant/40" />
                      </div>
                    ) : null}
                    {page.sceneBreak ? (
                      <div className="my-1 flex items-center gap-2 px-2 font-medium text-[11px] text-primary">
                        <span className="h-px flex-1 bg-primary/40" />
                        場面の切れ目{bgLabel ? `・背景 ${bgLabel}` : ''}
                        <span className="h-px flex-1 bg-primary/40" />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => selectRow(page.blockId)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md border p-2 text-left transition-colors',
                        active
                          ? 'border-primary bg-surface-container-highest'
                          : 'border-outline-variant/30 bg-surface hover:bg-surface-container-high',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 shrink-0 rounded-full border px-1.5 py-px text-[10px]',
                          page.kind === 'dialogue'
                            ? 'border-primary/40 text-primary'
                            : 'border-outline-variant/50 text-on-surface-variant',
                        )}
                      >
                        {page.kind === 'dialogue' ? 'セリフ' : '地の文'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-serif text-on-surface text-sm">
                          {blockTextById.get(page.blockId) ?? ''}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-on-surface-variant">
                          {page.kind === 'dialogue' ? (
                            <span>話者：{page.speaker ?? '—'}</span>
                          ) : null}
                          {page.kind === 'dialogue' && page.expression ? (
                            <span>表情 {page.expression}</span>
                          ) : null}
                          {page.appear ? <span>登場 {page.appear}</span> : null}
                          {!page.sceneBreak && bgLabel ? <span>背景 {bgLabel}</span> : null}
                        </span>
                      </span>
                      {suggested ? (
                        <span className="mt-0.5 shrink-0 rounded-full border border-outline-variant/50 px-1.5 py-px text-[10px] text-on-surface-variant">
                          場面の切れ目？
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* 選択行の演出 */}
        <aside className="w-80 shrink-0 overflow-y-auto border-outline-variant/30 border-l bg-surface-container-lowest p-4 2xl:w-96">
          {!selected || !staging ? (
            <p className="p-2 text-on-surface-variant text-sm">
              左の一覧から行を選ぶと、ここで演出を編集できます。
            </p>
          ) : (
            <div className="space-y-5">
              <p className="rounded-md bg-surface-container-low p-3 font-serif text-on-surface text-sm leading-relaxed">
                {blockTextById.get(selected.blockId) ?? ''}
              </p>

              {hostNotice ? (
                <p className="text-on-surface-variant text-xs leading-relaxed">{hostNotice}</p>
              ) : null}

              {selected.kind === 'dialogue' ? (
                <div>
                  <label
                    htmlFor="staging-speaker"
                    className="mb-2 block text-on-surface-variant text-xs uppercase tracking-wider"
                  >
                    話者
                  </label>
                  <select
                    id="staging-speaker"
                    value={customSpeaker ? CUSTOM_SPEAKER : (selected.speaker ?? '')}
                    onChange={(e) => {
                      const value = e.target.value
                      if (value === CUSTOM_SPEAKER) {
                        // まだ保存しない。下の入力欄で名前を書いたときに保存する
                        setCustomDraft(selected.speaker ?? '')
                        setCustomSpeaker(true)
                        return
                      }
                      setCustomSpeaker(false)
                      apply(selected.blockId, { speaker: value || undefined })
                    }}
                    className={SELECT_CLASS}
                  >
                    <option value="">（名前を出さない）</option>
                    <option value={MASKED_SPEAKER}>？？？（名前を伏せる）</option>
                    {persons.length > 0 ? (
                      <optgroup label="用語集の人物">
                        {persons.map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {/* 自由記述で付けた名前の再利用（用語集の人物と重なる分は上のグループへ） */}
                    {usedSpeakers.length > 0 ? (
                      <optgroup label="この作品の演出で使った名前">
                        {usedSpeakers.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    <option value={CUSTOM_SPEAKER}>（自由に入力…）</option>
                  </select>
                  {customSpeaker ? (
                    <Input
                      aria-label="話者名を入力"
                      value={customDraft}
                      placeholder="表示する名前"
                      autoFocus
                      onChange={(e) => setCustomDraft(e.target.value)}
                      onBlur={() => commitCustomSpeaker(selected.blockId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitCustomSpeaker(selected.blockId)
                      }}
                      className="mt-2"
                    />
                  ) : null}
                  {persons.length === 0 ? (
                    <p className="mt-2 text-[11px] text-on-surface-variant leading-relaxed">
                      用語集に「人物」を登録すると、ここの候補に並びます。
                    </p>
                  ) : null}
                  {speakerCandidate && speakerCandidate !== selected.speaker ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 text-primary"
                      onClick={() => {
                        setCustomSpeaker(false)
                        apply(selected.blockId, { speaker: speakerCandidate })
                      }}
                    >
                      候補「{speakerCandidate}」を使う
                    </Button>
                  ) : null}

                  {selected.speaker && selected.speaker !== MASKED_SPEAKER && assetRepo ? (
                    <div className="mt-4">
                      <label
                        htmlFor="staging-expression"
                        className="mb-2 block text-on-surface-variant text-xs uppercase tracking-wider"
                      >
                        立ち絵
                      </label>
                      {speakerExpressions.length > 0 ? (
                        <>
                          <select
                            id="staging-expression"
                            value={selected.expression ?? ''}
                            onChange={(e) =>
                              apply(selected.blockId, {
                                expression: e.target.value || undefined,
                              })
                            }
                            className={SELECT_CLASS}
                          >
                            <option value="">（自動：{DEFAULT_EXPRESSION}）</option>
                            {/* 未登録の表情が付いた既存 cue も選択状態は保つ（勝手に外さない） */}
                            {selected.expression &&
                            !speakerExpressions.includes(selected.expression) ? (
                              <option value={selected.expression}>
                                {selected.expression}（この表情は未登録）
                              </option>
                            ) : null}
                            {speakerExpressions.map((e) => (
                              <option key={e} value={e}>
                                {e}
                              </option>
                            ))}
                          </select>
                          {spritePreview ? (
                            <img
                              src={spritePreview.dataUrl}
                              alt={`立ち絵プレビュー: ${spritePreview.name}`}
                              className="mx-auto mt-2 h-40 object-contain"
                            />
                          ) : null}
                        </>
                      ) : (
                        <p className="text-[11px] text-on-surface-variant leading-relaxed">
                          「{selected.speaker}
                          」の立ち絵はまだありません。追加すると、この話者のセリフで自動的に表示されます。
                        </p>
                      )}
                      {pendingSprite ? (
                        <div className="mt-2 space-y-2 rounded-md border border-outline-variant/30 p-2">
                          <img
                            src={pendingSprite.dataUrl}
                            alt="追加する立ち絵"
                            className="mx-auto h-40 object-contain"
                          />
                          <Input
                            aria-label="表情名"
                            value={spriteExprDraft}
                            placeholder={DEFAULT_EXPRESSION}
                            onChange={(e) => setSpriteExprDraft(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void commitSprite(selected.speaker ?? '')}
                            >
                              追加
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setPendingSprite(null)}
                            >
                              やめる
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-primary"
                            onClick={() => beginImport(spriteInputRef.current)}
                          >
                            立ち絵を追加…
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-primary"
                            onClick={() => setSpritePickerOpen((v) => !v)}
                          >
                            テンプレから選ぶ…
                          </Button>
                        </div>
                      )}
                      {spritePickerOpen && !pendingSprite ? (
                        <div className="mt-2 grid grid-cols-3 gap-2 rounded-md border border-outline-variant/30 p-2">
                          {PRESET_SPRITES.map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              className="rounded-md border border-outline-variant/30 p-1 hover:bg-surface-container-high"
                              onClick={() => void pickTemplateSprite(selected.speaker ?? '', p)}
                            >
                              <img
                                src={presetSpriteDataUrl(p)}
                                alt=""
                                className="mx-auto h-20 object-contain"
                              />
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
                        ref={spriteInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        aria-label="立ち絵の画像を選ぶ"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (file) void pickSpriteFile(file)
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selected.kind === 'narration' &&
              assetRepo &&
              (spriteCharacters.length > 0 || selected.appear) ? (
                <div>
                  <label
                    htmlFor="staging-appear"
                    className="mb-2 block text-on-surface-variant text-xs uppercase tracking-wider"
                  >
                    立ち絵の登場
                  </label>
                  <select
                    id="staging-appear"
                    value={selected.appear ?? ''}
                    onChange={(e) =>
                      apply(selected.blockId, { appear: e.target.value || undefined })
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="">（なし）</option>
                    {/* 立ち絵が無くなった人物の既存 cue も選択状態は保つ（勝手に外さない） */}
                    {selected.appear && !spriteCharacters.includes(selected.appear) ? (
                      <option value={selected.appear}>{selected.appear}（立ち絵なし）</option>
                    ) : null}
                    {spriteCharacters.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[11px] text-on-surface-variant leading-relaxed">
                    この行から立ち絵を出します。名前枠は出ません。
                  </p>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <label htmlFor="staging-scene" className="text-on-surface text-sm">
                  ここから場面が変わる
                  <span className="mt-0.5 block text-[11px] text-on-surface-variant">
                    背景の切り替え点になります
                  </span>
                </label>
                <Switch
                  id="staging-scene"
                  checked={Boolean(selected.sceneBreak)}
                  onCheckedChange={(on) =>
                    apply(selected.blockId, { sceneBreak: on ? true : undefined })
                  }
                />
              </div>

              <div>
                <label
                  htmlFor="staging-bg"
                  className="mb-2 block text-on-surface-variant text-xs uppercase tracking-wider"
                >
                  背景
                </label>
                <select
                  id="staging-bg"
                  value={selected.bg ?? ''}
                  onChange={(e) => {
                    const value = e.target.value
                    if (value === ADD_IMAGE) {
                      beginImport(fileInputRef.current)
                      return
                    }
                    apply(selected.blockId, { bg: value || undefined })
                  }}
                  className={SELECT_CLASS}
                >
                  <option value="">（変えない）</option>
                  {/* この端末に無い持ち込み画像のキーも選択状態は保つ（勝手に外さない） */}
                  {selected.bg && !bgLabelOf(selected.bg, assets) ? (
                    <option value={selected.bg}>（この端末に無い画像）</option>
                  ) : null}
                  {bgAssets.length > 0 ? (
                    <optgroup label="持ち込み">
                      {bgAssets.map((a) => (
                        <option key={a.id} value={userAssetKey(a.id)}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <optgroup label="テンプレ">
                    {PRESET_BACKGROUNDS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                  {assetRepo ? <option value={ADD_IMAGE}>（画像を追加…）</option> : null}
                </select>
                {assetRepo ? (
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    aria-label="背景画像を選ぶ"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void addImage(file, selected.blockId)
                    }}
                  />
                ) : null}
                {assetError ? <p className="mt-2 text-destructive text-xs">{assetError}</p> : null}
                {bgPreviewSrc(selected.bg, assets) ? (
                  <img
                    src={bgPreviewSrc(selected.bg, assets)}
                    alt={`背景プレビュー: ${bgLabelOf(selected.bg ?? '', assets) ?? ''}`}
                    className="mt-2 aspect-video w-full rounded-md border border-outline-variant/30 object-cover"
                  />
                ) : null}
              </div>

              {selected.bg ? (
                <div>
                  <label
                    htmlFor="staging-transition"
                    className="mb-2 block text-on-surface-variant text-xs uppercase tracking-wider"
                  >
                    切り替え方
                  </label>
                  <select
                    id="staging-transition"
                    value={selected.transition ?? 'fade'}
                    onChange={(e) =>
                      apply(selected.blockId, {
                        transition: e.target.value as Cue['transition'],
                      })
                    }
                    className={SELECT_CLASS}
                  >
                    {TRANSITIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-destructive"
                onClick={() => clearCue(selected.blockId)}
              >
                <Trash2 className="size-4" />
                この行の演出を外す
              </Button>
            </div>
          )}
        </aside>
      </div>

      {assetRepo ? (
        <AssetManager
          open={managerOpen}
          onOpenChange={setManagerOpen}
          assets={assets}
          hostedIds={hostedIds}
          member={member}
          onDelete={deleteAsset}
          onUpload={uploadAsset}
        />
      ) : null}
    </div>
  )
}

/** orphan cue の一覧用に、中身を短い日本語で言う。 */
function describeCue(cue: Cue, assets: UserGameAsset[]): string {
  const parts: string[] = []
  if (cue.speaker) parts.push(`話者 ${cue.speaker}`)
  if (cue.expression) parts.push(`表情 ${cue.expression}`)
  if (cue.appear) parts.push(`登場 ${cue.appear}`)
  if (cue.sceneBreak) parts.push('場面の切れ目')
  if (cue.bg) parts.push(`背景 ${bgLabelOf(cue.bg, assets) ?? cue.bg}`)
  if (cue.bgm) parts.push('BGM')
  if (cue.se) parts.push('効果音')
  if (cue.transition) parts.push('切り替え効果')
  return parts.length > 0 ? parts.join('・') : '（内容なし）'
}

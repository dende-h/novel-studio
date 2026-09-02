import { Images, Play, Trash2 } from 'lucide-react'
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
import { type PageContinuity, resolveContinuity } from '@/core/game/continuity'
import { SE_STOP, type SeRepeat } from '@/core/game/sePresets'
import type { CatalogBackground, CatalogSe, CatalogSprite } from '@/core/game/templates'
import { PERSON_CATEGORY } from '@/core/glossary'
import type { Work } from '@/core/schema'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import { cn } from '@/lib/utils'
import { gameBgToDataUrl, gameSpriteToDataUrl } from '@/ui/_utils/imageResizer'
import { playCatalogSe } from '@/ui/_utils/sePlayer'
import { useAuth } from '@/ui/auth/auth-context'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Switch } from '@/ui/components/ui/switch'
import {
  type AssetHostingApi,
  createAssetHostingApi,
  pullHostedAssets,
} from '@/ui/game/asset-hosting'
import {
  templateBgSrc,
  templateSpriteDataUrl,
  useTemplateCatalog,
} from '@/ui/game/template-catalog'
import { AssetManager, uploadNoticeOf } from './asset-manager'
import {
  AppearHelp,
  BgHelp,
  ContinuityHelp,
  HideSpriteHelp,
  SceneBreakHelp,
  SeHelp,
  SpeakerHelp,
  SpriteHelp,
  TransitionHelp,
} from './field-helps'
import { StagingPreviewDialog } from './preview-dialog'
import { TemplatePicker } from './template-picker'

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

/** 効果音キーの表示名（目録 → 組み込み → 予約キー → キーそのもの）。 */
function seLabelOf(key: string, ses: readonly CatalogSe[]): string {
  if (key === SE_STOP) return '止める'
  return ses.find((s) => s.key === key)?.label ?? key
}

/**
 * 続きレーン 1 本ぶん（背景・立ち絵・環境音）。行の左に立ち、**効いている間ずっと**伸びる。
 * 始まった行には頭に点を打つ。何が続いているかは title（ホバー）で言葉にする。
 */
function ContinuityLane({
  on,
  start,
  color,
  faint,
  title,
}: {
  on: boolean
  start: boolean
  color: string
  /** 立ち絵を出さない区間（線は残すが薄くする＝「いま出ていない」が見える） */
  faint?: boolean
  title: string
}) {
  return (
    <span className="flex w-1.5 flex-col items-center self-stretch" title={title} aria-hidden>
      {on ? (
        <>
          <span
            className={cn('h-1.5 w-1.5 rounded-full', color, start ? 'opacity-100' : 'opacity-0')}
          />
          <span className={cn('w-[3px] flex-1 rounded-full', color, faint && 'opacity-30')} />
        </>
      ) : null}
    </span>
  )
}

/** レーンの色。凡例と行で同じものを使う（別々に書くとずれる）。 */
const LANE_COLORS = {
  bg: 'bg-forest-600',
  sprite: 'bg-wheat-500',
  se: 'bg-on-surface-variant/60',
} as const

/** 続きレーンの説明（行に出すホバー文言・選択行の要約と同じ言葉を使う）。 */
function laneTitles(
  cont: PageContinuity | undefined,
  assets: UserGameAsset[],
  backgrounds: readonly CatalogBackground[],
  ses: readonly CatalogSe[],
): { bg: string; sprite: string; se: string } {
  if (!cont) return { bg: '', sprite: '', se: '' }
  return {
    bg: `背景：${bgLabelOf(cont.bg, assets, backgrounds) ?? cont.bg}`,
    sprite: cont.hidden
      ? '立ち絵：出さない区間'
      : cont.standing.length > 0
        ? `立ち絵：${cont.standing.join('・')}`
        : '立ち絵：なし',
    se: cont.loopSe ? `環境音：${seLabelOf(cont.loopSe, ses)}` : '環境音：なし',
  }
}

/** 背景キーの表示名（テンプレ／持ち込み。どちらでもなければ undefined）。 */
function bgLabelOf(
  key: string,
  assets: UserGameAsset[],
  backgrounds: readonly CatalogBackground[],
): string | undefined {
  const tpl = backgrounds.find((b) => b.key === key)
  if (tpl) return tpl.label
  return assets.find((a) => userAssetKey(a.id) === key)?.name
}

/** 背景キーのプレビュー画像（テンプレは目録の画像か SVG、持ち込みは保存済み data URL）。 */
function bgPreviewSrc(
  key: string | undefined,
  assets: UserGameAsset[],
  backgrounds: readonly CatalogBackground[],
): string | undefined {
  if (!key) return undefined
  const tpl = backgrounds.find((b) => b.key === key)
  if (tpl) return templateBgSrc(tpl)
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
  // 「登場」（地の文）の自由記述モード。話者と同じ 3 方式（人物・使った名前・自由記述）
  const [customAppear, setCustomAppear] = useState(false)
  const [customAppearDraft, setCustomAppearDraft] = useState('')
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
  // 運営テンプレの目録（無ければ組み込みの SVG だけ）。表示名・プレビュー・一覧に使う
  const { backgrounds, sprites, ses, manifest: templateManifest } = useTemplateCatalog()
  const [bgPickerOpen, setBgPickerOpen] = useState(false)
  const [sePickerOpen, setSePickerOpen] = useState(false)
  const seOf = (key: string) => ses.find((s) => s.key === key)
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
  // プレビュー（null＝閉じている）。startAt を渡すとその行から始まる
  const [preview, setPreview] = useState<{ startAt?: number } | null>(null)

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
  // 一覧に出すテンプレ＋（非表示になっていても）この行が指しているキー（勝手に外さない）
  const bgOptions = backgrounds.filter((b) => !b.hidden || b.key === selected?.bg)
  const bgAssets = useMemo(() => assets.filter((a) => a.kind === 'bg'), [assets])
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
  // 「登場」の選択肢のうち用語集に無い名前（話者で使った名前・立ち絵のある人物・登場で使った名前）。
  // **立ち絵の有無で絞らない**——立ち絵はここで人物を選んでから付けられる（一言も喋らない人物のため）
  const otherAppearNames = useMemo(() => {
    const names = new Set(usedSpeakers)
    for (const a of assets) if (a.kind === 'sprite' && a.character) names.add(a.character)
    for (const c of staging?.cues ?? []) if (c.appear) names.add(c.appear)
    return [...names]
      .filter((n) => n !== MASKED_SPEAKER && !persons.some((p) => p.name === n))
      .sort((a, b) => a.localeCompare(b, 'ja'))
  }, [usedSpeakers, assets, staging, persons])
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

  // 「この行では何が効いているか」。設定した行にしか印が無いと、続きが見えない
  const continuity = useMemo(
    () => resolveContinuity(staged, { hasSprite: (name) => Boolean(pickSprite(assets, name)) }),
    [staged, assets],
  )
  const selectedIndex = staged.findIndex((p) => p.blockId === selectedId)
  const selectedCont = selectedIndex >= 0 ? continuity[selectedIndex] : undefined
  const selected = staged.find((p) => p.blockId === selectedId) ?? null
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
    setCustomAppear(false)
    setPendingSprite(null)
    setSpritePickerOpen(false)
  }
  const commitCustomSpeaker = (blockId: string) => {
    const name = customDraft.trim()
    setCustomSpeaker(false)
    apply(blockId, { speaker: name || undefined })
  }
  const commitCustomAppear = (blockId: string) => {
    const name = customAppearDraft.trim()
    setCustomAppear(false)
    apply(blockId, { appear: name || undefined })
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
  const pickTemplateSprite = async (speaker: string, sprite: CatalogSprite) => {
    if (!assetRepo) return
    setHostNotice(null)
    setSpritePickerOpen(false)
    // 目録の画像なら実体を取り、取れなければ組み込みの SVG（無ければ諦めて知らせる）
    const dataUrl = await templateSpriteDataUrl(sprite)
    if (!dataUrl) {
      setAssetError(
        'テンプレの画像を取得できませんでした。通信環境を確認して、もう一度お試しください。',
      )
      return
    }
    const existing = assets.find((a) => a.kind === 'sprite' && a.character === speaker && a.preset)
    const asset: UserGameAsset = existing
      ? {
          ...existing,
          name: `${speaker}（${sprite.label}）`,
          dataUrl,
          tone: sprite.tone,
          preset: sprite.key,
        }
      : {
          id: `tpl-${crypto.randomUUID()}`,
          kind: 'sprite',
          name: `${speaker}（${sprite.label}）`,
          dataUrl,
          tone: sprite.tone,
          character: speaker,
          expression: DEFAULT_EXPRESSION,
          preset: sprite.key,
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
   * 立ち絵の欄（プレビュー・表情・追加）。**セリフの話者にも、地の文の「登場」にも同じ形で出す。**
   * 一言も喋らない人物にも立ち絵を付けられるように、登録の入口を話者に縛らない（D-GAME-SPRITE-ANY）。
   * 表情の選び分けはセリフ側だけ（登場は既定の表情で立たせる＝exporter の取り決めに合わせる）。
   */
  const renderSpriteEditor = (character: string, withExpression: boolean) => {
    const expressions = spriteExpressionsOf(assets, character)
    const preview = pickSprite(assets, character, withExpression ? selected?.expression : undefined)
    return (
      <div className="mt-4">
        {selected?.hideSprite ? (
          <p className="mb-2 text-[11px] text-on-surface-variant leading-relaxed">
            この行は「立ち絵を出さない」が入っています。登録はできますが、ここでは出ません。
          </p>
        ) : null}
        {withExpression ? (
          <div className="mb-2 flex items-center gap-1">
            <label
              htmlFor="staging-expression"
              className="text-on-surface-variant text-xs uppercase tracking-wider"
            >
              立ち絵
            </label>
            <SpriteHelp />
          </div>
        ) : null}
        {expressions.length > 0 ? (
          <>
            {withExpression && selected ? (
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
                {selected.expression && !expressions.includes(selected.expression) ? (
                  <option value={selected.expression}>
                    {selected.expression}（この表情は未登録）
                  </option>
                ) : null}
                {expressions.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            ) : null}
            {preview ? (
              <img
                src={preview.dataUrl}
                alt={`立ち絵プレビュー: ${preview.name}`}
                className="mx-auto mt-2 h-40 object-contain"
              />
            ) : null}
          </>
        ) : (
          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            「{character}」の立ち絵はまだありません。追加すると、
            {withExpression
              ? 'この話者のセリフで自動的に表示されます。'
              : 'この行から立ち絵が出ます。'}
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
              <Button type="button" size="sm" onClick={() => void commitSprite(character)}>
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
        <TemplatePicker
          open={spritePickerOpen && !pendingSprite}
          onOpenChange={setSpritePickerOpen}
          kind="sprite"
          items={sprites}
          manifest={templateManifest}
          selectedKey={
            assets.find((a) => a.kind === 'sprite' && a.character === character && a.preset)?.preset
          }
          onPick={(sp) => void pickTemplateSprite(character, sp)}
        />
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
    )
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto gap-2 text-primary"
            disabled={!episode}
            onClick={() => setPreview({})}
          >
            <Play className="size-4" />
            プレビュー
          </Button>
          {assetRepo ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 text-primary"
              onClick={() => setManagerOpen(true)}
            >
              <Images className="size-4" />
              素材の管理
            </Button>
          ) : null}
          <label className="flex items-center gap-2 text-on-surface-variant text-xs">
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
                      {describeCue(cue, assets, backgrounds, ses)}
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
            <>
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-on-surface-variant/80">
                <span>行の左の線＝続いているもの</span>
                <span className="flex items-center gap-1">
                  <span className={cn('h-3 w-[3px] rounded-full', LANE_COLORS.bg)} aria-hidden />
                  背景
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className={cn('h-3 w-[3px] rounded-full', LANE_COLORS.sprite)}
                    aria-hidden
                  />
                  立ち絵
                </span>
                <span className="flex items-center gap-1">
                  <span className={cn('h-3 w-[3px] rounded-full', LANE_COLORS.se)} aria-hidden />
                  環境音
                </span>
                <ContinuityHelp />
              </div>
              <ul className="mx-auto max-w-3xl space-y-1">
                {staged.map((page, index) => {
                  const active = page.blockId === selectedId
                  const cont = continuity[index]
                  const titles = laneTitles(cont, assets, backgrounds, ses)
                  const bgLabel = page.bg ? bgLabelOf(page.bg, assets, backgrounds) : undefined
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
                        {/* 続きレーン：背景・立ち絵・環境音が「どこから どこまで」効いているか */}
                        <span className="flex shrink-0 gap-1 self-stretch">
                          <ContinuityLane
                            on
                            start={Boolean(cont?.changed.bg)}
                            color={LANE_COLORS.bg}
                            title={titles.bg}
                          />
                          <ContinuityLane
                            on={(cont?.standing.length ?? 0) > 0 || Boolean(cont?.hidden)}
                            start={Boolean(cont?.changed.standing)}
                            color={LANE_COLORS.sprite}
                            faint={cont?.hidden}
                            title={titles.sprite}
                          />
                          <ContinuityLane
                            on={Boolean(cont?.loopSe)}
                            start={Boolean(cont?.changed.loopSe)}
                            color={LANE_COLORS.se}
                            title={titles.se}
                          />
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
                            {page.hideSprite ? <span>立ち絵なし</span> : null}
                            {page.se ? (
                              <span>
                                効果音 {seLabelOf(page.se, ses)}
                                {page.seRepeat === 'loop' ? '（ずっと）' : ''}
                                {page.seRepeat === 2 ? '（2回）' : ''}
                              </span>
                            ) : null}
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
            </>
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

              {/* この行に効いているもの。前の行から続いている分は、設定欄には出てこない */}
              {selectedCont ? (
                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                  <span className="text-on-surface-variant/70">この行に効いているもの：</span>
                  背景 {bgLabelOf(selectedCont.bg, assets, backgrounds) ?? selectedCont.bg}
                  {selectedCont.hidden
                    ? '／立ち絵 出さない区間'
                    : selectedCont.standing.length > 0
                      ? `／立ち絵 ${selectedCont.standing.join('・')}`
                      : ''}
                  {selectedCont.loopSe ? `／環境音 ${seLabelOf(selectedCont.loopSe, ses)}` : ''}
                </p>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2 text-primary"
                onClick={() =>
                  setPreview({ startAt: staged.findIndex((p) => p.blockId === selected.blockId) })
                }
              >
                <Play className="size-4" />
                この行から見る
              </Button>

              {hostNotice ? (
                <p className="text-on-surface-variant text-xs leading-relaxed">{hostNotice}</p>
              ) : null}

              {selected.kind === 'dialogue' ? (
                <div>
                  <div className="mb-2 flex items-center gap-1">
                    <label
                      htmlFor="staging-speaker"
                      className="text-on-surface-variant text-xs uppercase tracking-wider"
                    >
                      話者
                    </label>
                    <SpeakerHelp />
                  </div>
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

                  {selected.speaker && selected.speaker !== MASKED_SPEAKER && assetRepo
                    ? renderSpriteEditor(selected.speaker, true)
                    : null}
                </div>
              ) : null}

              {selected.kind === 'narration' && assetRepo ? (
                <div>
                  <div className="mb-2 flex items-center gap-1">
                    <label
                      htmlFor="staging-appear"
                      className="text-on-surface-variant text-xs uppercase tracking-wider"
                    >
                      立ち絵の登場
                    </label>
                    <AppearHelp />
                  </div>
                  <select
                    id="staging-appear"
                    value={customAppear ? CUSTOM_SPEAKER : (selected.appear ?? '')}
                    onChange={(e) => {
                      const value = e.target.value
                      if (value === CUSTOM_SPEAKER) {
                        // まだ保存しない。下の入力欄で名前を書いたときに保存する
                        setCustomAppearDraft(selected.appear ?? '')
                        setCustomAppear(true)
                        return
                      }
                      setCustomAppear(false)
                      apply(selected.blockId, { appear: value || undefined })
                    }}
                    className={SELECT_CLASS}
                  >
                    <option value="">（なし）</option>
                    {persons.length > 0 ? (
                      <optgroup label="用語集の人物">
                        {persons.map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {otherAppearNames.length > 0 ? (
                      <optgroup label="この作品の演出で使った名前">
                        {otherAppearNames.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    <option value={CUSTOM_SPEAKER}>（自由に入力…）</option>
                  </select>
                  {customAppear ? (
                    <Input
                      aria-label="登場する人物の名前を入力"
                      value={customAppearDraft}
                      placeholder="立ち絵を出す人物の名前"
                      autoFocus
                      onChange={(e) => setCustomAppearDraft(e.target.value)}
                      onBlur={() => commitCustomAppear(selected.blockId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitCustomAppear(selected.blockId)
                      }}
                      className="mt-2"
                    />
                  ) : null}
                  {selected.appear && selected.appear !== MASKED_SPEAKER
                    ? renderSpriteEditor(selected.appear, false)
                    : null}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  <label htmlFor="staging-scene" className="text-on-surface text-sm">
                    ここから場面が変わる
                  </label>
                  <SceneBreakHelp />
                </div>
                <Switch
                  id="staging-scene"
                  checked={Boolean(selected.sceneBreak)}
                  onCheckedChange={(on) =>
                    apply(selected.blockId, { sceneBreak: on ? true : undefined })
                  }
                />
              </div>

              {assetRepo ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1">
                    <label htmlFor="staging-hide-sprite" className="text-on-surface text-sm">
                      ここから立ち絵を出さない
                    </label>
                    <HideSpriteHelp />
                  </div>
                  <Switch
                    id="staging-hide-sprite"
                    checked={Boolean(selected.hideSprite)}
                    onCheckedChange={(on) =>
                      apply(selected.blockId, { hideSprite: on ? true : undefined })
                    }
                  />
                </div>
              ) : null}

              <div>
                <div className="mb-2 flex items-center gap-1">
                  <label
                    htmlFor="staging-bg"
                    className="text-on-surface-variant text-xs uppercase tracking-wider"
                  >
                    背景
                  </label>
                  <BgHelp />
                </div>
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
                  {selected.bg && !bgLabelOf(selected.bg, assets, backgrounds) ? (
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
                    {bgOptions.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                  {assetRepo ? <option value={ADD_IMAGE}>（画像を追加…）</option> : null}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 text-primary"
                  onClick={() => setBgPickerOpen(true)}
                >
                  一覧から選ぶ…
                </Button>
                <TemplatePicker
                  open={bgPickerOpen}
                  onOpenChange={setBgPickerOpen}
                  kind="bg"
                  items={backgrounds}
                  manifest={templateManifest}
                  selectedKey={selected.bg}
                  onPick={(bg) => apply(selected.blockId, { bg: bg.key })}
                />
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
                {bgPreviewSrc(selected.bg, assets, backgrounds) ? (
                  <img
                    src={bgPreviewSrc(selected.bg, assets, backgrounds)}
                    alt={`背景プレビュー: ${bgLabelOf(selected.bg ?? '', assets, backgrounds) ?? ''}`}
                    className="mt-2 aspect-video w-full rounded-md border border-outline-variant/30 object-cover"
                  />
                ) : null}
              </div>

              {selected.bg ? (
                <div>
                  <div className="mb-2 flex items-center gap-1">
                    <label
                      htmlFor="staging-transition"
                      className="text-on-surface-variant text-xs uppercase tracking-wider"
                    >
                      切り替え方
                    </label>
                    <TransitionHelp />
                  </div>
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

              <div>
                <div className="mb-2 flex items-center gap-1">
                  <label
                    htmlFor="staging-se"
                    className="text-on-surface-variant text-xs uppercase tracking-wider"
                  >
                    効果音
                  </label>
                  <SeHelp />
                </div>
                <div className="flex gap-2">
                  <select
                    id="staging-se"
                    value={selected.se ?? ''}
                    onChange={(e) => {
                      const value = e.target.value
                      // 音を外す・止めるときは鳴らし方の指定も一緒に落とす（宙に浮かせない）
                      apply(selected.blockId, {
                        se: value || undefined,
                        ...(value === '' || value === SE_STOP ? { seRepeat: undefined } : {}),
                      })
                    }}
                    className={SELECT_CLASS}
                  >
                    <option value="">（なし）</option>
                    <option value={SE_STOP}>ここで止める（ずっと鳴っている音を消す）</option>
                    {/* 未知キー（この端末の目録に無い音等）も選択状態は保つ（勝手に外さない） */}
                    {selected.se && selected.se !== SE_STOP && !seOf(selected.se) ? (
                      <option value={selected.se}>{selected.se}</option>
                    ) : null}
                    {ses
                      .filter((p) => !p.hidden || p.key === selected.se)
                      .map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-primary"
                    disabled={!selected.se || !seOf(selected.se)}
                    onClick={() => {
                      const se = selected.se ? seOf(selected.se) : undefined
                      if (se) playCatalogSe(se, selected.seRepeat)
                    }}
                  >
                    試聴
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-primary"
                    onClick={() => setSePickerOpen(true)}
                  >
                    一覧から選ぶ…
                  </Button>
                </div>
                <TemplatePicker
                  open={sePickerOpen}
                  onOpenChange={setSePickerOpen}
                  kind="se"
                  items={ses}
                  manifest={templateManifest}
                  selectedKey={selected.se}
                  onPick={(se) => apply(selected.blockId, { se: se.key })}
                />
                {selected.se && selected.se !== SE_STOP ? (
                  <div className="mt-2">
                    <label htmlFor="staging-se-repeat" className="sr-only">
                      鳴らし方
                    </label>
                    <select
                      id="staging-se-repeat"
                      value={selected.seRepeat === undefined ? '1' : String(selected.seRepeat)}
                      onChange={(e) => {
                        const value = e.target.value
                        apply(selected.blockId, {
                          seRepeat:
                            value === '1'
                              ? undefined
                              : ((value === 'loop' ? 'loop' : 2) as SeRepeat),
                        })
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="1">1回鳴らす</option>
                      <option value="2">2回鳴らす</option>
                      <option value="loop">ずっと鳴らす（次の場面まで）</option>
                    </select>
                  </div>
                ) : null}
              </div>

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

      {episode ? (
        <StagingPreviewDialog
          templateBackgrounds={backgrounds}
          templateSes={ses}
          open={preview !== null}
          onOpenChange={(o) => setPreview(o ? (preview ?? {}) : null)}
          work={work}
          episode={episode}
          staging={staging ?? undefined}
          gameAssets={assets}
          {...(preview?.startAt !== undefined ? { startAt: preview.startAt } : {})}
        />
      ) : null}

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
function describeCue(
  cue: Cue,
  assets: UserGameAsset[],
  backgrounds: readonly CatalogBackground[],
  ses: readonly CatalogSe[],
): string {
  const parts: string[] = []
  if (cue.speaker) parts.push(`話者 ${cue.speaker}`)
  if (cue.expression) parts.push(`表情 ${cue.expression}`)
  if (cue.appear) parts.push(`登場 ${cue.appear}`)
  if (cue.sceneBreak) parts.push('場面の切れ目')
  if (cue.bg) parts.push(`背景 ${bgLabelOf(cue.bg, assets, backgrounds) ?? cue.bg}`)
  if (cue.bgm) parts.push('BGM')
  if (cue.se) parts.push(`効果音 ${seLabelOf(cue.se, ses)}`)
  if (cue.transition) parts.push('切り替え効果')
  return parts.length > 0 ? parts.join('・') : '（内容なし）'
}

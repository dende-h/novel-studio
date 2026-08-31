import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyCues,
  type Cue,
  emptyStaging,
  findOrphanCues,
  patchCue,
  plainTextOfBlock,
  removeCue,
  type Staging,
  suggestSceneBreaks,
  suggestSpeaker,
  toPages,
} from '@/core/game'
import { type UserGameAsset, userAssetKey } from '@/core/game/assets'
import { PRESET_BACKGROUNDS, presetBackground, presetBgSvg } from '@/core/game/presets'
import { PERSON_CATEGORY } from '@/core/glossary'
import type { Work } from '@/core/schema'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import { cn } from '@/lib/utils'
import { gameBgToDataUrl } from '@/ui/_utils/imageResizer'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Switch } from '@/ui/components/ui/switch'

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

/** 正体を伏せた話者の表示名（名前枠に ？？？ と出す）。 */
const MASKED_SPEAKER = '？？？'
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
  // 持ち込み背景（この端末のローカル資産）
  const [assets, setAssets] = useState<UserGameAsset[]>([])
  const [assetError, setAssetError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
  }
  const commitCustomSpeaker = (blockId: string) => {
    const name = customDraft.trim()
    setCustomSpeaker(false)
    apply(blockId, { speaker: name || undefined })
  }
  /** 画像ファイル → リサイズして保存 → その行の背景に設定。 */
  const addImage = async (file: File, blockId: string) => {
    if (!assetRepo) return
    setAssetError(null)
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
    } catch {
      setAssetError('この画像は読み込めませんでした。別のファイルでお試しください。')
    }
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
          <label className="ml-auto flex items-center gap-2 text-on-surface-variant text-xs">
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
                    {/* 用語集の人物に無い既存の話者名も選択肢として残す（勝手に消さない） */}
                    {selected.speaker &&
                    selected.speaker !== MASKED_SPEAKER &&
                    !persons.some((p) => p.name === selected.speaker) ? (
                      <option value={selected.speaker}>{selected.speaker}</option>
                    ) : null}
                    {persons.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
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
                      fileInputRef.current?.click()
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
                  {assets.length > 0 ? (
                    <optgroup label="持ち込み">
                      {assets.map((a) => (
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
    </div>
  )
}

/** orphan cue の一覧用に、中身を短い日本語で言う。 */
function describeCue(cue: Cue, assets: UserGameAsset[]): string {
  const parts: string[] = []
  if (cue.speaker) parts.push(`話者 ${cue.speaker}`)
  if (cue.sceneBreak) parts.push('場面の切れ目')
  if (cue.bg) parts.push(`背景 ${bgLabelOf(cue.bg, assets) ?? cue.bg}`)
  if (cue.bgm) parts.push('BGM')
  if (cue.se) parts.push('効果音')
  if (cue.transition) parts.push('切り替え効果')
  return parts.length > 0 ? parts.join('・') : '（内容なし）'
}

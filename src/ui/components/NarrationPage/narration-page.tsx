import { ArrowLeft, Check, Download, Headphones, Play, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Staging } from '@/core/game'
import { narrationFilename } from '@/core/narration/mp3'
import { cueIsValid, cuesForBlock, plainText, resolveSegments } from '@/core/narration/resolve'
import { STYLES, type VoiceCue, type VoiceSegment, type VoiceTake } from '@/core/narration/types'
import type { Work } from '@/core/schema'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import { zipStore } from '@/core/zip'
import { triggerDownload } from '@/ui/_utils/download'
import { useAuth } from '@/ui/auth/auth-context'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { Button } from '@/ui/components/ui/button'
import { useEditorStore } from '@/ui/hooks/use-editor-store'
import { assembleNarration } from '@/ui/narration/audio'
import { narrationService } from '@/ui/narration/service'
import type { EditorStore } from '@/ui/store/editorStore'
import './narration.css'

export function NarrationRoute({
  store,
  workId,
  episodeId,
  stagingRepo,
}: {
  store: EditorStore
  workId: string
  episodeId: string
  stagingRepo: StagingRepository
}) {
  const state = useEditorStore(store)
  const [error, setError] = useState('')
  useEffect(() => {
    if (state.work?.id !== workId)
      void store
        .openWork(workId)
        .catch(() => setError('作品を開けませんでした。ライブラリから選び直してください。'))
  }, [store, workId, state.work?.id])
  if (error)
    return (
      <main className="narration-studio">
        <a href="#/">ライブラリへ</a>
        <p role="alert">{error}</p>
      </main>
    )
  if (state.work?.id !== workId) return <p>作品を読み込み中…</p>
  return (
    <NarrationPage
      key={workId}
      work={state.work}
      initialEpisodeId={episodeId}
      stagingRepo={stagingRepo}
    />
  )
}
function NarrationPage({
  work,
  initialEpisodeId,
  stagingRepo,
}: {
  work: Work
  initialEpisodeId: string
  stagingRepo: StagingRepository
}) {
  const auth = useAuth()
  const service = useMemo(
    () => narrationService(work.id, auth.getToken, auth.userId ?? 'local'),
    [work.id, auth.getToken, auth.userId],
  )
  const { record, entitlement, error, saving, sending } = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
  )
  const [episodeId, setEpisodeId] = useState(initialEpisodeId || work.episodes[0]?.id || '')
  const episode = work.episodes.find((e) => e.id === episodeId) ?? work.episodes[0]
  const [stagings, setStagings] = useState<Staging[]>([])
  const [selection, setSelection] = useState<string[]>([])
  const [rangeSelecting, setRangeSelecting] = useState(false)
  const [scope, setScope] = useState<VoiceCue['scope']>('episode')
  const [notice, setNotice] = useState('')
  const [panel, setPanel] = useState<'direction' | 'settings'>('direction')
  const [mobilePanel, setMobilePanel] = useState<'manuscript' | 'inspector'>('manuscript')
  const [busy, setBusy] = useState(false)
  const [generationRequest, setGenerationRequest] = useState<{
    segments: VoiceSegment[]
    regenerate: boolean
  } | null>(null)
  const [consent, setConsent] = useState(() => localStorage.getItem('ns-narration-consent') === '1')
  const [playing, setPlaying] = useState<{
    url: string
    timeline: { start: number; end: number }[]
    segments: VoiceSegment[]
    label: string
  } | null>(null)
  const [position, setPosition] = useState(0)
  const audio = useRef<HTMLAudioElement>(null)
  const inspector = useRef<HTMLElement>(null)
  useEffect(() => {
    const dismiss = (event: Event) => {
      for (const menu of document.querySelectorAll<HTMLDetailsElement>(
        '.narration-popover[open]',
      )) {
        if (
          event instanceof KeyboardEvent
            ? event.key === 'Escape'
            : !menu.contains(event.target as Node)
        )
          menu.open = false
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [])

  useEffect(() => {
    if (inspector.current && (scope === 'episode' || selection.length > 0))
      inspector.current.scrollTop = 0
  }, [scope, selection])
  const [exportIds, setExportIds] = useState<string[]>([])
  useEffect(() => {
    void stagingRepo.listByWork(work.id).then(setStagings)
  }, [work.id, stagingRepo])
  useEffect(
    () => () => {
      if (playing) URL.revokeObjectURL(playing.url)
    },
    [playing],
  )
  if (!record || !episode)
    return (
      <main className="narration-studio" data-mobile-panel={mobilePanel}>
        <a href="#/write">執筆へ戻る</a>
        <p>{episode ? '設定を読み込み中…' : '話を追加すると朗読を作れます。'}</p>
      </main>
    )
  const settings = record.settings
  const staging = stagings.find((s) => s.episodeId === episode.id)
  const generation = entitlement
    ? { model: entitlement.model, voices: entitlement.voices }
    : undefined
  const segments = resolveSegments(episode, settings, staging, generation)
  const targets =
    scope === 'episode' ? segments : segments.filter((s) => selection.includes(s.blockId))
  const matchingCue = settings.cues.find(
    (c) =>
      c.episodeId === episode.id &&
      c.scope === scope &&
      (scope === 'episode' ||
        (c.refs.length === selection.length && c.refs.every((r) => selection.includes(r.blockId)))),
  )
  const cue: VoiceCue = matchingCue ?? {
    id: crypto.randomUUID(),
    episodeId: episode.id,
    scope,
    refs: [...new Set(targets.map((s) => s.blockId))].map((blockId) => ({
      blockId,
      snapshot: plainText(episode.blocks.find((b) => b.id === blockId)?.inlines ?? []),
    })),
    direction: '',
  }
  const currentIndex =
    playing?.timeline.findIndex((t) => position >= t.start && position < t.end) ?? -1
  const running = record.takes.filter((t) => t.state === 'queued' || t.state === 'generating')
  const accepted = (segment: VoiceSegment) =>
    record.takes.find((t) => t.id === record.accepted[segment.id] && t.state === 'ready')
  const latest = (segment: VoiceSegment) =>
    record.takes
      .filter(
        (t) =>
          t.segmentId === segment.id &&
          t.fingerprint === segment.fingerprint &&
          t.state === 'ready',
      )
      .at(-1)
  const pending = segments.filter(
    (s) =>
      accepted(s)?.fingerprint !== s.fingerprint &&
      !latest(s) &&
      !running.some((t) => t.segmentId === s.id),
  )
  const missing = segments.filter((s) => !accepted(s))
  const changed = segments.filter((s) => accepted(s) && accepted(s)?.fingerprint !== s.fingerprint)
  const cost = (items: VoiceSegment[]) => items.reduce((n, s) => n + s.characters, 0)
  const readyToGenerate = (items: VoiceSegment[]) =>
    !!entitlement?.enabled &&
    items.length > 0 &&
    cost(items) <= entitlement.remaining &&
    !sending &&
    !items.some((s) => s.characters > 800)
  const patchSettings = (patch: Partial<typeof settings>) =>
    service.changeSettings({ ...settings, ...patch })
  const patchCue = (patch: Partial<VoiceCue>) => {
    const next = { ...cue, ...patch }
    patchSettings({ cues: [...settings.cues.filter((c) => c.id !== cue.id), next] })
  }
  const select = (id: string, extend = false) => {
    if (extend && selection.length) {
      const a = segments.findIndex((s) => s.blockId === selection[0]),
        b = segments.findIndex((s) => s.blockId === id)
      setSelection([
        ...new Set(segments.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.blockId)),
      ])
    } else setSelection([id])
    setPanel('direction')
    if (!rangeSelecting) setMobilePanel('inspector')
    setScope('range')
    if (window.innerWidth <= 850 && !rangeSelecting)
      requestAnimationFrame(() =>
        document
          .querySelector('.narration-direction')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
  }
  const selectScene = (id: string) => {
    const index = episode.blocks.findIndex((b) => b.id === id)
    let start = 0,
      end = episode.blocks.length
    for (const c of staging?.cues ?? [])
      if (c.sceneBreak) {
        const at = episode.blocks.findIndex((b) => b.id === c.blockId)
        if (at <= index) start = Math.max(start, at)
        else end = Math.min(end, at)
      }
    setSelection(
      episode.blocks
        .slice(start, end)
        .map((b) => b.id)
        .filter((id) => segments.some((s) => s.blockId === id)),
    )
    setScope('scene')
  }
  const act = async (task: () => Promise<void>) => {
    setBusy(true)
    setNotice('')
    try {
      await task()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '処理できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }
  const generate = (items: VoiceSegment[], regenerate = false) => {
    if (!consent) {
      setGenerationRequest({ segments: items, regenerate })
      return
    }
    void act(() => service.generate(items, regenerate))
  }
  const play = async (items: VoiceSegment[], variant: 'accepted' | 'candidate', from = 0) => {
    const takes = items.map((s) =>
      variant === 'candidate' ? (latest(s) ?? accepted(s)) : accepted(s),
    )
    if (takes.some((t) => !t))
      throw new Error('まだ音声のない区間があります。先に生成してください。')
    const built = await assembleNarration(items, takes as VoiceTake[], service)
    setPlaying({
      url: URL.createObjectURL(new Blob([built.data], { type: 'audio/mpeg' })),
      timeline: built.timeline,
      segments: items,
      label: variant === 'candidate' ? '新しい読み' : '採用中の読み',
    })
    setPosition(from)
  }
  const audition = async (variant: 'accepted' | 'candidate') => {
    const first = segments.findIndex((s) => s.id === targets[0]?.id),
      last = segments.findIndex((s) => s.id === targets.at(-1)?.id)
    if (first < 0) return
    // Include available neighbouring audio to judge the transition without forcing another generation.
    const context = segments
      .slice(Math.max(0, first - 1), Math.min(segments.length, last + 2))
      .filter((s) => targets.some((t) => t.id === s.id) || accepted(s))
    const sameRange = playing?.segments.map((s) => s.id).join() === context.map((s) => s.id).join()
    await play(context, variant, sameRange ? (audio.current?.currentTime ?? 0) : 0)
  }
  const exportEpisodes = async (ids: string[]) => {
    const files = []
    for (const id of ids) {
      const ep = work.episodes.find((e) => e.id === id)
      if (!ep) continue
      const pieces = resolveSegments(
        ep,
        settings,
        stagings.find((s) => s.episodeId === id),
        generation,
      )
      const takes = pieces.map(accepted)
      if (takes.some((t, i) => !t || t.fingerprint !== pieces[i]?.fingerprint))
        throw new Error(`「${ep.title}」に未採用または変更ありの区間があります。`)
      const built = await assembleNarration(pieces, takes as VoiceTake[], service)
      files.push({
        path: narrationFilename(work.title, ep.title, work.episodes.indexOf(ep)),
        data: built.data,
      })
    }
    if (!files.length) return
    triggerDownload(
      files.length === 1
        ? { filename: files[0]!.path, mime: 'audio/mpeg', data: files[0]!.data }
        : { filename: '朗読.zip', mime: 'application/zip', data: zipStore(files) },
    )
    setNotice('音声を書き出しました')
  }
  const saveLabel = saving ? '保存中…' : '保存済み'
  const targetLabel =
    scope === 'episode'
      ? 'この話全体'
      : scope === 'scene'
        ? `この場面（${targets.length}段落）`
        : `選んだ${targets.length}段落`
  const voices = entitlement?.voices ?? []
  const invalid = settings.cues.filter((c) => c.episodeId === episode.id && !cueIsValid(c, episode))
  return (
    <main className="narration-studio" data-mobile-panel={mobilePanel}>
      <header className="narration-header">
        <a href="#/write" className="narration-back">
          <ArrowLeft size={17} />
          執筆へ
        </a>
        <div className="narration-title">
          <p title={work.title}>{work.title}</p>
          <h1>
            <Headphones size={18} />
            朗読制作
          </h1>
        </div>
        <details className="narration-popover">
          <summary>
            <span className="narration-model">{entitlement?.model}</span>
            {entitlement ? `残り ${entitlement.remaining.toLocaleString()}文字` : '利用枠'}{' '}
            <span aria-hidden="true">⌄</span>
          </summary>
          <section className="narration-popover-body narration-quota" aria-label="利用枠">
            <div>
              <strong>{entitlement?.model ?? '利用枠を確認中'}</strong>
              {entitlement?.development && <span className="narration-tag">開発用・無料API</span>}
              <p>{entitlement?.label ?? 'サインインすると利用枠を確認できます。'}</p>
            </div>
            {entitlement && (
              <div className="narration-quota-numbers">
                <strong>
                  残り {entitlement.remaining.toLocaleString()}
                  <small>文字 / {entitlement.limit.toLocaleString()}文字</small>
                </strong>
                <p>
                  使用済み {entitlement.used.toLocaleString()}文字・予約中{' '}
                  {entitlement.reserved.toLocaleString()}文字
                  <br />
                  {entitlement.periodEnd
                    ? `${new Date(entitlement.periodEnd).toLocaleDateString('ja-JP')} に更新`
                    : '初回のみの体験枠'}
                </p>
              </div>
            )}
          </section>
        </details>
        <span className="narration-save" role="status">
          {saveLabel}
        </span>
        <details className="narration-popover narration-export-menu">
          <summary>
            書き出し設定 <span aria-hidden="true">⌄</span>
          </summary>
          <div className="narration-popover-body">
            <h2>複数話をZIPで保存</h2>
            <div className="narration-export-list">
              {work.episodes.map((ep) => (
                <label key={ep.id}>
                  <input
                    type="checkbox"
                    checked={exportIds.includes(ep.id)}
                    onChange={(e) =>
                      setExportIds(
                        e.target.checked
                          ? [...exportIds, ep.id]
                          : exportIds.filter((id) => id !== ep.id),
                      )
                    }
                  />
                  {ep.title}
                </label>
              ))}
            </div>
            <Button
              size="sm"
              disabled={busy || !exportIds.length}
              onClick={() =>
                void act(() =>
                  exportEpisodes(
                    work.episodes.filter((e) => exportIds.includes(e.id)).map((e) => e.id),
                  ),
                )
              }
            >
              選んだ話を書き出す
            </Button>
            <p className="narration-help">
              音声のサーバー保管は生成から7日間です。採用・試聴した音声はこの端末にも保存します。端末のデータ削除に備えてMP3を書き出してください。
            </p>
          </div>
        </details>
      </header>
      <nav className="narration-mobile-nav" aria-label="作業画面">
        <button
          type="button"
          aria-pressed={mobilePanel === 'manuscript'}
          onClick={() => setMobilePanel('manuscript')}
        >
          原稿
        </button>
        <button
          type="button"
          aria-pressed={mobilePanel === 'inspector' && panel === 'direction'}
          onClick={() => {
            setMobilePanel('inspector')
            setPanel('direction')
          }}
        >
          読み方
        </button>
        <button
          type="button"
          aria-pressed={mobilePanel === 'inspector' && panel === 'settings'}
          onClick={() => {
            setMobilePanel('inspector')
            setPanel('settings')
          }}
        >
          作品設定
        </button>
      </nav>
      {(error || notice) && (
        <div className="narration-notice" role="status">
          {notice || error}
          <button type="button" onClick={() => void act(() => service.refresh())}>
            状態を更新
          </button>
        </div>
      )}
      <div className="narration-workspace">
        <section className="narration-manuscript">
          <div className="narration-section-head">
            <label>
              <span className="sr-only">話を選ぶ</span>
              <select
                value={episode.id}
                onChange={(e) => {
                  setEpisodeId(e.target.value)
                  setSelection([])
                  setScope('episode')
                  window.history.replaceState(
                    null,
                    '',
                    `#/narration/${encodeURIComponent(work.id)}/${encodeURIComponent(e.target.value)}`,
                  )
                }}
              >
                {work.episodes.map((e, i) => (
                  <option key={e.id} value={e.id}>
                    {i + 1}. {e.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="narration-selection-bar">
            <Button
              variant={scope === 'episode' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setSelection([])
                setRangeSelecting(false)
                setScope('episode')
                setPanel('direction')
              }}
            >
              この話全体
            </Button>
            <Button
              size="sm"
              variant={rangeSelecting ? 'default' : 'ghost'}
              aria-pressed={rangeSelecting}
              onClick={() => {
                if (rangeSelecting && selection.length) {
                  setMobilePanel('inspector')
                  setPanel('direction')
                } else if (!rangeSelecting) {
                  setSelection([])
                }
                setRangeSelecting(!rangeSelecting)
              }}
            >
              {rangeSelecting ? '範囲を確定' : '範囲を選ぶ'}
            </Button>
            <span>
              {rangeSelecting ? '始めと終わりの段落を選択' : '段落を選んで読み方を変える'}
            </span>
          </div>

          {invalid.length > 0 && (
            <div className="narration-notice">
              原稿が変わったため、{invalid.length}
              件の指示を確認してください。元の指示は「保存した指示」に残っています。
            </div>
          )}
          {segments.some((s) => s.characters > 800) && (
            <p role="alert" className="narration-notice">
              句読点のない800文字を超える区間があります。本文に句読点を入れるか、短い読みを指定してください。
            </p>
          )}
          <div className="narration-paragraphs">
            {segments.map((segment, i) => {
              const take = accepted(segment),
                candidate = latest(segment),
                instructions = cuesForBlock(settings, episode, segment.blockId)
              const isCurrent = playing?.segments[currentIndex]?.id === segment.id
              const active = scope !== 'episode' && selection.includes(segment.blockId)
              const lastAttempt = record.takes.filter((t) => t.segmentId === segment.id).at(-1)
              const status = running.some((t) => t.segmentId === segment.id)
                ? '生成中'
                : take
                  ? take.fingerprint === segment.fingerprint
                    ? '採用済み'
                    : '変更あり'
                  : candidate
                    ? '試聴できます'
                    : lastAttempt?.state === 'failed'
                      ? '生成に失敗'
                      : lastAttempt?.state === 'unknown'
                        ? '結果を確認中'
                        : lastAttempt?.state === 'missing'
                          ? '保管期限切れ'
                          : '未生成'
              return (
                <article
                  key={segment.id}
                  className={`narration-paragraph ${active ? 'is-selected' : ''} ${isCurrent ? 'is-playing' : ''}`}
                >
                  {staging?.cues.some((c) => c.blockId === segment.blockId && c.sceneBreak) && (
                    <div className="narration-scene">場面の切れ目</div>
                  )}
                  <button
                    type="button"
                    className="narration-paragraph-select"
                    aria-pressed={active}
                    aria-label={`段落${i + 1}を選ぶ`}
                    onClick={(e) => select(segment.blockId, e.shiftKey || rangeSelecting)}
                  >
                    <span className="narration-line-number">{String(i + 1).padStart(2, '0')}</span>
                    <span className="narration-prose">{plainText(segment.source.inlines)}</span>
                  </button>
                  <div className="narration-paragraph-meta">
                    <span>{status}</span>
                    {lastAttempt?.error && <span role="status">{lastAttempt.error}</span>}
                    {instructions.some((c) => c.direction) && (
                      <span
                        className="narration-tag narration-cue-preview"
                        title={instructions
                          .map((c) => c.direction)
                          .filter(Boolean)
                          .join(' / ')}
                      >
                        {instructions
                          .map((c) => c.direction)
                          .filter(Boolean)
                          .join(' / ')}
                      </span>
                    )}
                    {instructions.some((c) => c.reading) && (
                      <span className="narration-tag">読みの指定あり</span>
                    )}
                    {active && staging?.cues.some((c) => c.sceneBreak) && (
                      <button type="button" onClick={() => selectScene(segment.blockId)}>
                        場面を選ぶ
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
        <aside
          ref={inspector}
          data-scope={scope}
          className="narration-inspector"
          aria-label="読み方の設定"
        >
          <fieldset className="narration-panel-switch" aria-label="設定の種類">
            <button
              type="button"
              aria-pressed={panel === 'direction'}
              onClick={() => setPanel('direction')}
            >
              読み方
            </button>
            <button
              type="button"
              aria-pressed={panel === 'settings'}
              onClick={() => setPanel('settings')}
            >
              作品設定
            </button>
          </fieldset>
          <section hidden={panel !== 'settings'}>
            <span className="narration-eyebrow">全話共通</span>
            <h2>声と朗読スタイル</h2>

            <label>
              語り手の声
              <select
                value={settings.narrator}
                onChange={(e) => patchSettings({ narrator: e.target.value })}
              >
                {voices.length ? (
                  voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))
                ) : (
                  <option value="default">設定済みの声</option>
                )}
              </select>
            </label>
            {voices.find((v) => v.id === settings.narrator)?.sampleUrl && (
              // biome-ignore lint/a11y/useMediaCaption: 声の比較用サンプル。
              <audio
                controls
                src={voices.find((v) => v.id === settings.narrator)?.sampleUrl}
                aria-label="声のサンプル"
              />
            )}
            <div className="narration-styles">
              {STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  aria-pressed={settings.style === style.id}
                  onClick={() => patchSettings({ style: style.id })}
                >
                  <strong>
                    {style.label}
                    {settings.style === style.id && <Check size={14} />}
                  </strong>
                  {settings.style === style.id && <span>{style.description}</span>}
                </button>
              ))}
            </div>
            <label>
              声の出し分け
              <select
                value={settings.mode}
                onChange={(e) => patchSettings({ mode: e.target.value as 'solo' | 'cast' })}
              >
                <option value="solo">ひとり朗読</option>
                <option value="cast">配役朗読</option>
              </select>
            </label>
            {settings.mode === 'cast' && (
              <div>
                <p className="narration-help">
                  演出譜の話者に声を割り当てます。未設定の台詞は語り手が読みます。
                </p>
                {[
                  ...new Set([
                    ...(staging?.cues.map((c) => c.speaker).filter((s): s is string => !!s) ?? []),
                    ...(work.glossary?.filter((g) => g.category === '人物').map((g) => g.name) ??
                      []),
                  ]),
                ].map((speaker) => (
                  <label key={speaker}>
                    {speaker}
                    <select
                      value={settings.cast[speaker] ?? ''}
                      onChange={(e) =>
                        patchSettings({ cast: { ...settings.cast, [speaker]: e.target.value } })
                      }
                    >
                      <option value="">語り手と同じ</option>
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </section>
          <section className="narration-direction" hidden={panel !== 'direction'}>
            <button
              type="button"
              className="narration-base-summary"
              onClick={() => setPanel('settings')}
            >
              <Headphones size={14} />
              {voices.find((v) => v.id === settings.narrator)?.label ?? '語り手'} ·{' '}
              {STYLES.find((v) => v.id === settings.style)?.label}
              <span aria-hidden="true">変更</span>
            </button>
            <h2>{targetLabel}</h2>
            <button
              type="button"
              className="narration-return"
              onClick={() => {
                setMobilePanel('manuscript')
                requestAnimationFrame(() =>
                  document
                    .querySelector('.narration-paragraph.is-selected')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
                )
              }}
            >
              ← 原稿に戻る
            </button>
            {scope !== 'episode' && (
              <blockquote>
                {targets
                  .map((s) => plainText(s.source.inlines))
                  .join(' ')
                  .slice(0, 160)}
                {cost(targets) > 160 ? '…' : ''}
              </blockquote>
            )}
            <label>
              どんなふうに読んでほしいですか？
              <textarea
                rows={3}
                maxLength={240}
                value={matchingCue?.direction ?? ''}
                placeholder="少し寂しそうに。最後の「ありがと」だけ温かく"
                onChange={(e) => patchCue({ direction: e.target.value })}
              />
            </label>
            <div className="narration-chips">
              {['そっとささやくように', 'ちょっと寂しそうに', '温かく語る', '軽く冗談めかす'].map(
                (text) => (
                  <button
                    type="button"
                    key={text}
                    onClick={() =>
                      patchCue({
                        direction:
                          `${matchingCue?.direction ? matchingCue.direction + '。' : ''}${text}`.slice(
                            0,
                            240,
                          ),
                      })
                    }
                  >
                    {text}
                  </button>
                ),
              )}
            </div>
            {targets[0]?.direction && targets[0].direction !== matchingCue?.direction && (
              <details className="narration-inherited">
                <summary>引き継ぐ指示</summary>
                <p>
                  {targets[0].direction}
                  {targets.some((v) => v.direction !== targets[0]?.direction)
                    ? '（範囲内に別の指定あり）'
                    : ''}
                </p>
              </details>
            )}
            {matchingCue && (
              <button
                type="button"
                className="narration-text-button"
                onClick={() =>
                  patchSettings({ cues: settings.cues.filter((c) => c.id !== matchingCue.id) })
                }
              >
                指定を外す
              </button>
            )}
            <div className="narration-trial">
              {(scope !== 'episode' || record.takes.length > 0) && (
                <Button
                  className="narration-wide"
                  disabled={!readyToGenerate(targets) || busy}
                  onClick={() => generate(targets, true)}
                >
                  この範囲を試す · {cost(targets).toLocaleString()}文字
                </Button>
              )}
              {targets.some((v) => accepted(v) || latest(v)) && (
                <div className="narration-compare">
                  <Button
                    variant="outline"
                    disabled={busy || targets.some((s) => !accepted(s))}
                    onClick={() => void act(() => audition('accepted'))}
                  >
                    元の読みを聴く
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || targets.some((s) => !latest(s))}
                    onClick={() => void act(() => audition('candidate'))}
                  >
                    新しい読みを聴く
                  </Button>
                </div>
              )}
              {targets.some((v) => latest(v) && latest(v)?.id !== accepted(v)?.id) && (
                <Button
                  variant="secondary"
                  className="narration-wide"
                  disabled={busy || !targets.length || targets.some((s) => !latest(s))}
                  onClick={() =>
                    void act(async () => {
                      for (const s of targets) await service.accept(latest(s)!)
                      setNotice('選んだ範囲の読みを採用しました')
                    })
                  }
                >
                  この読みを採用
                </Button>
              )}
            </div>
            <details>
              <summary>
                <SlidersHorizontal size={14} /> 読み・声・間を細かく調整
              </summary>
              <label>
                この範囲の声
                <select
                  value={matchingCue?.voiceId ?? ''}
                  onChange={(e) => patchCue({ voiceId: e.target.value || undefined })}
                >
                  <option value="">上位の声を引き継ぐ</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              {targets.length === 1 && (
                <label>
                  この段落の読み仮名
                  <textarea
                    rows={3}
                    value={matchingCue?.reading ?? ''}
                    maxLength={3000}
                    placeholder={targets[0]?.text}
                    onChange={(e) => patchCue({ reading: e.target.value || undefined })}
                  />
                </label>
              )}
              <label>
                速さ
                <select
                  value={matchingCue?.speed ?? ''}
                  onChange={(e) =>
                    patchCue({ speed: e.target.value ? Number(e.target.value) : undefined })
                  }
                >
                  <option value="">スタイルに合わせる</option>
                  <option value="0.9">ゆっくり</option>
                  <option value="1">普段の速さ</option>
                  <option value="1.1">少し速く</option>
                </select>
              </label>
              <label>
                段落のあとの間
                <select
                  value={matchingCue?.pauseMs ?? ''}
                  onChange={(e) =>
                    patchCue({ pauseMs: e.target.value ? Number(e.target.value) : undefined })
                  }
                >
                  <option value="">スタイルに合わせる</option>
                  <option value="0">間を足さない</option>
                  <option value="350">短め（0.35秒）</option>
                  <option value="700">長め（0.7秒）</option>
                  <option value="1500">余韻（1.5秒）</option>
                </select>
              </label>
              <p className="narration-help">間だけの変更では生成枠を使いません。</p>
            </details>
            {targets.length === 1 && (
              <details>
                <summary>前の読みを聴く・戻す</summary>
                {record.takes
                  .filter((t) => t.segmentId === targets[0]?.id && t.state === 'ready')
                  .map((t, i) => (
                    <div className="narration-take" key={t.id}>
                      <span>
                        読み {i + 1}
                        {record.accepted[t.segmentId] === t.id ? ' · 採用中' : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void act(async () => {
                            const blob = await service.audio(t.id)
                            setPlaying({
                              url: URL.createObjectURL(blob),
                              timeline: [{ start: 0, end: 99999 }],
                              segments: targets,
                              label: `読み ${i + 1}`,
                            })
                          })
                        }
                      >
                        聴く
                      </button>
                      <button type="button" onClick={() => void act(() => service.accept(t))}>
                        採用
                      </button>
                    </div>
                  ))}
              </details>
            )}
          </section>
          <details className="narration-dictionary" hidden={panel !== 'settings'}>
            <summary>作品の読み方辞書</summary>
            <p className="narration-help">原稿のルビを優先します。本文や用語集は変更しません。</p>
            {settings.dictionary.map((entry) => (
              <div className="narration-dict-row" key={entry.id}>
                <label>
                  表記
                  <input
                    value={entry.surface}
                    onChange={(e) =>
                      patchSettings({
                        dictionary: settings.dictionary.map((d) =>
                          d.id === entry.id ? { ...d, surface: e.target.value } : d,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  読み
                  <input
                    value={entry.reading}
                    onChange={(e) =>
                      patchSettings({
                        dictionary: settings.dictionary.map((d) =>
                          d.id === entry.id ? { ...d, reading: e.target.value } : d,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  aria-label={`${entry.surface}を辞書から外す`}
                  onClick={() =>
                    patchSettings({
                      dictionary: settings.dictionary.filter((d) => d.id !== entry.id),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patchSettings({
                  dictionary: [
                    ...settings.dictionary,
                    { id: crypto.randomUUID(), surface: '', reading: '' },
                  ],
                })
              }
            >
              読みを追加
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                patchSettings({
                  dictionary: [
                    ...settings.dictionary,
                    ...(work.glossary ?? [])
                      .filter(
                        (g) => g.reading && !settings.dictionary.some((d) => d.surface === g.name),
                      )
                      .map((g) => ({
                        id: crypto.randomUUID(),
                        surface: g.name,
                        reading: g.reading!,
                      })),
                  ],
                })
              }
            >
              用語集の読みを取り込む
            </Button>
          </details>
          <details hidden={panel !== 'direction'}>
            <summary>
              保存した指示（{settings.cues.filter((c) => c.episodeId === episode.id).length}件）
            </summary>
            {settings.cues
              .filter((c) => c.episodeId === episode.id)
              .map((c) => (
                <div className="narration-saved-cue" key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPanel('direction')
                      setScope(c.scope)
                      setSelection(c.refs.map((r) => r.blockId))
                    }}
                  >
                    {c.scope === 'episode' ? 'この話全体' : c.refs[0]?.snapshot.slice(0, 50)}
                    <span>{c.direction || '読み・声・間の指定'}</span>
                  </button>
                  {!cueIsValid(c, episode) && <p>原稿との対応を確認してください。</p>}
                  <button
                    type="button"
                    onClick={() =>
                      patchSettings({ cues: settings.cues.filter((v) => v.id !== c.id) })
                    }
                  >
                    指定を削除
                  </button>
                </div>
              ))}
          </details>
        </aside>
      </div>
      <footer className="narration-transport">
        {running.length > 0 && (
          <div className="narration-progress" role="status">
            生成中：残り {running.length}区間
            {[...new Set(running.map((t) => t.jobId))].map((id) => (
              <button type="button" key={id} onClick={() => void act(() => service.cancel(id))}>
                未着手の区間を止める
              </button>
            ))}
          </div>
        )}
        {playing && (
          <div className="narration-player">
            <span>{playing.label}</span>
            {/* biome-ignore lint/a11y/useMediaCaption: 朗読対象の原稿は画面中央に全文を表示する。 */}
            <audio
              ref={audio}
              key={playing.url}
              controls
              autoPlay
              src={playing.url}
              onLoadedMetadata={() => {
                if (audio.current) audio.current.currentTime = position
              }}
              onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const segment = playing.segments[currentIndex]
                if (segment) select(segment.blockId)
              }}
            >
              ここを直す
            </Button>
          </div>
        )}
        <div className="narration-actions">
          <div>
            <strong>
              {pending.length
                ? `未生成・変更あり ${pending.length}区間`
                : running.length
                  ? '音声を生成中'
                  : missing.length || changed.length
                    ? '試聴して読みを採用'
                    : '書き出せます'}
            </strong>
          </div>
          {pending.length > 0 && (
            <Button disabled={!readyToGenerate(pending) || busy} onClick={() => generate(pending)}>
              {sending ? '生成を開始中…' : `一話を生成 · ${cost(pending).toLocaleString()}文字`}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy || segments.some((s) => !latest(s) && !accepted(s))}
            onClick={() => void act(() => play(segments, 'candidate'))}
          >
            <Play size={15} />
            通して聴く
          </Button>
          {!pending.length &&
            (missing.length > 0 || changed.length > 0) &&
            segments.every((s) => latest(s) || accepted(s)?.fingerprint === s.fingerprint) && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    for (const segment of segments) {
                      const take = latest(segment)
                      if (take) await service.accept(take)
                    }
                    setNotice('この話の読みを採用しました')
                  })
                }
              >
                この話の読みを採用
              </Button>
            )}
          {!missing.length && !changed.length && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => exportEpisodes([episode.id]))}
            >
              <Download size={15} />
              MP3を書き出す
            </Button>
          )}
        </div>
        {entitlement && cost(pending) > entitlement.remaining && (
          <p className="narration-help">
            一話分の文字枠が足りません。原稿から短い範囲を選ぶと試せます。
          </p>
        )}
      </footer>
      <ConfirmDialog
        open={generationRequest !== null}
        onOpenChange={(open) => {
          if (!open) setGenerationRequest(null)
        }}
        title="原稿を送信して音声を作りますか？"
        description={`原稿・読み・演技指示をFish Audioへ送信します。モデル：${entitlement?.model ?? ''}。今回：${cost(generationRequest?.segments ?? []).toLocaleString()}文字。残り：${entitlement?.remaining.toLocaleString() ?? '—'}文字。`}
        confirmLabel="同意して生成"
        destructive={false}
        onConfirm={() => {
          if (!generationRequest) return
          setConsent(true)
          localStorage.setItem('ns-narration-consent', '1')
          void act(() => service.generate(generationRequest.segments, generationRequest.regenerate))
        }}
      />
    </main>
  )
}

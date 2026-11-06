import { ArrowLeft, Download, Headphones, Play, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Staging } from '@/core/game'
import { narrationFilename } from '@/core/narration/mp3'
import {
  cueIsValid,
  cuesForBlock,
  locateRef,
  openingSegments,
  plainText,
  resolveSegments,
} from '@/core/narration/resolve'
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
  const [offsets, setOffsets] = useState<Record<string, { start: number; end: number }>>({})
  const [compareSource, setCompareSource] = useState<'accepted' | 'candidate'>('candidate')
  const [commonReading, setCommonReading] = useState(true)
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    label: string
    action: () => void
  } | null>(null)
  const dragged = useRef(false)
  const manuscript = useRef<HTMLDivElement>(null)
  const [scope, setScope] = useState<VoiceCue['scope']>('episode')
  const [notice, setNotice] = useState('')
  const [mobilePanel, setMobilePanel] = useState<'manuscript' | 'inspector'>('manuscript')
  const [busy, setBusy] = useState(false)
  const [generationRequest, setGenerationRequest] = useState<{
    segments: VoiceSegment[]
    regenerate: boolean
    whole?: boolean
    preview?: boolean
    retry?: boolean
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: Rebuild only when the chosen comparison changes; polling must not reset playback.
  useEffect(() => {
    if (!record || !episode || !entitlement || !selection.length) return
    const all = resolveSegments(
      episode,
      record.settings,
      stagings.find((s) => s.episodeId === episode.id),
      { model: entitlement.model, voices: entitlement.voices },
    )
    const first = all.findIndex((s) => selection.includes(s.id)),
      last = all.findLastIndex((s) => selection.includes(s.id))
    if (first < 0 || !all.some((s) => selection.includes(s.id) && record.candidates?.[s.id])) return
    const items = all
      .slice(Math.max(0, first - 1), last + 2)
      .filter((s) => selection.includes(s.id) || record.accepted[s.id])
    const takes = items.map((s) =>
      record.takes.find(
        (t) =>
          t.id ===
            (compareSource === 'candidate' && selection.includes(s.id)
              ? (record.candidates?.[s.id] ?? record.accepted[s.id])
              : record.accepted[s.id]) && t.state === 'ready',
      ),
    )
    if (takes.some((t) => !t)) return
    let canceled = false
    void assembleNarration(items, takes as VoiceTake[], service)
      .then((built) => {
        if (canceled) return
        audio.current?.pause()
        setPosition(0)
        setPlaying({
          url: URL.createObjectURL(new Blob([built.data], { type: 'audio/mpeg' })),
          segments: items,
          timeline: built.timeline,
          label: compareSource === 'candidate' ? '新しい読み' : '採用中の読み',
        })
      })
      .catch((e) => {
        if (!canceled) setNotice(e.message)
      })
    return () => {
      canceled = true
    }
  }, [record?.candidates, selection, compareSource, episode?.id, service])
  const routeRef = useRef(window.location.hash)
  const leaving = useRef(false)
  useEffect(() => {
    if (!record) return
    const gen = entitlement ? { model: entitlement.model, voices: entitlement.voices } : undefined
    const unfinished =
      record.takes.some((t) => ['queued', 'generating'].includes(t.state)) ||
      Object.keys(record.candidates ?? {}).length > 0 ||
      work.episodes.some((ep) =>
        resolveSegments(
          ep,
          record.settings,
          stagings.find((s) => s.episodeId === ep.id),
          gen,
        ).some((s) => {
          const take = record.takes.find((t) => t.id === record.accepted[s.id])
          return take
            ? take.fingerprint !== s.fingerprint
            : record.settings.cues.some((c) => c.episodeId === ep.id)
        }),
      )
    const move = (next: string) => {
      const action = () => {
        void service
          .flush()
          .then(() => {
            leaving.current = true
            window.location.hash = next
          })
          .catch((e) => setNotice(e.message))
      }
      if (!unfinished && !saving) action()
      else
        setConfirmation({
          title: '朗読の作業を中断しますか？',
          description:
            '作業内容と修正候補を保存して移動します。戻って続きを進められます。' +
            (record.takes.some((t) => ['queued', 'generating'].includes(t.state))
              ? '生成中の音声は画面を離れても生成を続けます。'
              : ''),
          label: '保存して移動',
          action,
        })
    }
    const click = (e: MouseEvent) => {
      const link = (e.target as Element).closest?.('a')
      if (!link?.hash || link.hash.startsWith('#/narration/')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      move(link.hash)
    }
    const hash = (e: HashChangeEvent) => {
      if (leaving.current || window.location.hash.startsWith('#/narration/')) {
        routeRef.current = window.location.hash
        return
      }
      if (!unfinished && !saving) return
      e.stopImmediatePropagation()
      const next = window.location.hash
      history.replaceState(null, '', routeRef.current)
      move(next)
    }
    const unload = (e: BeforeUnloadEvent) => {
      if (saving) e.preventDefault()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelection([])
        setOffsets({})
        setScope('episode')
      }
    }
    document.addEventListener('click', click, true)
    window.addEventListener('hashchange', hash, true)
    window.addEventListener('beforeunload', unload)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('click', click, true)
      window.removeEventListener('hashchange', hash, true)
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('keydown', key)
    }
  }, [record, entitlement, work, stagings, saving, service])
  useEffect(() => {
    if (!record || !entitlement) return
    const snapshots = { ...record.snapshots }
    let changed = false
    for (const ep of work.episodes) {
      if (snapshots[ep.id]) continue
      const legacy = resolveSegments(
        ep,
        record.settings,
        stagings.find((s) => s.episodeId === ep.id),
        { model: entitlement.model, voices: entitlement.voices, legacy: true },
      )
      if (legacy.length && legacy.every((s) => record.accepted[s.id])) {
        snapshots[ep.id] = legacy
        changed = true
      }
    }
    if (changed) void service.setRecord({ snapshots })
  }, [record, entitlement, work, stagings, service])
  if (!record || !episode)
    return (
      <main className="narration-studio" data-mobile-panel={mobilePanel}>
        <a href="#/write">執筆へ戻る</a>
        <p>{episode ? '設定を読み込み中…' : '話を追加すると朗読を作れます。'}</p>
      </main>
    )
  const settings = { ...record.settings, ...record.settings.episodes?.[episode.id] }
  settings.cues = settings.cues.map((c) =>
    c.episodeId === episode.id
      ? {
          ...c,
          refs: c.refs.map(
            (r) =>
              locateRef(
                r,
                plainText(episode.blocks.find((b) => b.id === r.blockId)?.inlines ?? []),
              ) ?? r,
          ),
        }
      : c,
  )
  const staging = stagings.find((s) => s.episodeId === episode.id)
  const generation = entitlement
    ? { model: entitlement.model, voices: entitlement.voices }
    : undefined
  const segments = resolveSegments(episode, settings, staging, generation)
  const targets = scope === 'episode' ? segments : segments.filter((s) => selection.includes(s.id))
  const selectedRefs = targets.map((s) => {
    const siblings = segments.filter((v) => v.blockId === s.blockId)
    const base = siblings
      .slice(
        0,
        siblings.findIndex((v) => v.id === s.id),
      )
      .reduce((n, v) => n + plainText(v.source.inlines).length, 0)
    return {
      blockId: s.blockId,
      snapshot: plainText(episode.blocks.find((b) => b.id === s.blockId)!.inlines),
      start: base + (offsets[s.id]?.start ?? 0),
      end: base + (offsets[s.id]?.end ?? plainText(s.source.inlines).length),
    }
  })
  const matchingCue = settings.cues.find(
    (c) =>
      c.episodeId === episode.id &&
      c.scope === scope &&
      (scope === 'episode' || JSON.stringify(c.refs) === JSON.stringify(selectedRefs)),
  )
  const cue: VoiceCue = matchingCue ?? {
    id: crypto.randomUUID(),
    episodeId: episode.id,
    scope,
    refs: scope === 'episode' ? [] : selectedRefs,
    direction: '',
  }
  const selectedText = targets
    .map((s) => plainText(s.source.inlines).slice(offsets[s.id]?.start ?? 0, offsets[s.id]?.end))
    .join('')
  const currentIndex =
    playing?.timeline.findIndex((t) => position >= t.start && position < t.end) ?? -1
  const running = record.takes.filter((t) => t.state === 'queued' || t.state === 'generating')
  const accepted = (segment: VoiceSegment) =>
    record.takes.find((t) => t.id === record.accepted[segment.id] && t.state === 'ready')
  const latest = (segment: VoiceSegment) =>
    record.takes.find((t) => t.id === record.candidates?.[segment.id] && t.state === 'ready')
  const cached = (s: VoiceSegment) =>
    record.takes
      .filter((t) => t.segmentId === s.id && t.fingerprint === s.fingerprint && t.state === 'ready')
      .at(-1)
  const opening = openingSegments(segments)
  const previewReady = opening.length > 0 && opening.every(cached)
  const pending = segments.filter(
    (s) =>
      accepted(s)?.fingerprint !== s.fingerprint &&
      !record.takes.some(
        (t) => t.segmentId === s.id && t.fingerprint === s.fingerprint && t.state === 'ready',
      ) &&
      !running.some((t) => t.segmentId === s.id),
  )
  const missing = segments.filter((s) => !accepted(s))
  const hasUnapplied = (id: string) => {
    const saved = record.snapshots?.[id]
    if (!saved) return false
    const ep = work.episodes.find((e) => e.id === id)
    if (!ep) return true
    const current = resolveSegments(
      ep,
      record.settings,
      stagings.find((s) => s.episodeId === id),
      generation,
    )
    return (
      saved.length !== current.length ||
      saved.some(
        (s, i) =>
          current[i]?.id !== s.id || accepted(current[i]!)?.fingerprint !== current[i]?.fingerprint,
      )
    )
  }
  const changed = segments.filter((s) => accepted(s) && accepted(s)?.fingerprint !== s.fingerprint)
  const cost = (items: VoiceSegment[]) => items.reduce((n, s) => n + s.characters, 0)
  const readyToGenerate = (items: VoiceSegment[]) =>
    !!entitlement?.enabled &&
    items.length > 0 &&
    cost(items) <= entitlement.remaining &&
    !sending &&
    !running.length &&
    !record.takes.some((t) => t.state === 'unknown') &&
    !items.some((s) => s.characters > 800)
  const patchSettings = (patch: Partial<typeof settings>) => {
    const { style, narrator, ...rest } = patch
    service.changeSettings({
      ...record.settings,
      ...rest,
      episodes:
        style !== undefined || narrator !== undefined
          ? {
              ...record.settings.episodes,
              [episode.id]: {
                style: style ?? settings.style,
                narrator: narrator ?? settings.narrator,
              },
            }
          : record.settings.episodes,
    })
  }
  const patchCue = (patch: Partial<VoiceCue>) => {
    const next = { ...cue, ...patch }
    patchSettings({ cues: [...settings.cues.filter((c) => c.id !== cue.id), next] })
  }
  const clearSelection = () => {
    setSelection([])
    setOffsets({})
    setScope('episode')
  }
  const select = (id: string, extend = false) => {
    audio.current?.pause()
    if (selection.length === 1 && selection[0] === id && !extend) {
      clearSelection()
      return
    }
    if (extend && selection.length) {
      const a = segments.findIndex((s) => s.id === selection[0]),
        b = segments.findIndex((s) => s.id === id)
      setSelection(segments.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.id))
    } else setSelection([id])
    setOffsets({})
    setScope('range')
  }
  const captureSelection = () => {
    const native = window.getSelection()
    if (!native || native.isCollapsed || !native.rangeCount || !manuscript.current) return
    const range = native.getRangeAt(0)
    if (
      !manuscript.current.contains(range.startContainer) ||
      !manuscript.current.contains(range.endContainer)
    )
      return
    const ids: string[] = [],
      next: Record<string, { start: number; end: number }> = {}
    for (const el of manuscript.current.querySelectorAll<HTMLElement>('[data-segment]')) {
      if (!range.intersectsNode(el)) continue
      let start = 0,
        end = el.textContent?.length ?? 0
      const r = document.createRange()
      r.selectNodeContents(el)
      if (el.contains(range.startContainer)) {
        r.setEnd(range.startContainer, range.startOffset)
        start = r.toString().length
      }
      r.selectNodeContents(el)
      if (el.contains(range.endContainer)) {
        r.setEnd(range.endContainer, range.endOffset)
        end = r.toString().length
      }
      if (end > start) {
        ids.push(el.dataset.segment!)
        next[el.dataset.segment!] = { start, end }
      }
    }
    if (ids.length) {
      dragged.current = true
      audio.current?.pause()
      setSelection(ids)
      setOffsets(next)
      setScope('range')
    }
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
      segments
        .filter((s) => episode.blocks.slice(start, end).some((b) => b.id === s.blockId))
        .map((s) => s.id),
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
  const generate = (
    items: VoiceSegment[],
    regenerate = false,
    whole = false,
    preview = false,
    retry = false,
  ) => {
    if (
      !consent ||
      (whole && (!!record.snapshots?.[episode.id] || segments.some(accepted)) && !retry)
    ) {
      setGenerationRequest({ segments: items, regenerate, whole, preview, retry })
      return
    }
    void act(() => service.generate(items, regenerate, { whole, preview, retry }))
  }
  const play = async (items: VoiceSegment[], variant: 'accepted' | 'candidate', from = 0) => {
    audio.current?.pause()
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
      label:
        scope === 'episode'
          ? '一話の朗読'
          : variant === 'candidate'
            ? '新しい読み'
            : '採用中の読み',
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
      const pieces =
        record.snapshots?.[id] ??
        resolveSegments(
          ep,
          settings,
          stagings.find((s) => s.episodeId === id),
          generation,
        )
      const takes = pieces.map(accepted)
      if (takes.some((t) => !t))
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
  const requestExport = (ids: string[]) => {
    const action = () => void act(() => exportEpisodes(ids))
    if (changed.length || ids.some(hasUnapplied) || Object.keys(record.candidates ?? {}).length)
      setConfirmation({
        title: '現在の音声を書き出しますか？',
        description:
          '本文の変更や修正候補が音声に反映されていない箇所があります。現在採用中の音声を書き出します。',
        label: '書き出す',
        action,
      })
    else action()
  }
  const saveLabel = saving ? '保存中…' : '保存済み'
  const targetLabel =
    scope === 'episode'
      ? 'この話全体'
      : scope === 'scene'
        ? `この場面（${targets.length}段落）`
        : '選択部分の修正'
  const voices = entitlement?.voices ?? []
  const invalid = settings.cues.filter((c) => c.episodeId === episode.id && !cueIsValid(c, episode))
  const comparisonPlayback = playing?.label === '新しい読み' || playing?.label === '採用中の読み'
  const player = playing && (
    <div className="narration-player">
      <span>{playing.label}</span>
      {/* biome-ignore lint/a11y/useMediaCaption: 朗読対象の原稿は画面中央に全文を表示する。 */}
      <audio
        ref={audio}
        key={playing.url}
        controls
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
          if (segment) {
            audio.current?.pause()
            select(segment.id)
          }
        }}
      >
        ここを直す
      </Button>
    </div>
  )
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
                requestExport(
                  work.episodes.filter((e) => exportIds.includes(e.id)).map((e) => e.id),
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
          aria-pressed={mobilePanel === 'inspector'}
          onClick={() => {
            setMobilePanel('inspector')
          }}
        >
          読み方
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
                title={episode.title}
                onChange={(e) => {
                  setEpisodeId(e.target.value)
                  setSelection([])
                  setOffsets({})
                  setPlaying(null)
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
                    {(() => {
                      const count = resolveSegments(
                        e,
                        record.settings,
                        stagings.find((v) => v.episodeId === e.id),
                        generation,
                      ).filter(
                        (s) =>
                          latest(s) || (accepted(s) && accepted(s)?.fingerprint !== s.fingerprint),
                      ).length
                      return count ? ' · 作業途中 ' + count : ''
                    })()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="narration-selection-bar">
            <span>{scope === 'episode' ? '一話全体' : selectedText.length + '文字を選択中'}</span>
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
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Blank space deselects; Escape and the explicit button provide keyboard equivalents. */}
          <div
            ref={manuscript}
            className="narration-paragraphs"
            onPointerUp={captureSelection}
            onClick={(e) => {
              if (e.target === e.currentTarget) clearSelection()
            }}
            role="presentation"
          >
            {segments.map((segment, i) => {
              const take = accepted(segment),
                candidate = latest(segment),
                instructions = cuesForBlock(settings, episode, segment.blockId)
              const isCurrent = playing?.segments[currentIndex]?.id === segment.id
              const active = scope !== 'episode' && selection.includes(segment.id)
              const lastAttempt = record.takes.filter((t) => t.segmentId === segment.id).at(-1)
              const status = running.some((t) => t.segmentId === segment.id)
                ? '生成中'
                : candidate && candidate.id !== take?.id
                  ? '比較待ち'
                  : take
                    ? take.fingerprint === segment.fingerprint
                      ? '採用済み'
                      : '変更あり'
                    : candidate
                      ? '比較待ち'
                      : lastAttempt?.state === 'failed'
                        ? '生成に失敗'
                        : lastAttempt?.state === 'unknown'
                          ? '結果を確認中'
                          : lastAttempt?.state === 'missing'
                            ? '保管期限切れ'
                            : record.snapshots?.[episode.id]
                              ? '音声に未反映'
                              : '未生成'
              return (
                <article
                  key={segment.id}
                  className={`narration-paragraph ${segments[i - 1]?.blockId !== segment.blockId ? 'is-block-start' : ''} ${active ? 'is-selected' : ''} ${isCurrent ? 'is-playing' : ''}`}
                >
                  {staging?.cues.some((c) => c.blockId === segment.blockId && c.sceneBreak) && (
                    <div className="narration-scene">場面の切れ目</div>
                  )}
                  <button
                    type="button"
                    className="narration-paragraph-select"
                    aria-pressed={active}
                    aria-label={`文章${i + 1}を選ぶ`}
                    onClick={(e) => {
                      if (dragged.current) {
                        dragged.current = false
                        return
                      }
                      select(segment.id, e.shiftKey)
                    }}
                  >
                    <span className="narration-line-number">{String(i + 1).padStart(2, '0')}</span>
                    <span className="narration-prose" data-segment={segment.id}>
                      {active ? (
                        <>
                          {plainText(segment.source.inlines).slice(
                            0,
                            offsets[segment.id]?.start ?? 0,
                          )}
                          <mark>
                            {plainText(segment.source.inlines).slice(
                              offsets[segment.id]?.start ?? 0,
                              offsets[segment.id]?.end,
                            )}
                          </mark>
                          {offsets[segment.id]?.end !== undefined
                            ? plainText(segment.source.inlines).slice(offsets[segment.id]!.end)
                            : ''}
                        </>
                      ) : (
                        plainText(segment.source.inlines)
                      )}
                    </span>
                  </button>
                  <div className="narration-paragraph-meta">
                    <span
                      className={
                        status === '未生成' && !instructions.length
                          ? 'narration-initial-status'
                          : ''
                      }
                    >
                      {status === '採用済み' ? '' : status}
                    </span>
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
          <section hidden={scope !== 'episode'}>
            <span className="narration-eyebrow">この話の設定</span>
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
            <label>
              朗読スタイル
              <select
                value={settings.style}
                onChange={(e) => patchSettings({ style: e.target.value })}
              >
                {STYLES.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.label}
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary>配役を設定</summary>
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
                      ...(staging?.cues.map((c) => c.speaker).filter((s): s is string => !!s) ??
                        []),
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
            </details>
          </section>
          <section className="narration-direction">
            {scope !== 'episode' && (
              <button type="button" className="narration-base-summary" onClick={clearSelection}>
                <Headphones size={14} />
                {voices.find((v) => v.id === settings.narrator)?.label ?? '語り手'} ·{' '}
                {STYLES.find((v) => v.id === settings.style)?.label}
                <span aria-hidden="true">全体の設定</span>
              </button>
            )}
            <div className="narration-section-head">
              <h2>{targetLabel}</h2>
              {scope !== 'episode' && (
                <button type="button" onClick={clearSelection}>
                  × 選択解除
                </button>
              )}
            </div>
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
            {scope !== 'episode' && <blockquote>{selectedText}</blockquote>}
            <label>
              どんなふうに読んでほしいですか？
              <textarea
                rows={3}
                maxLength={180}
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
                            180,
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
              {scope !== 'episode' && (
                <Button
                  className="narration-wide"
                  disabled={!readyToGenerate(targets) || busy || !!record.operation}
                  onClick={() => generate(targets, true)}
                >
                  選択部分を修正して生成 · {cost(targets).toLocaleString()}文字
                </Button>
              )}
              {scope !== 'episode' && targets.some(latest) && (
                <>
                  <p className="narration-help">
                    新しい生成が成功すると、この範囲の候補が置き換わります。
                  </p>
                  <div className="narration-compare">
                    <button
                      type="button"
                      aria-pressed={compareSource === 'accepted'}
                      disabled={targets.some((s) => !accepted(s))}
                      onClick={() => {
                        setCompareSource('accepted')
                        void act(() => audition('accepted'))
                      }}
                    >
                      元の読み
                    </button>
                    <button
                      type="button"
                      aria-pressed={compareSource === 'candidate'}
                      onClick={() => {
                        setCompareSource('candidate')
                        void act(() => audition('candidate'))
                      }}
                    >
                      新しい読み
                    </button>
                  </div>
                  {comparisonPlayback && player}
                  <Button
                    className="narration-wide"
                    disabled={
                      busy || (compareSource === 'accepted' && targets.some((s) => !accepted(s)))
                    }
                    onClick={() =>
                      void act(() => service.adopt(targets, compareSource === 'candidate'))
                    }
                  >
                    こちらを採用
                  </Button>
                </>
              )}
              {record.undo && (
                <button type="button" onClick={() => void act(() => service.undoAdoption())}>
                  元に戻す
                </button>
              )}
              {scope === 'episode' && (
                <>
                  <Button
                    disabled={
                      busy ||
                      (!previewReady &&
                        (!entitlement?.preview?.remaining || !opening.length || running.length > 0))
                    }
                    onClick={() => {
                      if (previewReady)
                        void act(async () => {
                          const built = await assembleNarration(
                            opening,
                            opening.map(cached) as VoiceTake[],
                            service,
                          )
                          setPlaying({
                            url: URL.createObjectURL(
                              new Blob([built.data], { type: 'audio/mpeg' }),
                            ),
                            timeline: built.timeline,
                            segments: opening,
                            label: 'スタイル試聴',
                          })
                          setPosition(0)
                        })
                      else generate(opening, false, false, true)
                    }}
                  >
                    スタイルを試聴
                  </Button>
                  <p className="narration-help">
                    冒頭 {cost(opening)}文字 · 文字数消費なし
                    <br />
                    本日の残り {entitlement?.preview?.remaining ?? '—'}
                    回。同条件の再生は回数を使いません。
                  </p>
                </>
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
                  選択した言葉の読み方
                  <textarea
                    rows={3}
                    value={matchingCue?.reading ?? ''}
                    maxLength={3000}
                    placeholder={selectedText}
                    onChange={(e) => {
                      const reading = e.target.value
                      const next = { ...cue, reading: reading || undefined }
                      patchSettings({
                        cues: [...settings.cues.filter((c) => c.id !== cue.id), next],
                        dictionary: commonReading
                          ? [
                              ...settings.dictionary.filter((d) => d.surface !== selectedText),
                              ...(reading
                                ? [{ id: crypto.randomUUID(), surface: selectedText, reading }]
                                : []),
                            ]
                          : settings.dictionary,
                      })
                    }}
                  />
                </label>
              )}
              {targets.length === 1 && scope !== 'episode' && (
                <label className="narration-inline-check">
                  <input
                    type="checkbox"
                    checked={commonReading}
                    onChange={(e) => {
                      setCommonReading(e.target.checked)
                      if (matchingCue?.reading)
                        patchSettings({
                          dictionary: e.target.checked
                            ? [
                                ...settings.dictionary.filter((d) => d.surface !== selectedText),
                                {
                                  id: crypto.randomUUID(),
                                  surface: selectedText,
                                  reading: matchingCue.reading,
                                },
                              ]
                            : settings.dictionary.filter((d) => d.surface !== selectedText),
                        })
                    }}
                  />
                  この作品の同じ表記にも使う
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
          </section>
          {record.takes.some(
            (t) =>
              t.state === 'ready' &&
              t.segmentId.startsWith(episode.id + ':') &&
              !segments.some((s) => s.id === t.segmentId),
          ) && (
            <details>
              <summary>以前の生成音声</summary>
              {record.takes
                .filter(
                  (t) =>
                    t.state === 'ready' &&
                    t.segmentId.startsWith(episode.id + ':') &&
                    !segments.some((s) => s.id === t.segmentId),
                )
                .map((t, i) => (
                  <div className="narration-take" key={t.id}>
                    <span>音声 {i + 1}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void act(async () => {
                          const blob = await service.audio(t.id)
                          setPlaying({
                            url: URL.createObjectURL(blob),
                            segments: [],
                            timeline: [],
                            label: '以前の音声',
                          })
                        })
                      }
                    >
                      聴く
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void act(async () => {
                          const blob = await service.audio(t.id)
                          triggerDownload({
                            filename: '朗読-' + (i + 1) + '.mp3',
                            mime: 'audio/mpeg',
                            data: new Uint8Array(await blob.arrayBuffer()),
                          })
                        })
                      }
                    >
                      MP3で保存
                    </button>
                  </div>
                ))}
            </details>
          )}
          <details className="narration-dictionary" hidden={!settings.dictionary.length}>
            <summary>読み方の修正</summary>
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
          </details>
          <details hidden={!settings.cues.some((c) => c.episodeId === episode.id)}>
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
                      setScope(c.scope)
                      setSelection(
                        segments
                          .filter((s) => c.refs.some((r) => r.blockId === s.blockId))
                          .map((s) => s.id),
                      )
                      const next: Record<string, { start: number; end: number }> = {}
                      for (const s of segments) {
                        const r = c.refs.find((r) => r.blockId === s.blockId)
                        if (!r) continue
                        const siblings = segments.filter((v) => v.blockId === s.blockId)
                        const at = siblings
                          .slice(
                            0,
                            siblings.findIndex((v) => v.id === s.id),
                          )
                          .reduce((n, v) => n + plainText(v.source.inlines).length, 0)
                        if (
                          (r.start ?? 0) < at + plainText(s.source.inlines).length &&
                          (r.end ?? Infinity) > at
                        )
                          next[s.id] = {
                            start: Math.max(0, (r.start ?? 0) - at),
                            end: Math.min(
                              plainText(s.source.inlines).length,
                              (r.end ?? Infinity) - at,
                            ),
                          }
                      }
                      setSelection(Object.keys(next))
                      setOffsets(next)
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
        {record.operation &&
          running.length === 0 &&
          (() => {
            const op = record.operation
            const retry = op.segments.filter(
              (s) =>
                !record.takes.some(
                  (t) =>
                    op.jobs.includes(t.jobId) &&
                    t.segmentId === s.id &&
                    t.fingerprint === s.fingerprint &&
                    t.state === 'ready',
                ),
            )
            return (
              retry.length > 0 && (
                <div className="narration-progress">
                  現在の音声は保持されています。
                  <Button
                    disabled={busy || !readyToGenerate(retry)}
                    onClick={() => generate(retry, true, op.whole, op.preview, true)}
                  >
                    未完了の区間を再生成 · {cost(retry)}文字
                  </Button>
                </div>
              )
            )
          })()}
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
        {!comparisonPlayback && player}
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
          {segments.length > 0 && (
            <Button
              disabled={
                !!record.operation ||
                !(
                  readyToGenerate(
                    !record.snapshots?.[episode.id] && missing.length ? pending : segments,
                  ) ||
                  (missing.length > 0 && !pending.length && !running.length)
                ) ||
                busy
              }
              onClick={() =>
                generate(segments, !!record.snapshots?.[episode.id] || !missing.length, true)
              }
            >
              {sending
                ? '生成を開始中…'
                : `${!record.snapshots?.[episode.id] && missing.length ? '一話を生成' : '一話を再生成'} · ${cost(!record.snapshots?.[episode.id] && missing.length ? pending : segments).toLocaleString()}文字`}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy || !(record.snapshots?.[episode.id] ?? segments).every(accepted)}
            onClick={() =>
              void act(() => play(record.snapshots?.[episode.id] ?? segments, 'accepted'))
            }
          >
            <Play size={15} />
            通して聴く
          </Button>
          {(record.snapshots?.[episode.id] || !missing.length) && (
            <Button variant="outline" disabled={busy} onClick={() => requestExport([episode.id])}>
              <Download size={15} />
              MP3を書き出す
            </Button>
          )}
        </div>
        {entitlement &&
          cost(record.snapshots?.[episode.id] ? segments : pending) > entitlement.remaining && (
            <p className="narration-help">
              必要 {cost(record.snapshots?.[episode.id] ? segments : pending).toLocaleString()}文字
              / 残り {entitlement.remaining.toLocaleString()}文字
            </p>
          )}
      </footer>
      <ConfirmDialog
        open={generationRequest !== null}
        onOpenChange={(open) => {
          if (!open) setGenerationRequest(null)
        }}
        title={
          generationRequest?.whole && (!!record.snapshots?.[episode.id] || segments.some(accepted))
            ? '一話を再生成して上書きしますか？'
            : '原稿を送信して音声を作りますか？'
        }
        description={
          '原稿・読み・演技指示をFish Audioへ送信します。' +
          (generationRequest?.preview
            ? 'スタイル試聴は文字数消費なし。'
            : '今回 ' +
              cost(
                (generationRequest?.segments ?? []).filter(
                  (s) => generationRequest?.regenerate || !cached(s),
                ),
              ).toLocaleString() +
              '文字。生成後の残り ' +
              Math.max(
                0,
                (entitlement?.remaining ?? 0) -
                  cost(
                    (generationRequest?.segments ?? []).filter(
                      (s) => generationRequest?.regenerate || !cached(s),
                    ),
                  ),
              ).toLocaleString() +
              '文字。') +
          (generationRequest?.whole && (!!record.snapshots?.[episode.id] || segments.some(accepted))
            ? '全区間の成功後に上書きします。個別指示は引き継ぎます。今の音声を残す場合は先にMP3を保存してください。'
            : '')
        }
        confirmLabel="同意して生成"
        destructive={false}
        onConfirm={() => {
          if (!generationRequest) return
          setConsent(true)
          localStorage.setItem('ns-narration-consent', '1')
          void act(() =>
            service.generate(generationRequest.segments, generationRequest.regenerate, {
              whole: generationRequest.whole,
              preview: generationRequest.preview,
              retry: generationRequest.retry,
            }),
          )
        }}
      />
      <ConfirmDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
        title={confirmation?.title ?? ''}
        description={confirmation?.description}
        confirmLabel={confirmation?.label}
        cancelLabel="作業を続ける"
        destructive={false}
        onConfirm={() => confirmation?.action()}
      />
    </main>
  )
}

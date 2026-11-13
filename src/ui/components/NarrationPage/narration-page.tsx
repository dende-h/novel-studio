import { ArrowLeft, Download, Headphones } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Staging } from '@/core/game'
import { narrationFilename } from '@/core/narration/mp3'
import {
  cueIsValid,
  cuesForBlock,
  locateRef,
  openingSegments,
  plainText,
  readingCuesNeedingReview,
  resolveSegments,
} from '@/core/narration/resolve'
import { selectNarrationSentence } from '@/core/narration/selection'
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
import { narrationTransfer, subscribeNarrationTransfer } from '@/ui/narration/transfer-status'
import type { EditorStore } from '@/ui/store/editorStore'
import { NarrationCloudStatus } from './narration-cloud-status'
import { NarrationPlayer } from './narration-player'
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
  const cloud = useSyncExternalStore(subscribeNarrationTransfer, () =>
    narrationTransfer(auth.userId ?? 'local'),
  )
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
  const fullAudio = useRef<HTMLAudioElement>(null)
  const [fullPlayback, setFullPlayback] = useState<typeof playing>(null)
  const [fullPosition, setFullPosition] = useState(0)
  const [activePlayer, setActivePlayer] = useState<'full' | 'detail'>('full')
  const acceptedKey = JSON.stringify(record?.accepted ?? {})
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only adopted audio changes invalidate the full reading, not polling or draft edits.
  useEffect(() => {
    setFullPlayback(null)
  }, [acceptedKey])

  useEffect(
    () => () => {
      if (fullPlayback) URL.revokeObjectURL(fullPlayback.url)
    },
    [fullPlayback],
  )

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
        fullAudio.current?.pause()
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
  const paragraphs = segments.map((segment) => [segment])
  const needsSentenceRebuild = (record.snapshots?.[episode.id] ?? []).some(
    (saved) => !segments.some((current) => current.id === saved.id),
  )
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
      start: base,
      end: base + plainText(s.source.inlines).length,
    }
  })
  const readingRefs = selectedRefs.flatMap((ref, i) => {
    const offset = offsets[targets[i]!.id]
    return offset ? [{ ...ref, start: ref.start + offset.start, end: ref.start + offset.end }] : []
  })
  const matchingCue = settings.cues.findLast(
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
  const selectedText = targets.map((s) => plainText(s.source.inlines)).join('')
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
  const readingReview = readingCuesNeedingReview(episode, settings)
  const cost = (items: VoiceSegment[]) => items.reduce((n, s) => n + s.characters, 0)
  const readyToGenerate = (items: VoiceSegment[]) =>
    !!entitlement?.enabled &&
    items.length > 0 &&
    !readingReview.some(
      (c) => !c.refs.length || c.refs.some((r) => items.some((s) => s.blockId === r.blockId)),
    ) &&
    cost(items) <= entitlement.remaining &&
    !sending &&
    !running.length &&
    !record.takes.some((t) => t.state === 'unknown') &&
    !items.some((s) => s.characters > 800)
  const patchSettings = (patch: Partial<typeof settings>) => {
    const { style, narrator, mode, ...rest } = patch
    service.changeSettings({
      ...record.settings,
      ...rest,
      episodes:
        style !== undefined || narrator !== undefined || mode !== undefined
          ? {
              ...record.settings.episodes,
              [episode.id]: {
                ...record.settings.episodes?.[episode.id],
                ...(mode !== undefined ? { mode } : {}),
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
    window.getSelection()?.removeAllRanges()
    setSelection([])
    setOffsets({})
    setScope('episode')
  }
  const select = (id: string, only = false) => {
    audio.current?.pause()
    fullAudio.current?.pause()
    window.getSelection()?.removeAllRanges()
    const next = selectNarrationSentence(
      segments.map((segment) => segment.id),
      selection,
      id,
      only,
    )
    if (!next.length) {
      clearSelection()
      return
    }
    setSelection(next)
    setOffsets({})
    setScope('range')
  }
  const selectReading = (start: number, end: number) => {
    if (start === end) return
    let at = 0
    const next: Record<string, { start: number; end: number }> = {}
    for (const part of targets) {
      const length = plainText(part.source.inlines).length
      if (start < at + length && end > at)
        next[part.id] = { start: Math.max(0, start - at), end: Math.min(length, end - at) }
      at += length
    }
    if (Object.keys(next).length > 1) {
      setNotice('読み仮名は一文の中の語句を選んで指定してください。')
      setOffsets({})
      return
    }
    setNotice('')
    setOffsets(next)
  }
  const openCue = (c: VoiceCue) => {
    audio.current?.pause()
    fullAudio.current?.pause()
    setScope(c.scope)
    const next: Record<string, { start: number; end: number }> = {}
    for (const [i, segment] of segments.entries()) {
      const at = segments
        .slice(0, i)
        .filter((s) => s.blockId === segment.blockId)
        .reduce((n, s) => n + plainText(s.source.inlines).length, 0)
      const length = plainText(segment.source.inlines).length
      const refs = c.refs.filter(
        (r) =>
          r.blockId === segment.blockId && (r.start ?? 0) < at + length && (r.end ?? Infinity) > at,
      )
      if (refs.length)
        next[segment.id] = {
          start: Math.max(0, Math.min(...refs.map((r) => r.start ?? 0)) - at),
          end: Math.min(length, Math.max(...refs.map((r) => r.end ?? Infinity)) - at),
        }
    }
    const ids = segments.filter((v) => next[v.id]).map((v) => v.id)
    setSelection(ids)
    setOffsets(c.reading ? next : {})
    setMobilePanel('inspector')
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
    if (!whole && !preview && needsSentenceRebuild) {
      setNotice('前回の音声と文の区切りが異なります。先に一話を再生成してください。')
      return
    }
    if (
      readingReview.some(
        (c) => !c.refs.length || c.refs.some((r) => items.some((s) => s.blockId === r.blockId)),
      )
    ) {
      setNotice('複数の文にまたがる以前の読み指定を確認してください。')
      return
    }
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
        items === record.snapshots?.[episode.id] || items === segments
          ? '一話の朗読'
          : variant === 'candidate'
            ? '新しい読み'
            : '採用中の読み',
    })
    setPosition(from)
  }
  const loadFullPlayback = async () => {
    audio.current?.pause()
    const items = record.snapshots?.[episode.id] ?? segments
    const takes = items.map(accepted)
    if (!items.length || takes.some((t) => !t)) return
    const built = await assembleNarration(items, takes as VoiceTake[], service)
    setFullPlayback({
      url: URL.createObjectURL(new Blob([built.data], { type: 'audio/mpeg' })),
      timeline: built.timeline,
      segments: items,
      label: '一話の読み',
    })
    setActivePlayer('full')
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
  const saveLabel = saving ? '保存中…' : '端末に保存済み'
  const voices = entitlement?.voices ?? []
  const voiceRanges = settings.cues.filter(
    (c) =>
      c.episodeId === episode.id &&
      c.scope !== 'episode' &&
      cueIsValid(c, episode) &&
      (c.voiceId || c.style),
  )
  const baseControls = (
    <>
      {' '}
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
        <select value={settings.style} onChange={(e) => patchSettings({ style: e.target.value })}>
          {STYLES.map((style) => (
            <option key={style.id} value={style.id}>
              {style.label}
            </option>
          ))}
        </select>
      </label>
      <div className="narration-timing">
        {' '}
        <label>
          速さ
          <select
            value={matchingCue?.speed ?? ''}
            onChange={(e) =>
              patchCue({ speed: e.target.value ? Number(e.target.value) : undefined })
            }
          >
            <option value="">スタイル通り</option>
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
            <option value="">スタイル通り</option>
            <option value="0">文末の間のみ</option>
            <option value="350">短め 0.35秒</option>
            <option value="700">長め 0.7秒</option>
            <option value="1500">余韻 1.5秒</option>
          </select>
        </label>
      </div>
    </>
  )
  const invalid = settings.cues.filter((c) => c.episodeId === episode.id && !cueIsValid(c, episode))
  const detachedCues = settings.cues.filter(
    (c) =>
      c.episodeId === episode.id &&
      (!cueIsValid(c, episode) || c.scope === 'scene' || (c.scope === 'episode' && !!c.direction)),
  )
  const comparisonPlayback = playing?.label === '新しい読み' || playing?.label === '採用中の読み'
  const player = playing && (
    <div className="narration-player">
      <NarrationPlayer
        audioRef={audio}
        url={playing.url}
        label={playing.label}
        position={position}
        onPosition={setPosition}
        onStart={() => {
          fullAudio.current?.pause()
          setActivePlayer('detail')
        }}
      />
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
        {(record.snapshots?.[episode.id] || !missing.length) && (
          <Button variant="outline" disabled={busy} onClick={() => requestExport([episode.id])}>
            <Download size={15} />
            MP3で保存
          </Button>
        )}
        <details className="narration-popover narration-export-menu">
          <summary>
            書き出し設定 <span aria-hidden="true">⌄</span>
          </summary>
          <div className="narration-popover-body">
            <NarrationCloudStatus />
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
      {(error || notice || cloud.error) && (
        <div className="narration-notice" role="status">
          {notice || error || cloud.error}
          <button type="button" onClick={() => void act(() => service.refresh())}>
            状態を更新
          </button>
        </div>
      )}
      <div className="narration-workspace">
        <section className="narration-manuscript">
          <div className="narration-manuscript-toolbar">
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
                    setFullPlayback(null)
                    setFullPosition(0)
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
                            latest(s) ||
                            (accepted(s) && accepted(s)?.fingerprint !== s.fingerprint),
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

            <section className="narration-state-legend" aria-label="本文の色分け">
              <span className="narration-legend-title">色の見方</span>
              {(
                [
                  ['empty', '未生成'],
                  ['ready', '生成済み'],
                  ['compare', '比較待ち'],
                  ['changed', '変更・未反映'],
                  ['selected', '選択中'],
                  ...(running.length ? [['working', '生成中']] : []),
                  ...(record.takes.some((t) => ['failed', 'unknown', 'missing'].includes(t.state))
                    ? [['error', '要確認']]
                    : []),
                ] as const
              ).map(([tone, label]) => (
                <span key={tone} data-narration-state={tone} className="narration-state-tag">
                  {label}
                </span>
              ))}
            </section>
          </div>

          {invalid.length > 0 && (
            <div className="narration-notice">
              原稿が変わったため、{invalid.length}
              件の指示を確認してください。元の指示は「本文から開けない指示」に残っています。
            </div>
          )}
          {segments.some((s) => s.characters > 800) && (
            <p role="alert" className="narration-notice">
              800文字を超える文があります。本文を句点などで区切ってください。
            </p>
          )}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Blank space deselects; Escape and the explicit button provide keyboard equivalents. */}
          <div
            ref={manuscript}
            className="narration-paragraphs"
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('[data-selectable]')) clearSelection()
            }}
            role="presentation"
          >
            {paragraphs.map((parts) => {
              const details = parts.map((segment) => {
                const i = segments.indexOf(segment)
                const take = accepted(segment),
                  candidate = latest(segment),
                  instructions = cuesForBlock(settings, episode, segment.blockId).filter((c) => {
                    const start = segments
                      .slice(0, i)
                      .filter((v) => v.blockId === segment.blockId)
                      .reduce((n, v) => n + plainText(v.source.inlines).length, 0)
                    return (
                      c.scope === 'episode' ||
                      c.refs.some(
                        (r) =>
                          r.blockId === segment.blockId &&
                          (r.start === undefined ||
                            (r.start < start + plainText(segment.source.inlines).length &&
                              (r.end ?? Infinity) > start)),
                      )
                    )
                  })
                const isCurrent =
                  (activePlayer === 'full'
                    ? fullPlayback?.segments[
                        fullPlayback.timeline.findIndex(
                          (t) => fullPosition >= t.start && fullPosition < t.end,
                        )
                      ]?.id
                    : playing?.segments[currentIndex]?.id) === segment.id
                const active = scope !== 'episode' && selection.includes(segment.id)
                const lastAttempt = record.takes.filter((t) => t.segmentId === segment.id).at(-1)
                const status = running.some((t) => t.segmentId === segment.id)
                  ? '生成中'
                  : candidate && candidate.id !== take?.id
                    ? '比較待ち'
                    : take
                      ? take.fingerprint === segment.fingerprint
                        ? '生成済み'
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
                const tone =
                  status === '生成済み'
                    ? 'ready'
                    : status === '比較待ち'
                      ? 'compare'
                      : status === '未生成'
                        ? 'empty'
                        : status === '生成中'
                          ? 'working'
                          : status === '変更あり' || status === '音声に未反映'
                            ? 'changed'
                            : 'error'
                return { segment, active, isCurrent, status, tone, instructions, lastAttempt }
              })
              const statuses = details.filter(
                (d, i) => details.findIndex((v) => v.status === d.status) === i,
              )
              const instructions = Array.from(
                new Map(
                  details
                    .flatMap((d) => d.instructions)
                    .filter((c) => c.scope === 'range')
                    .map((c) => [c.id, c]),
                ).values(),
              )
              return (
                <div className="narration-block" key={parts[0]!.id}>
                  <div className="narration-block-select">
                    {details.map(({ segment, active, isCurrent, tone }) => (
                      <span
                        key={segment.id}
                        data-narration-state={tone}
                        className={`narration-paragraph ${active ? 'is-selected' : ''} ${isCurrent ? 'is-playing' : ''}`}
                      >
                        <button
                          type="button"
                          data-selectable
                          className="narration-paragraph-select"
                          aria-pressed={active}
                          aria-label={`文${segments.indexOf(segment) + 1}を選ぶ`}
                          onClick={() => select(segment.id)}
                        >
                          <span className="narration-prose" data-segment={segment.id}>
                            {active ? (
                              <mark>{plainText(segment.source.inlines)}</mark>
                            ) : (
                              plainText(segment.source.inlines)
                            )}
                          </span>
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="narration-paragraph-meta">
                    {statuses.map(({ status, tone }) => (
                      <span
                        key={status}
                        data-narration-state={tone}
                        className="narration-state-tag"
                      >
                        {status}
                      </span>
                    ))}
                    {Array.from(
                      new Set(details.map((d) => d.lastAttempt?.error).filter(Boolean)),
                    ).map((error) => (
                      <span key={error} role="status">
                        {error}
                      </span>
                    ))}
                    {instructions.map((c) => (
                      <button
                        type="button"
                        className="narration-instruction-link"
                        key={c.id}
                        title={[
                          c.refs.map((r) => r.snapshot.slice(r.start, r.end)).join(' … '),
                          c.direction,
                          c.reading,
                        ]
                          .filter(Boolean)
                          .join(' / ')}
                        onClick={(e) => {
                          e.stopPropagation()
                          openCue(c)
                        }}
                      >
                        {c.reading ? '読み：' + c.reading : c.voiceId ? '声の指定' : '演技の指定'}
                      </button>
                    ))}
                  </div>
                </div>
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
          <fieldset className="narration-mode" aria-label="朗読の作り方">
            {(['solo', 'cast'] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                aria-pressed={settings.mode === mode}
                onClick={() => {
                  // Preserve legacy casting as explicit manuscript ranges on first mode choice.
                  const migrated =
                    record.settings.episodes?.[episode.id]?.mode === undefined
                      ? segments
                          .filter((part) => part.voiceId !== settings.narrator)
                          .map((part) => {
                            const block = episode.blocks.find((b) => b.id === part.blockId)!
                            const start = segments
                              .filter((v) => v.blockId === part.blockId)
                              .slice(
                                0,
                                segments
                                  .filter((v) => v.blockId === part.blockId)
                                  .findIndex((v) => v.id === part.id),
                              )
                              .reduce((n, v) => n + plainText(v.source.inlines).length, 0)
                            const refs = [
                              {
                                blockId: block.id,
                                snapshot: plainText(block.inlines),
                                start,
                                end: start + plainText(part.source.inlines).length,
                              },
                            ]
                            const previous = settings.cues.findLast(
                              (c) =>
                                c.episodeId === episode.id &&
                                c.scope === 'range' &&
                                JSON.stringify(c.refs) === JSON.stringify(refs),
                            )
                            return {
                              ...previous,
                              id: previous?.id ?? crypto.randomUUID(),
                              episodeId: episode.id,
                              scope: 'range' as const,
                              refs,
                              voiceId: part.voiceId,
                            }
                          })
                      : []
                  patchSettings({
                    mode,
                    cues: [
                      ...settings.cues.filter((c) => !migrated.some((v) => v.id === c.id)),
                      ...migrated,
                    ],
                  })
                }}
              >
                {mode === 'solo' ? 'ひとり朗読' : '複数の声'}
              </button>
            ))}
          </fieldset>
          {scope === 'episode' && settings.mode === 'cast' && (
            <section className="narration-cast-overview">
              <h2>本文に声を付ける</h2>
              <p className="narration-help">声を変えたい部分を、本文から選んでください。</p>
              {voices.length < 2 && <p className="narration-help">現在使える声は1種類です。</p>}
              <div className="narration-voice-ranges">
                {voiceRanges.length ? (
                  voiceRanges.map((c) => (
                    <button type="button" key={c.id} onClick={() => openCue(c)}>
                      <strong>
                        {voices.find((v) => v.id === c.voiceId)?.label ?? '基本の声'}
                        {c.style && <> · {STYLES.find((v) => v.id === c.style)?.label}</>}
                      </strong>
                      <span>{c.refs.map((r) => r.snapshot.slice(r.start, r.end)).join(' … ')}</span>
                    </button>
                  ))
                ) : (
                  <div className="narration-cast-empty">本文を選択 → 声とスタイルを指定</div>
                )}
              </div>
            </section>
          )}
          {scope === 'episode' && (
            <section>
              {settings.mode === 'solo' ? (
                <>
                  <h2>一話の声とスタイル</h2>
                  {baseControls}
                </>
              ) : (
                <details className="narration-base-voice">
                  <summary>
                    指定のない部分の読み方
                    <span>
                      {voices.find((v) => v.id === settings.narrator)?.label ?? '基本の声'} ·{' '}
                      {STYLES.find((v) => v.id === settings.style)?.label}
                    </span>
                  </summary>
                  {baseControls}
                </details>
              )}
            </section>
          )}
          <section className="narration-direction">
            <div className="narration-section-head">
              {scope !== 'episode' && <h2>この部分の読み方</h2>}
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
            {scope !== 'episode' && settings.mode === 'cast' && (
              <div className="narration-range-style">
                <label>
                  この部分の声
                  <select
                    value={matchingCue?.voiceId ?? ''}
                    onChange={(e) => patchCue({ voiceId: e.target.value || undefined })}
                  >
                    <option value="">語り手と同じ</option>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  この部分のスタイル
                  <select
                    value={matchingCue?.style ?? ''}
                    onChange={(e) => patchCue({ style: e.target.value || undefined })}
                  >
                    <option value="">一話の設定と同じ</option>
                    {STYLES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="narration-timing">
                  {' '}
                  <label>
                    速さ
                    <select
                      value={matchingCue?.speed ?? ''}
                      onChange={(e) =>
                        patchCue({ speed: e.target.value ? Number(e.target.value) : undefined })
                      }
                    >
                      <option value="">スタイル通り</option>
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
                      <option value="">スタイル通り</option>
                      <option value="0">文末の間のみ</option>
                      <option value="350">短め 0.35秒</option>
                      <option value="700">長め 0.7秒</option>
                      <option value="1500">余韻 1.5秒</option>
                    </select>
                  </label>
                </div>
              </div>
            )}
            {scope !== 'episode' && (
              <div className="narration-performance">
                <label>
                  どう読んでほしい？
                  <textarea
                    rows={3}
                    maxLength={180}
                    value={matchingCue?.direction ?? ''}
                    placeholder="少し寂しそうに。最後の「ありがと」だけ温かく"
                    onChange={(e) => patchCue({ direction: e.target.value })}
                  />
                </label>
                <div className="narration-chips">
                  {['ささやく', '寂しそうに', '温かく'].map((text) => (
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
                  ))}
                </div>
              </div>
            )}
            {scope !== 'episode' && (
              <details
                className="narration-reading"
                key={selection.join()}
                open={Object.keys(offsets).length > 0 || undefined}
              >
                <summary>読み方の修正</summary>
                <p className="narration-help">
                  読みを直す語句を下の文から選んでください。再生成は一文全体に適用します。
                </p>
                <textarea
                  className="narration-reading-picker"
                  aria-label="読みを直す語句を選択"
                  readOnly
                  value={selectedText}
                  rows={3}
                  onKeyDown={(e) => {
                    if (
                      e.ctrlKey ||
                      e.metaKey ||
                      !['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(e.key)
                    )
                      return
                    e.preventDefault()
                    const el = e.currentTarget
                    const backward = el.selectionDirection === 'backward'
                    const anchor = backward ? el.selectionEnd : el.selectionStart
                    const focus = backward ? el.selectionStart : el.selectionEnd
                    const next =
                      e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? el.value.length
                          : e.key === 'ArrowLeft'
                            ? Math.max(
                                0,
                                focus - (Array.from(el.value.slice(0, focus)).at(-1)?.length ?? 1),
                              )
                            : Math.min(
                                el.value.length,
                                focus + (Array.from(el.value.slice(focus))[0]?.length ?? 1),
                              )
                    el.setSelectionRange(
                      e.shiftKey ? Math.min(anchor, next) : next,
                      e.shiftKey ? Math.max(anchor, next) : next,
                      next < anchor ? 'backward' : 'forward',
                    )
                  }}
                  onPointerUp={(e) =>
                    selectReading(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)
                  }
                  onKeyUp={(e) =>
                    selectReading(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)
                  }
                />
                {readingRefs.map((ref) => {
                  const surface = ref.snapshot.slice(ref.start, ref.end)
                  const existing = settings.cues.findLast(
                    (c) =>
                      c.episodeId === episode.id &&
                      c.scope === 'range' &&
                      c.refs.length === 1 &&
                      JSON.stringify(c.refs[0]) === JSON.stringify(ref),
                  )
                  return (
                    <label key={ref.blockId + ':' + ref.start + ':' + ref.end}>
                      <span className="narration-reading-source">「{surface}」の読み仮名</span>
                      <input
                        value={existing?.reading ?? ''}
                        maxLength={3000}
                        placeholder="ひらがな・カタカナで入力"
                        onChange={(e) => {
                          const reading = e.target.value
                          const next: VoiceCue = {
                            ...existing,
                            id: existing?.id ?? crypto.randomUUID(),
                            episodeId: episode.id,
                            scope: 'range',
                            refs: [ref],
                            reading: reading || undefined,
                          }
                          patchSettings({
                            cues: [...settings.cues.filter((c) => c.id !== next.id), next],
                            dictionary: commonReading
                              ? [
                                  ...settings.dictionary.filter((d) => d.surface !== surface),
                                  ...(reading
                                    ? [{ id: crypto.randomUUID(), surface, reading }]
                                    : []),
                                ]
                              : settings.dictionary,
                          })
                        }}
                      />
                    </label>
                  )
                })}
                <label className="narration-inline-check">
                  <input
                    type="checkbox"
                    checked={commonReading}
                    disabled={!readingRefs.length}
                    onChange={(e) => {
                      setCommonReading(e.target.checked)
                      const entries = readingRefs.map((ref) => {
                        const c = settings.cues.findLast(
                          (c) =>
                            c.episodeId === episode.id &&
                            c.scope === 'range' &&
                            c.refs.length === 1 &&
                            JSON.stringify(c.refs[0]) === JSON.stringify(ref),
                        )
                        return {
                          id: crypto.randomUUID(),
                          surface: ref.snapshot.slice(ref.start, ref.end),
                          reading: c?.reading ?? '',
                        }
                      })
                      patchSettings({
                        dictionary: [
                          ...settings.dictionary.filter(
                            (d) => !entries.some((v) => v.reading && v.surface === d.surface),
                          ),
                          ...(e.target.checked ? entries.filter((v) => v.reading) : []),
                        ],
                      })
                    }}
                  />
                  この作品の同じ表記にも使う
                </label>
              </details>
            )}
            {scope !== 'episode' && needsSentenceRebuild && (
              <p role="status" className="narration-help">
                前回の音声と文の区切りが異なります。選択を解除して一話を再生成すると、文ごとの修正が使えます。以前の音声は再生成の完了まで残ります。
              </p>
            )}
            <div className="narration-trial">
              {scope !== 'episode' && (
                <Button
                  className="narration-wide"
                  disabled={
                    needsSentenceRebuild || !readyToGenerate(targets) || busy || !!record.operation
                  }
                  onClick={() => generate(targets, true)}
                >
                  {targets.some(latest)
                    ? 'もう一度修正して生成'
                    : targets.some(accepted)
                      ? '選択部分を修正して生成'
                      : '選択部分を生成'}
                </Button>
              )}
              {scope !== 'episode' && (
                <p className="narration-cost">
                  今回の消費 <strong>{cost(targets).toLocaleString()}文字</strong>
                </p>
              )}
              {scope !== 'episode' && targets.some(latest) && (
                <>
                  <p className="narration-help">生成に成功すると、修正候補を置き換えます。</p>
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
              {scope !== 'episode' &&
                targets.length > 0 &&
                targets.every(accepted) &&
                !targets.some(latest) && (
                  <>
                    <Button
                      variant="outline"
                      className="narration-wide"
                      onClick={() => void act(() => play(targets, 'accepted'))}
                    >
                      選択部分を聴く
                    </Button>
                    {playing?.label === '採用中の読み' && player}
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
                        (!entitlement?.preview?.remaining ||
                          !opening.length ||
                          running.length > 0 ||
                          readingReview.some(
                            (c) =>
                              !c.refs.length ||
                              c.refs.some((r) => opening.some((s) => s.blockId === r.blockId)),
                          )))
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
            {scope === 'episode' && playing?.label === 'スタイル試聴' && player}
            <div className="narration-generate">
              {scope === 'episode' && segments.length > 0 && (
                <Button
                  className="narration-wide"
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
                    : !record.snapshots?.[episode.id] && missing.length
                      ? '一話を生成'
                      : '一話を再生成'}
                </Button>
              )}

              {scope === 'episode' && (
                <p className="narration-cost">
                  今回の消費{' '}
                  <strong>
                    {cost(
                      !record.snapshots?.[episode.id] && missing.length ? pending : segments,
                    ).toLocaleString()}
                    文字
                  </strong>
                  {entitlement && <> / 残り {entitlement.remaining.toLocaleString()}文字</>}
                </p>
              )}
            </div>
          </section>
          {record.takes.some(
            (t) =>
              t.state === 'ready' &&
              t.segmentId.startsWith(episode.id + ':') &&
              !segments.some((s) => s.id === t.segmentId),
          ) && (
            <details>
              <summary>以前の生成音声</summary>
              {playing?.label === '以前の音声' && player}
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
          {scope === 'episode' && settings.dictionary.length > 0 && (
            <details className="narration-dictionary">
              <summary>この作品で使う読み</summary>
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
            </details>
          )}
          {readingReview.length > 0 && (
            <details className="narration-reading-review" open>
              <summary>範囲を確認する読み（{readingReview.length}件）</summary>
              <p className="narration-help">
                以前の読み指定が複数の文にまたがっています。対象の文を選んで読みを指定し直し、以前の指定を外してください。確認が終わるまで、その文は生成できません。
              </p>
              {readingReview.map((c) => (
                <div key={c.id} className="narration-saved-cue">
                  <span>{c.refs.map((r) => r.snapshot.slice(r.start, r.end)).join(' / ')}</span>
                  <span>読み：{c.reading}</span>
                  <button
                    type="button"
                    onClick={() =>
                      patchSettings({ cues: settings.cues.filter((v) => v.id !== c.id) })
                    }
                  >
                    以前の読み指定を外す
                  </button>
                </div>
              ))}
            </details>
          )}
          <details hidden={!detachedCues.length}>
            <summary>本文から開けない指示（{detachedCues.length}件）</summary>
            {detachedCues.map((c) => (
              <div className="narration-saved-cue" key={c.id}>
                <button type="button" onClick={() => openCue(c)}>
                  {c.scope === 'episode' ? 'この話全体' : c.refs[0]?.snapshot.slice(0, 50)}
                  <span>
                    {[
                      c.direction,
                      c.reading && '読み：' + c.reading,
                      c.voiceId && '声：' + c.voiceId,
                    ]
                      .filter(Boolean)
                      .join(' / ') || '読み・声・間の指定'}
                  </span>
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
        <div className="narration-player narration-full-player">
          <NarrationPlayer
            audioRef={fullAudio}
            url={fullPlayback?.url}
            label="一話の読み"
            position={fullPosition}
            onPosition={setFullPosition}
            transport
            disabled={
              busy ||
              !(record.snapshots?.[episode.id] ?? segments).length ||
              !(record.snapshots?.[episode.id] ?? segments).every(accepted)
            }
            onRequestPlay={() => void act(loadFullPlayback)}
            onStart={() => {
              audio.current?.pause()
              setActivePlayer('full')
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!fullPlayback}
            onClick={() => {
              const index =
                fullPlayback?.timeline.findIndex(
                  (t) => fullPosition >= t.start && fullPosition < t.end,
                ) ?? -1
              const part =
                fullPlayback?.segments[index < 0 ? fullPlayback.segments.length - 1 : index]
              if (part) {
                select(part.id, true)
                setMobilePanel('inspector')
              }
            }}
          >
            ここを直す
          </Button>
        </div>
        <div className="narration-footer-status">
          <span role="status">
            {running.length
              ? '音声を生成中'
              : targets.some(latest)
                ? '修正候補を比較できます'
                : pending.length
                  ? '未生成・変更あり ' + pending.length + '文'
                  : missing.length || changed.length
                    ? '試聴して読みを採用'
                    : '書き出せます'}
          </span>
          <span>
            {entitlement && (
              <>
                使用 {entitlement.used.toLocaleString()} / {entitlement.limit.toLocaleString()}文字
              </>
            )}
          </span>
        </div>
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

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
  const [scope, setScope] = useState<VoiceCue['scope']>('episode')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
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
      <main className="narration-studio">
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
    consent &&
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
    setScope('range')
    if (window.innerWidth <= 850)
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
  const saveLabel = saving ? '保存中…' : 'この端末に保存済み'
  const targetLabel =
    scope === 'episode'
      ? 'この話全体'
      : scope === 'scene'
        ? `この場面（${targets.length}段落）`
        : `選んだ${targets.length}段落`
  const voices = entitlement?.voices ?? []
  const invalid = settings.cues.filter((c) => c.episodeId === episode.id && !cueIsValid(c, episode))
  return (
    <main className="narration-studio">
      <header className="narration-header">
        <a href="#/write" className="narration-back">
          <ArrowLeft size={17} />
          執筆へ
        </a>
        <div className="narration-title">
          <p>{work.title}</p>
          <h1>
            <Headphones size={25} />
            朗読制作
          </h1>
        </div>
        <span className="narration-save" role="status">
          {saveLabel}
        </span>
      </header>
      <section className="narration-quota" aria-label="利用枠">
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
            <div>
              <span className="narration-eyebrow">原稿</span>
              <h2>{episode.title}</h2>
            </div>
            <label>
              話を選ぶ
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
                setScope('episode')
              }}
            >
              この話全体
            </Button>
            <span>段落を選ぶと、その箇所の読み方を変えられます。</span>
          </div>
          <p className="narration-help">
            複数の段落は Shift を押しながら選択。スマートフォンでは「ここまで選ぶ」を使えます。
          </p>
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
                    onClick={(e) => select(segment.blockId, e.shiftKey)}
                  >
                    <span className="narration-line-number">{String(i + 1).padStart(2, '0')}</span>
                    <span className="narration-prose">{plainText(segment.source.inlines)}</span>
                  </button>
                  <div className="narration-paragraph-meta">
                    <span>{status}</span>
                    {lastAttempt?.error && <span role="status">{lastAttempt.error}</span>}
                    {instructions.some((c) => c.direction) && (
                      <span className="narration-tag">演技の指定あり</span>
                    )}
                    {instructions.some((c) => c.reading) && (
                      <span className="narration-tag">読みの指定あり</span>
                    )}
                    {active && (
                      <>
                        <button type="button" onClick={() => selectScene(segment.blockId)}>
                          場面を選ぶ
                        </button>
                        <button type="button" onClick={() => select(segment.blockId, true)}>
                          ここまで選ぶ
                        </button>
                      </>
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
          <section>
            <span className="narration-eyebrow">作品の基調 · 全話共通</span>
            <h2>声と朗読スタイル</h2>
            <p className="narration-help">
              この作品の全話に使う設定です。話や段落に保存した指定を優先します。
            </p>
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
                  <span>{style.description}</span>
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
          <section className="narration-direction">
            <span className="narration-eyebrow">読み方を指定</span>
            <h2>{targetLabel}</h2>
            <button
              type="button"
              className="narration-return"
              onClick={() =>
                document
                  .querySelector('.narration-paragraph.is-selected')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            >
              原稿の選択箇所へ戻る
            </button>
            <blockquote>
              {targets
                .map((s) => plainText(s.source.inlines))
                .join(' ')
                .slice(0, 160)}
              {cost(targets) > 160 ? '…' : ''}
            </blockquote>
            <label>
              どんなふうに読んでほしいですか？
              <textarea
                rows={4}
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
            <p className="narration-help">
              {matchingCue
                ? 'この範囲の指示を自動保存します。'
                : '指定しない箇所は、上位の指示と朗読スタイルを引き継ぎます。'}{' '}
              演技は生成結果を聴いて確かめられます。
            </p>
            {targets[0] && (
              <p className="narration-inherited">
                現在の指示：{targets[0].direction || '指示なし'}
                {targets.some((s) => s.direction !== targets[0]?.direction)
                  ? '（範囲内に別の指定があります）'
                  : ''}
              </p>
            )}
            {matchingCue && (
              <button
                type="button"
                className="narration-text-button"
                onClick={() =>
                  patchSettings({ cues: settings.cues.filter((c) => c.id !== matchingCue.id) })
                }
              >
                この範囲の指定を外して、上位の設定に戻す
              </button>
            )}
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
            <div className="narration-trial">
              <Button
                className="narration-wide"
                disabled={!readyToGenerate(targets) || busy}
                onClick={() => void act(() => service.generate(targets, true))}
              >
                この範囲を試す · {cost(targets).toLocaleString()}文字
              </Button>
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
            </div>
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
          <details className="narration-dictionary">
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
          <details>
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
        {!consent && (
          <label className="narration-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked)
                localStorage.setItem('ns-narration-consent', e.target.checked ? '1' : '0')
              }}
            />
            生成する原稿・読み・演技指示をFish Audioに送信します。生成済み音声は端末にも保存します。
          </label>
        )}
        {running.length > 0 && (
          <div className="narration-progress" role="status">
            生成中：残り {running.length}区間。画面を離れても処理は続きます。
            {[...new Set(running.map((t) => t.jobId))].map((id) => (
              <button type="button" key={id} onClick={() => void act(() => service.cancel(id))}>
                未着手の区間を止める
              </button>
            ))}
            <small>生成を開始した区間は完了まで処理し、成功分の文字数を消費します。</small>
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
              {missing.length
                ? '未採用 ' + missing.length + '区間'
                : changed.length
                  ? '変更あり ' + changed.length + '区間'
                  : '一話の音声が揃いました'}
            </strong>
            <p>今回の生成：{cost(pending).toLocaleString()}文字 · 再生・書き出しは消費なし</p>
          </div>
          <Button
            disabled={!readyToGenerate(pending) || busy}
            onClick={() => void act(() => service.generate(pending))}
          >
            {sending ? '生成を開始中…' : '未生成・変更ありを生成'}
          </Button>
          <Button
            variant="outline"
            disabled={busy || segments.some((s) => !latest(s) && !accepted(s))}
            onClick={() => void act(() => play(segments, 'candidate'))}
          >
            <Play size={15} />
            通して聴く
          </Button>
          {(missing.length > 0 || changed.length > 0) &&
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
          <Button
            variant="outline"
            disabled={busy || !!missing.length || !!changed.length}
            onClick={() => void act(() => exportEpisodes([episode.id]))}
          >
            <Download size={15} />
            MP3を書き出す
          </Button>
        </div>
        {entitlement && cost(pending) > entitlement.remaining && (
          <p className="narration-help">
            一話分の文字枠が足りません。原稿から短い範囲を選ぶと試せます。
          </p>
        )}
        <details>
          <summary>複数話をZIPで書き出す</summary>
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
        </details>
        <p className="narration-help">
          音声のサーバー保管は生成から7日間です。採用・試聴した音声はこの端末にも保存します。端末のデータ削除に備えてMP3を書き出してください。
        </p>
      </footer>
    </main>
  )
}

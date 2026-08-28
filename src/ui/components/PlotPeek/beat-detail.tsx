import { ArrowRight, Lock, StickyNote } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  beatsInStoryOrder,
  foreshadowsOfBeat,
  linesOfBeat,
  type Plot,
  type PlotBeat,
  secretsHiddenAt,
  sectionOfBeat,
} from '@/core/plot'
import type { Episode, GlossaryEntry } from '@/core/schema'
import { NotationText } from '@/ui/components/NotationField/notation-text'
import { fmtCount, lineColorOf, STATUS_UI } from '@/ui/plot/beat-ui'

interface BeatDetailProps {
  plot: Plot
  beat: PlotBeat
  /** 用語集（視点・登場人物・舞台の解決先）。 */
  glossary: GlossaryEntry[]
  /** 本文の話一覧（対応する話の名前を出す）。 */
  episodes: Episode[]
  /** 種になったネタ帳メモの中身（読み込み済み。未設定・見つからないときは null）。 */
  ideaText: string | null
  /** 用語集に居る語の集合（要約・メモのプレビューで解決/未解決を描き分ける）。 */
  resolvedNames: Set<string>
  /** 用語をクリックしたときの通知（用語集パネルで開く）。 */
  onRefClick?: (name: string) => void
  /** 状態チップのクリック（検討中→確定→執筆中→済）。 */
  onCycleStatus: () => void
  /** プロット画面の該当ビートへ移動する。 */
  onJump: () => void
}

/**
 * ビート 1 件の全内容（読み取り専用）。本文エディタの「この話のプロット」パネルから開く。
 *
 * プロット画面の詳細パネルが編集用に持っている欄を、書く手を止めずに読める形へ並べ替えたもの。
 * 幕・要約・人物と舞台・メモ・プロットライン・伏線・秘密・進捗・ネタ帳まで、そのビートに
 * 紐づくものを一度に見せる（プロット画面へ往復しないための器なので、欠けがあると意味がない）。
 * 空の欄は出さない（「まだ書かれていません。」を出すのは要約の 1 か所だけにして、
 * 同じ意味の空案内が画面に重ならないようにする）。書き足すときはフッターからプロット画面へ渡す。
 */
export function BeatDetail({
  plot,
  beat,
  glossary,
  episodes,
  ideaText,
  resolvedNames,
  onRefClick,
  onCycleStatus,
  onJump,
}: BeatDetailProps) {
  const section = sectionOfBeat(plot, beat.id)
  const order = beatsInStoryOrder(plot)
  const position = order.findIndex((b) => b.id === beat.id)
  // 画面は 1 ビート＝1 ライン／1 舞台の運用だが、MCP からは配列で書ける。
  // ここは読む場所なので、入っているものは全部出す（2 件目以降を黙って隠さない）。
  const lines = linesOfBeat(plot, beat)
  const pov = beat.povRef ? refOf(beat.povRef, glossary) : undefined
  const cast = beat.castRefs.map((id) => refOf(id, glossary))
  const places = beat.placeRefs.map((id) => refOf(id, glossary))
  const episode = beat.episodeRef ? episodes.find((e) => e.id === beat.episodeRef) : undefined
  const foreshadows = foreshadowsOfBeat(plot, beat.id)
  const revealedHere = plot.secrets.filter((s) => s.revealBeatId === beat.id)
  const stillHidden = secretsHiddenAt(plot, beat.id)
  const status = STATUS_UI[beat.status]

  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      <div className="flex flex-col gap-1.5">
        {section || position >= 0 ? (
          <p className="text-[10.5px] text-on-surface-variant/70">
            {[section?.title, position >= 0 ? `物語順 ${position + 1}／${order.length}` : null]
              .filter(Boolean)
              .join(' ・ ')}
          </p>
        ) : null}
        <h3 className="break-words font-medium font-serif text-[15px] text-on-surface leading-snug">
          {beat.title || '無題のビート'}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onCycleStatus}
            title="クリックで状態を切替（検討中→確定→執筆中→済）"
            className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10.5px] transition-colors ${status.className}`}
          >
            {status.label}
          </button>
          {lines.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 text-[10.5px] text-on-surface"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ background: lineColorOf(plot, l.id) }}
              />
              {l.title}
            </span>
          ))}
        </div>
        {lines.map((l) =>
          l.note ? (
            <p key={l.id} className="text-[11px] text-on-surface-variant/70 leading-relaxed">
              {l.note}
            </p>
          ) : null,
        )}
      </div>

      <Block label="要約（何が起きるか）">
        {beat.summary ? (
          <NotationText
            text={beat.summary}
            resolvedNames={resolvedNames}
            onRefClick={onRefClick}
            className="text-[12.5px] text-on-surface leading-relaxed"
          />
        ) : beat.guide ? null : (
          <p className="text-[12px] text-on-surface-variant/60">まだ書かれていません。</p>
        )}
        {/* テンプレートのガイド文は、要約を書くと他の画面から読めなくなる（placeholder 扱いのため）。
            読む場所であるここでは、書いたあとも並べて残す。 */}
        {beat.guide ? (
          <p className="text-[11.5px] text-on-surface-variant/60 leading-relaxed">
            テンプレートの目安：{beat.guide}
          </p>
        ) : null}
      </Block>

      {pov || cast.length > 0 || places.length > 0 || beat.timeLabel ? (
        <div className="flex flex-col gap-2.5">
          {pov ? (
            <Block label="視点（だれの目で書くか）">
              <div className="flex flex-wrap gap-1.5">
                <EntryChip item={pov} onRefClick={onRefClick} />
              </div>
            </Block>
          ) : null}
          {cast.length > 0 ? (
            <Block label="登場する人物">
              <div className="flex flex-wrap gap-1.5">
                {cast.map((item) => (
                  <EntryChip key={item.id} item={item} onRefClick={onRefClick} />
                ))}
              </div>
            </Block>
          ) : null}
          {places.length > 0 ? (
            <Block label="舞台（場所）">
              <div className="flex flex-wrap gap-1.5">
                {places.map((item) => (
                  <EntryChip key={item.id} item={item} onRefClick={onRefClick} />
                ))}
              </div>
            </Block>
          ) : null}
          {beat.timeLabel ? (
            <Block label="作中時間">
              <p className="text-[12.5px] text-on-surface">{beat.timeLabel}</p>
            </Block>
          ) : null}
        </div>
      ) : null}

      {beat.note ? (
        <Block label="メモ">
          <NotationText
            text={beat.note}
            resolvedNames={resolvedNames}
            onRefClick={onRefClick}
            className="text-[12.5px] text-on-surface leading-relaxed"
          />
        </Block>
      ) : null}

      {foreshadows.length > 0 ? (
        <Block label="伏線">
          <ul className="flex flex-col gap-1.5">
            {foreshadows.map((f) => {
              const plantsHere = f.plantBeatId === beat.id
              // 相方（張る側から見た回収先／回収側から見た張り場所）まで出す＝
              // この伏線がどこへ繋がるのかをパネルの中だけで確かめられる。
              const otherId = plantsHere ? f.payoffBeatId : f.plantBeatId
              const other = otherId ? plot.beats.find((b) => b.id === otherId) : undefined
              return (
                <li
                  key={f.id}
                  className="rounded-md bg-surface-container-high px-2.5 py-2 text-[11.5px] text-on-surface leading-relaxed"
                >
                  <span className="font-medium">
                    {plantsHere ? '張る' : '回収'}: {f.title}
                  </span>
                  <span className="ml-1.5 text-[11px] text-on-surface-variant/70">
                    {plantsHere
                      ? other
                        ? `回収は「${other.title || '無題のビート'}」`
                        : '回収先は未設定'
                      : other
                        ? `張るのは「${other.title || '無題のビート'}」`
                        : '張る場所は未設定'}
                  </span>
                  {f.note ? (
                    <p className="mt-0.5 text-[11px] text-on-surface-variant">{f.note}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </Block>
      ) : null}

      {revealedHere.length > 0 || stillHidden.length > 0 ? (
        <Block label="秘密（読者に伏せる情報）">
          {revealedHere.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {revealedHere.map((s) => (
                <li
                  key={s.id}
                  className="rounded-md bg-primary/8 px-2.5 py-2 text-[11.5px] leading-relaxed"
                >
                  <span className="font-medium text-primary">ここで明かす: {s.title}</span>
                  {s.truth ? (
                    <p className="mt-0.5 flex items-start gap-1 text-[11px] text-on-surface-variant">
                      <Lock className="mt-0.5 size-2.5 shrink-0" aria-hidden />
                      <span>{s.truth}</span>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {stillHidden.length > 0 ? (
            <p className="text-[11px] text-on-surface-variant/70 leading-relaxed">
              この時点で読者が知らないこと：{stillHidden.map((s) => s.title).join('、')}
            </p>
          ) : null}
        </Block>
      ) : null}

      {beat.targetLength || episode ? (
        <div className="flex flex-col gap-2.5">
          {beat.targetLength ? (
            <Block label="予定字数">
              <p className="text-[12.5px] text-on-surface tabular-nums">
                {fmtCount(beat.targetLength)}字
              </p>
            </Block>
          ) : null}
          {episode ? (
            <Block label="対応する話">
              <p className="text-[12.5px] text-on-surface">{episode.title || '無題の話'}</p>
            </Block>
          ) : null}
        </div>
      ) : null}

      {ideaText !== null ? (
        <Block label="ネタ帳のメモ">
          <p className="flex items-start gap-1.5 whitespace-pre-wrap rounded-md bg-surface-container-high px-2.5 py-2 text-[11.5px] text-on-surface-variant leading-relaxed">
            <StickyNote className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>{ideaText}</span>
          </p>
        </Block>
      ) : null}

      <div className="border-outline-variant/30 border-t pt-2.5">
        <button
          type="button"
          onClick={onJump}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-primary transition-colors hover:bg-surface-container-high"
        >
          プロット画面で開く
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}

/** 用語集参照 1 件の解決結果（消えた項目も id を残す＝黙って欄ごと消さない）。 */
interface EntryRef {
  id: string
  entry: GlossaryEntry | undefined
}

function refOf(id: string, glossary: GlossaryEntry[]): EntryRef {
  return { id, entry: glossary.find((g) => g.id === id) }
}

/** 見出し＋中身の 1 かたまり（プロット画面の Field と同じ見た目・こちらは読むだけ）。 */
function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-[10.5px] text-on-surface-variant/70 tracking-wide">
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * 用語集の項目チップ。押すと用語集パネルでその項目が開く（本文の [[用語]] クリックと同じ導線）。
 * onRefClick が無い場面ではただの表示に落とす。
 */
function EntryChip({ item, onRefClick }: { item: EntryRef; onRefClick?: (name: string) => void }) {
  const className =
    'inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground'
  const entry = item.entry
  // 用語集から消えた項目は名前を引けない。空にすると「登場人物が減った」ように見えるので、
  // 用語集画面のチップと同じ「（削除済み）」で場所を残す。
  if (!entry) {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] text-on-surface-variant/70">
        （削除済み）
      </span>
    )
  }
  if (!onRefClick) return <span className={className}>{entry.name}</span>
  return (
    <button
      type="button"
      onClick={() => onRefClick(entry.name)}
      title={entry.summary}
      className={`${className} transition-colors hover:bg-primary hover:text-white`}
    >
      {entry.name}
    </button>
  )
}

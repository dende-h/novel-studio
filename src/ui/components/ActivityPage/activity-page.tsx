import { ArrowLeft, CalendarDays, Flame, PenLine, Sigma } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  buildHeatmap,
  type DailyActivity,
  type HeatCell,
  localDateKey,
  summarize,
} from '@/core/activity'
import type { ActivityRepository } from '@/core/storage/activityRepository'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/ui/button'

/** 表示する週数（およそ半年）。 */
const WEEKS = 26

/** 草の濃さ（level 0〜4）→ 背景色。primary を緑の代わりに使い、アプリの色と馴染ませる。 */
const LEVEL_BG: Record<HeatCell['level'], string> = {
  0: 'bg-surface-container-highest',
  1: 'bg-primary/25',
  2: 'bg-primary/45',
  3: 'bg-primary/70',
  4: 'bg-primary',
}

const fmtDate = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })

interface ActivityPageProps {
  repo: ActivityRepository
  onExit: () => void
}

/**
 * 執筆活動ダッシュボード（純ローカル・無料）。日別の文字数増減から
 * 連続執筆日数（ストリーク）・GitHub 風の草（ヒートマップ）・通算をまとめて表示し、
 * 継続のモチベーションにする。
 */
export function ActivityPage({ repo, onExit }: ActivityPageProps) {
  const [days, setDays] = useState<DailyActivity[] | null>(null)

  useEffect(() => {
    void repo.list().then(setDays)
  }, [repo])

  const today = localDateKey(Date.now())
  const summary = useMemo(() => summarize(days ?? [], today), [days, today])
  const heatmap = useMemo(() => {
    const net = new Map((days ?? []).map((d) => [d.date, d.net]))
    return buildHeatmap(net, today, WEEKS)
  }, [days, today])

  return (
    <div className="min-h-screen bg-surface px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onExit} aria-label="戻る">
            <ArrowLeft className="size-5" />
          </Button>
          <h1 className="font-serif text-2xl text-primary">執筆の記録</h1>
        </header>

        {/* サマリのカード群 */}
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={<Flame className="size-5 text-orange-500" />}
            label="連続執筆日数"
            value={`${summary.streak}`}
            unit="日"
            hint={summary.streak > 0 ? '継続中！' : '今日から始めよう'}
          />
          <StatCard
            icon={<PenLine className="size-5 text-primary" />}
            label="今日書いた文字"
            value={summary.today.toLocaleString('ja-JP')}
            unit="字"
          />
          <StatCard
            icon={<CalendarDays className="size-5 text-primary" />}
            label="活動した日数"
            value={`${summary.activeDays}`}
            unit="日"
            hint={`最長 ${summary.longest} 日連続`}
          />
          <StatCard
            icon={<Sigma className="size-5 text-primary" />}
            label="通算の増減"
            value={summary.totalNet.toLocaleString('ja-JP')}
            unit="字"
          />
        </div>

        {/* 草（ヒートマップ） */}
        <section className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-4 lg:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-sans font-semibold text-on-surface text-sm">この半年の執筆</h2>
            <Legend />
          </div>

          {days === null ? (
            <p className="py-8 text-center text-on-surface-variant text-sm">読み込み中…</p>
          ) : (
            <div className="overflow-x-auto pb-1">
              <div className="flex gap-1">
                {heatmap.map((week) => (
                  <div key={week[0]?.date} className="flex flex-col gap-1">
                    {week.map((cell) => (
                      <div
                        key={cell.date}
                        title={
                          cell.future
                            ? undefined
                            : `${fmtDate(cell.date)}：${cell.chars > 0 ? '+' : ''}${cell.chars.toLocaleString('ja-JP')}字`
                        }
                        className={cn(
                          'size-3 rounded-[3px] lg:size-3.5',
                          cell.future ? 'bg-transparent' : LEVEL_BG[cell.level],
                          cell.date === today && 'ring-2 ring-primary ring-offset-1',
                        )}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {days !== null && summary.activeDays === 0 && (
            <p className="mt-4 text-center text-on-surface-variant text-sm">
              まだ記録がありません。エディタで書いて保存すると、ここに草が生えます 🌱
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  unit,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
      <div className="mb-1 flex items-center gap-2">
        {icon}
        <span className="font-sans text-on-surface-variant text-xs">{label}</span>
      </div>
      <div className="font-serif text-on-surface">
        <span className="text-2xl">{value}</span>
        <span className="ml-1 text-on-surface-variant text-sm">{unit}</span>
      </div>
      {hint && <p className="mt-0.5 text-on-surface-variant text-xs">{hint}</p>}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-1 text-on-surface-variant text-xs">
      <span>少</span>
      {([0, 1, 2, 3, 4] as const).map((lv) => (
        <span key={lv} className={cn('size-3 rounded-[3px]', LEVEL_BG[lv])} />
      ))}
      <span>多</span>
    </div>
  )
}

import { CalendarDays, Flame, PenLine, Sigma } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  availableYears,
  buildYear,
  type DailyActivity,
  type HeatCell,
  localDateKey,
  monthLabels,
  summarize,
} from '@/core/activity'
import type { ActivityRepository } from '@/core/storage/activityRepository'
import { cn } from '@/lib/utils'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { SideNav } from '@/ui/components/SideNav/side-nav'

/** 草の濃さ（level 0〜4）→ 緑。GitHub と同じく淡→濃で表す。 */
const LEVEL_BG: Record<HeatCell['level'], string> = {
  0: 'bg-surface-container-highest',
  1: 'bg-green-200',
  2: 'bg-green-400',
  3: 'bg-green-600',
  4: 'bg-green-800',
}

/** 曜日ラベル（日本語）。GitHub と同じく月・水・金だけ表示（0=日）。 */
const WEEKDAY_LABEL: Record<number, string> = { 1: '月', 3: '水', 5: '金' }

const fmtDate = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })

interface ActivityPageProps {
  repo: ActivityRepository
  /** ライブラリ（コレクション）へ戻る。左サイドバー／ブランドから使う。 */
  onNavigateCollection: () => void
}

/**
 * 執筆活動ダッシュボード（純ローカル・無料）。ライブラリ／エディタと同じ AppShell＋左サイドバーの
 * 上で、連続執筆日数（ストリーク）・GitHub 風の草（緑ヒートマップ・年切り替え）・通算をまとめて表示する。
 */
export function ActivityPage({ repo, onNavigateCollection }: ActivityPageProps) {
  const [days, setDays] = useState<DailyActivity[] | null>(null)
  const today = localDateKey(Date.now())
  const currentYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(currentYear)

  useEffect(() => {
    void repo.list().then(setDays)
  }, [repo])

  const summary = useMemo(() => summarize(days ?? [], today), [days, today])
  const years = useMemo(() => availableYears(days ?? [], currentYear), [days, currentYear])
  const netByDate = useMemo(() => new Map((days ?? []).map((d) => [d.date, d.net])), [days])
  const heatmap = useMemo(() => buildYear(netByDate, year, today), [netByDate, year, today])
  const labels = useMemo(() => monthLabels(heatmap), [heatmap])

  const yearStat = useMemo(() => {
    const inYear = (days ?? []).filter((d) => d.date.startsWith(`${year}-`))
    return {
      activeDays: inYear.filter((d) => d.net !== 0 || d.saves > 0).length,
      net: inYear.reduce((n, d) => n + d.net, 0),
    }
  }, [days, year])

  return (
    <AppShell
      onBrandClick={onNavigateCollection}
      sidebar={
        <SideNav
          projectTitle="novel-studio"
          projectSubtitle="執筆の記録"
          active="activity"
          onNavigateCollection={onNavigateCollection}
          onNavigateActivity={() => {}}
        />
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-10 md:px-16">
        <div className="mx-auto max-w-6xl pb-16">
          <header className="mb-8">
            <h1 className="font-serif text-2xl text-primary">執筆の記録</h1>
            <p className="mt-1 text-on-surface-variant text-sm">
              毎日の執筆量とつづけた日数を記録します。
            </p>
          </header>

          {/* サマリのカード群（通算・全期間） */}
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

          {/* 草（年カレンダー） */}
          <section className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-4 lg:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="font-sans text-on-surface text-sm">
                <strong>{year}年</strong>は {yearStat.activeDays}日 書きました
                <span className="text-on-surface-variant">
                  （{yearStat.net.toLocaleString('ja-JP')}字）
                </span>
              </p>
              {/* 年タブ（横並び・右寄せ）。選択中は白文字でコントラストを確保。 */}
              <nav className="flex flex-wrap gap-1.5">
                {years.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setYear(y)}
                    className={cn(
                      'rounded-md px-3 py-1 font-sans text-sm transition-colors',
                      y === year
                        ? 'bg-primary text-white'
                        : 'text-on-surface-variant hover:bg-surface-container-high',
                    )}
                  >
                    {y}
                  </button>
                ))}
              </nav>
            </div>

            {days === null ? (
              <p className="py-8 text-center text-on-surface-variant text-sm">読み込み中…</p>
            ) : (
              <div className="overflow-x-auto pb-1">
                <div className="inline-block">
                  {/* 月ラベル（週列に合わせて配置） */}
                  <div className="mb-1 flex gap-1 pl-7 text-on-surface-variant text-xs">
                    {labels.map((m, w) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: 週の並びは固定
                        key={w}
                        className="w-3"
                      >
                        <span className="block whitespace-nowrap">{m ? `${m}月` : ''}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-1">
                    {/* 曜日ラベル（月・水・金） */}
                    <div className="flex w-7 flex-col gap-1 pr-1 text-on-surface-variant text-[10px]">
                      {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                        <div key={d} className="flex h-3 items-center">
                          {WEEKDAY_LABEL[d] ?? ''}
                        </div>
                      ))}
                    </div>

                    {/* 週列 */}
                    {heatmap.map((week) => (
                      <div key={week[0]?.date} className="flex flex-col gap-1">
                        {week.map((cell) => (
                          <div
                            key={cell.date}
                            title={
                              cell.future || cell.outOfRange
                                ? undefined
                                : `${fmtDate(cell.date)}：${cell.chars > 0 ? '+' : ''}${cell.chars.toLocaleString('ja-JP')}字`
                            }
                            className={cn(
                              'size-3 rounded-[3px]',
                              cell.future || cell.outOfRange
                                ? 'bg-transparent'
                                : LEVEL_BG[cell.level],
                              cell.date === today && 'ring-1 ring-on-surface/40',
                            )}
                          />
                        ))}
                      </div>
                    ))}
                  </div>

                  <Legend />
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
    </AppShell>
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
    <div className="mt-3 flex items-center justify-end gap-1 text-on-surface-variant text-xs">
      <span>少</span>
      {([0, 1, 2, 3, 4] as const).map((lv) => (
        <span key={lv} className={cn('size-3 rounded-[3px]', LEVEL_BG[lv])} />
      ))}
      <span>多</span>
    </div>
  )
}

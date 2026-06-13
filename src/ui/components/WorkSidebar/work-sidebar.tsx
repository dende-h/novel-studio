interface ListItem {
  id: string
  title: string
}

interface WorkSidebarProps {
  workList: ListItem[]
  currentWorkId: string | null
  episodes: ListItem[]
  currentEpisodeId: string | null
  onSelectWork: (id: string) => void
  onSelectEpisode: (id: string) => void
  onNewWork: () => void
  onNewEpisode: () => void
}

/** 作品／話のナビゲーション（Presentational・Props のみ）。 */
export function WorkSidebar({
  workList,
  currentWorkId,
  episodes,
  currentEpisodeId,
  onSelectWork,
  onSelectEpisode,
  onNewWork,
  onNewEpisode,
}: WorkSidebarProps) {
  return (
    <nav className="flex h-full w-56 flex-col gap-2 border-neutral-200 border-r p-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-neutral-500 text-xs">作品</span>
        <button type="button" onClick={onNewWork} className="rounded px-2 py-0.5 hover:bg-neutral-100">
          新規作品
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {workList.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => onSelectWork(w.id)}
              aria-current={w.id === currentWorkId}
              className={`w-full truncate rounded px-2 py-1 text-left hover:bg-neutral-100 ${
                w.id === currentWorkId ? 'bg-neutral-100 font-medium' : ''
              }`}
            >
              {w.title}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex items-center justify-between">
        <span className="font-semibold text-neutral-500 text-xs">話</span>
        <button
          type="button"
          onClick={onNewEpisode}
          disabled={!currentWorkId}
          className="rounded px-2 py-0.5 hover:bg-neutral-100 disabled:opacity-40"
        >
          新規話
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {episodes.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onSelectEpisode(e.id)}
              aria-current={e.id === currentEpisodeId}
              className={`w-full truncate rounded px-2 py-1 text-left hover:bg-neutral-100 ${
                e.id === currentEpisodeId ? 'bg-neutral-100 font-medium' : ''
              }`}
            >
              {e.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

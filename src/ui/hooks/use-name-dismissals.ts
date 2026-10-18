import { useCallback, useEffect, useRef, useState } from 'react'
import type { NameDismissals } from '@/core/proofread/name-dismissals'
import { subscribeSyncApplied } from '@/ui/sync/sync-touch'

/** 外した語の読み書きに使う repo の口（NameDismissalRepository を withSyncTouch で包んだもの）。 */
export interface NameDismissalRepo {
  get(workId: string): Promise<NameDismissals | undefined>
  save(record: NameDismissals): Promise<void>
}

/**
 * 推敲画面で候補から外した語（COT-59）。作品が変わったら読み直し、同期の取り込み（sync-applied）でも読み直す。
 * 保存は画面の値を先に替えてから repo へ書く（「外す」をすぐ一覧に効かせる）。
 * 読めない（壊れた）記録は repo が undefined を返すので、外した語なしとして一覧を出す。
 */
export function useNameDismissals(
  repo: NameDismissalRepo | undefined,
  workId: string | undefined,
): {
  record: NameDismissals | undefined
  save: (next: NameDismissals) => Promise<void>
} {
  const [state, setState] = useState<{ workId: string; record: NameDismissals | undefined } | null>(
    null,
  )
  const workRef = useRef(workId)
  workRef.current = workId

  const load = useCallback(() => {
    if (!repo || !workId) return
    void repo.get(workId).then(
      (record) => {
        if (workRef.current === workId) setState({ workId, record })
      },
      () => {
        if (workRef.current === workId) setState({ workId, record: undefined })
      },
    )
  }, [repo, workId])

  useEffect(() => {
    load()
    return subscribeSyncApplied(load)
  }, [load])

  const save = useCallback(
    async (next: NameDismissals) => {
      if (workRef.current === next.workId) setState({ workId: next.workId, record: next })
      await repo?.save(next)
    },
    [repo],
  )

  return { record: state && state.workId === workId ? state.record : undefined, save }
}

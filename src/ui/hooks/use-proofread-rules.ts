import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProofreadRules } from '@/core/proofread/work-rules'
import { subscribeSyncApplied } from '@/ui/sync/sync-touch'

/** 決まりの読み書きに使う repo の口（ProofreadRulesRepository を withSyncTouch で包んだもの）。 */
export interface ProofreadRulesRepo {
  get(workId: string): Promise<ProofreadRules | undefined>
  save(record: ProofreadRules): Promise<void>
}

/**
 * 推敲の作品の決まり（COT-62・例外・表記の好み・提案しない言葉）。作品が変わったら読み直し、同期の取り込み（sync-applied）でも読み直す。
 * 保存は画面の値を先に替えてから repo へ書く（決まりをすぐ指摘に効かせる）。
 * 読めない（壊れた）記録は repo が undefined を返すので、決まりなしとして指摘を出す。
 */
export function useProofreadRules(
  repo: ProofreadRulesRepo | undefined,
  workId: string | undefined,
): {
  record: ProofreadRules | undefined
  save: (next: ProofreadRules) => Promise<void>
} {
  const [state, setState] = useState<{ workId: string; record: ProofreadRules | undefined } | null>(
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
    async (next: ProofreadRules) => {
      if (workRef.current === next.workId) setState({ workId: next.workId, record: next })
      await repo?.save(next)
    },
    [repo],
  )

  return { record: state && state.workId === workId ? state.record : undefined, save }
}

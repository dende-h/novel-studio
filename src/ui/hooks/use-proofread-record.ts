import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProofreadRecord } from '@/core/proofread/decisions'
import { subscribeSyncApplied } from '@/ui/sync/sync-touch'

/** 判断の読み書きに使う repo の口（ProofreadRepository を withSyncTouch で包んだもの）。 */
export interface ProofreadRecordRepo {
  get(workId: string, episodeId: string): Promise<ProofreadRecord | undefined>
  save(record: ProofreadRecord): Promise<void>
  /** 作品の全話の判断（COT-62・決まりの提案の回数を数える）。無ければ提案を出さない。 */
  listByWork?(workId: string): Promise<ProofreadRecord[]>
}

/**
 * 1 話ぶんの推敲の判断（COT-40）。話が変わったら読み直し、同期の取り込み（sync-applied）でも読み直す。
 * 保存は画面の値を先に替えてから repo へ書く（判断のボタンをすぐ反映させる）。
 */
export function useProofreadRecord(
  repo: ProofreadRecordRepo | undefined,
  workId: string | undefined,
  episodeId: string | undefined,
): {
  record: ProofreadRecord | undefined
  loaded: boolean
  save: (next: ProofreadRecord) => Promise<void>
} {
  const [state, setState] = useState<{ key: string; record: ProofreadRecord | undefined } | null>(
    null,
  )
  const key = workId && episodeId ? `${workId}:${episodeId}` : ''
  const keyRef = useRef(key)
  keyRef.current = key

  const load = useCallback(() => {
    if (!repo || !workId || !episodeId) return
    const k = `${workId}:${episodeId}`
    void repo.get(workId, episodeId).then(
      (record) => {
        if (keyRef.current === k) setState({ key: k, record })
      },
      () => {
        if (keyRef.current === k) setState({ key: k, record: undefined })
      },
    )
  }, [repo, workId, episodeId])

  useEffect(() => {
    load()
    return subscribeSyncApplied(load)
  }, [load])

  const save = useCallback(
    async (next: ProofreadRecord) => {
      const k = `${next.workId}:${next.episodeId}`
      if (keyRef.current === k) setState({ key: k, record: next })
      await repo?.save(next)
    },
    [repo],
  )

  const current = state && state.key === key ? state : null
  return { record: current?.record, loaded: current !== null, save }
}

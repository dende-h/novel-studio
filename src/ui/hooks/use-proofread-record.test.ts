import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProofreadRecord } from '@/core/proofread/decisions'
import { type ProofreadRecordRepo, useProofreadRecord } from './use-proofread-record'

function fakeRepo(): ProofreadRecordRepo {
  const data = new Map<string, ProofreadRecord>()
  return {
    get: async (workId, episodeId) => data.get(`${workId}:${episodeId}`),
    save: async (record) => {
      data.set(`${record.workId}:${record.episodeId}`, record)
    },
  }
}

const record = (episodeId: string): ProofreadRecord => ({
  workId: 'w1',
  episodeId,
  decisions: [
    {
      blockId: 'b0',
      code: 'punct-before-close',
      text: '。」',
      nth: 0,
      anchor: 'contains',
      verdict: 'fix',
      decidedAt: 1,
    },
  ],
  updatedAt: 1,
})

describe('useProofreadRecord（COT-40）', () => {
  it('別の画面で保存した同じ話の判断を、読み直さずに受け取る（執筆画面の「直す箇所」）', async () => {
    const repo = fakeRepo()
    const writer = renderHook(() => useProofreadRecord(repo, 'w1', 'e1'))
    const proofread = renderHook(() => useProofreadRecord(repo, 'w1', 'e1'))
    const other = renderHook(() => useProofreadRecord(repo, 'w1', 'e2'))
    await waitFor(() => expect(writer.result.current.loaded).toBe(true))
    expect(writer.result.current.record).toBeUndefined()

    await act(async () => proofread.result.current.save(record('e1')))
    expect(writer.result.current.record?.decisions).toHaveLength(1)
    expect(proofread.result.current.record?.decisions).toHaveLength(1)
    // 別の話は替わらない
    expect(other.result.current.record).toBeUndefined()
  })
})

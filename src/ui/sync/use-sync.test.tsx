import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorStore } from '@/ui/store/editorStore'
import type { SyncBridge } from './sync-bridge'

// useAuth と createDefaultSyncController をモックし、use-sync の「起動ゲート」だけを検証する。
// 回帰防止対象: claim 完了（sessionReady）前に login-sync を走らせると空トークンで全 API が 409。
const { controller, createSpy, authState } = vi.hoisted(() => {
  const controller = {
    runLoginSync: vi.fn(() => Promise.resolve(null)),
    syncProfile: vi.fn(() => Promise.resolve()),
    notifyChanged: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
    purge: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  }
  return {
    controller,
    createSpy: vi.fn(() => controller),
    authState: {
      current: {
        available: true,
        status: 'member' as const,
        userId: 'u1',
        getToken: () => Promise.resolve('jwt'),
      },
    },
  }
})

vi.mock('@/ui/auth/auth-context', () => ({ useAuth: () => authState.current }))
vi.mock('./createDefaultSyncController', () => ({ createDefaultSyncController: createSpy }))

// モック確定後に SUT を読み込む。
const { useSync } = await import('./use-sync')

const store = { init: vi.fn(() => Promise.resolve()) } as unknown as EditorStore
const bridge: SyncBridge = { onSaved: () => {}, onPurged: () => {}, onProfileSaved: () => {} }

describe('useSync（同期の起動ゲート）', () => {
  beforeEach(() => {
    controller.runLoginSync.mockClear()
    controller.dispose.mockClear()
    createSpy.mockClear()
    ;(store.init as ReturnType<typeof vi.fn>).mockClear()
  })
  afterEach(() => {
    authState.current = {
      available: true,
      status: 'member',
      userId: 'u1',
      getToken: () => Promise.resolve('jwt'),
    }
  })

  it('sessionReady=false の間はコントローラを生成せず login-sync も走らせない', () => {
    renderHook(() => useSync(store, bridge, false))
    expect(createSpy).not.toHaveBeenCalled()
    expect(controller.runLoginSync).not.toHaveBeenCalled()
  })

  it('sessionReady=true になって初めて生成＋login-sync→一覧再読込', async () => {
    const { rerender } = renderHook(({ ready }) => useSync(store, bridge, ready), {
      initialProps: { ready: false },
    })
    expect(controller.runLoginSync).not.toHaveBeenCalled()
    await act(async () => {
      rerender({ ready: true })
    })
    expect(createSpy).toHaveBeenCalledOnce()
    expect(controller.runLoginSync).toHaveBeenCalledOnce()
    expect(store.init).toHaveBeenCalled()
  })

  it('ゲスト（member でない）では sessionReady でも何もしない', () => {
    authState.current = {
      available: true,
      status: 'guest' as unknown as 'member',
      userId: '',
      getToken: () => Promise.resolve(null as unknown as string),
    }
    renderHook(() => useSync(store, bridge, true))
    expect(createSpy).not.toHaveBeenCalled()
    expect(controller.runLoginSync).not.toHaveBeenCalled()
  })
})

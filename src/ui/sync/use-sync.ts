import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/ui/auth/auth-context'
import type { EditorStore } from '@/ui/store/editorStore'
import { createDefaultSyncController } from './createDefaultSyncController'
import type { SyncBridge } from './sync-bridge'
import type { SyncController, SyncPhase } from './sync-controller'

export interface UseSyncResult {
  /** バナー表示用の現在フェーズ。 */
  phase: SyncPhase
  /** 手動で全双方向同期を起動（オフライン復帰・容量解消後の再試行など）。 */
  syncNow: () => void
}

/**
 * クラウド同期の結線（Phase 2・Slice 2c）。member かつ sessionReady（claim 完了）になったら
 * 同期コントローラを生成し、①初回ログイン全双方向同期 → 一覧再読込、②保存通知（bridge）→
 * debounce push、③タブ非表示・オンライン復帰・離脱時の flush を担う。
 *
 * sessionReady を待つのが要点：claim が localStorage にセッショントークンを保存する前に同期を
 * 走らせると、空トークンで X-Session-Token を送り全 API が 409（superseded）で落ちる。claim 解禁
 * 前のローカル編集は、解禁後の login-sync が push で拾うのでデータ欠落はない。
 * ゲスト・loading・claim 前では何もしない（no-op）。
 */
export function useSync(
  store: EditorStore,
  bridge: SyncBridge,
  sessionReady: boolean,
): UseSyncResult {
  const { available, status, userId, getToken } = useAuth()
  const [phase, setPhase] = useState<SyncPhase>('idle')
  // getToken の参照変化で effect を作り直さないよう ref に退避する。
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken
  // 手動同期から「今アクティブなコントローラ」を参照するための ref。
  const controllerRef = useRef<SyncController | null>(null)

  const syncNow = useCallback(() => {
    const controller = controllerRef.current
    if (!controller) return
    void (async () => {
      await controller.runLoginSync()
      await store.init()
    })()
  }, [store])

  useEffect(() => {
    // sessionReady（claim 完了）まで起動しない。member でも claim 前は no-op に留める。
    if (!available || status !== 'member' || !userId || !sessionReady) {
      bridge.onSaved = () => {}
      bridge.onPurged = () => {}
      bridge.onProfileSaved = () => {}
      setPhase('idle')
      return
    }

    let alive = true
    const controller = createDefaultSyncController({
      getToken: () => getTokenRef.current(),
      userId,
      isEnabled: () => alive,
      onStatus: (p) => {
        if (alive) setPhase(p)
      },
    })
    controllerRef.current = controller

    bridge.onSaved = (id) => controller.notifyChanged(id)
    bridge.onPurged = (id) => void controller.purge(id)
    bridge.onProfileSaved = () => void controller.syncProfile()

    // 初回ログイン同期 → 完了後にエディタの一覧を再読込（pull した作品を反映）。
    void (async () => {
      await controller.runLoginSync()
      if (alive) await store.init()
    })()

    const flush = () => void controller.flush()
    const onVisibility = () => {
      // タブ非表示は離脱直前の最も確実な flush 機会（beforeunload より信頼できる）。
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', flush)

    return () => {
      alive = false
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', flush)
      void controller.flush() // ベストエフォートの最終 flush。
      controller.dispose()
      controllerRef.current = null
      bridge.onSaved = () => {}
      bridge.onPurged = () => {}
      bridge.onProfileSaved = () => {}
    }
  }, [available, status, userId, store, bridge, sessionReady])

  return { phase, syncNow }
}

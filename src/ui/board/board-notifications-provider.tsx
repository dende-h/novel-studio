import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  BOARD_SILENT_MS,
  type BoardNotificationResponse,
  type NotificationScope,
} from '@/core/board/notifications'
import {
  type BoardResult,
  fetchBoardNotifications,
  markBoardNotificationsRead,
  saveBoardNotificationScope,
  saveBoardNotificationSilence,
} from '@/ui/_api/board'

type TokenGetter = () => Promise<string | null>
interface NotificationControls {
  scope: NotificationScope | null
  silentUntil: number | null
  unread: ReadonlySet<string>
  saving: boolean
  read: (token: string) => Promise<BoardResult<null>>
  list: (cursor?: string | null) => Promise<BoardResult<BoardNotificationResponse>>
  silence: (silent: boolean) => Promise<void>
  saveScope: (scope: NotificationScope) => Promise<void>
  silenceError: string
  scopeError: string
}
const NotificationContext = createContext<NotificationControls | null>(null)
export const useBoardNotifications = () => useContext(NotificationContext)

type State = Pick<
  BoardNotificationResponse,
  'scope' | 'silentUntil' | 'serverNow' | 'unreadThreadIds'
>
const emptyUnread = new Set<string>()

export function BoardNotificationsProvider({
  userId,
  getToken,
  children,
}: {
  userId: string | null
  getToken: TokenGetter
  children: ReactNode
}) {
  const owner = useRef(userId)
  owner.current = userId
  const [stateOwner, setStateOwner] = useState(userId)
  const [state, setState] = useState<State | null>(null)
  const [saving, setSaving] = useState(false)
  const [silenceError, setSilenceError] = useState('')
  const [scopeError, setScopeError] = useState('')
  const [deadline, setDeadline] = useState<number | null>(null)
  const generation = useRef(0)
  const mutation = useRef(false)

  const receive = useCallback((data: State) => {
    setState(data)
    setDeadline(
      data.silentUntil === null
        ? null
        : Date.now() + Math.max(0, data.silentUntil - data.serverNow),
    )
  }, [])

  const refresh = useCallback(async () => {
    if (!userId || mutation.current) return
    const request = ++generation.current
    const result = await fetchBoardNotifications(getToken, true)
    if (result.ok && owner.current === userId && generation.current === request)
      receive(result.data)
  }, [getToken, receive, userId])

  useEffect(() => {
    setStateOwner(userId)
    setState(null)
    setDeadline(null)
    setSaving(false)
    setSilenceError('')
    setScopeError('')
    mutation.current = false
    if (!userId) return
    const visible = () => {
      if (!document.hidden) void refresh()
    }
    visible()
    let interval: number | undefined
    const reschedule = () => {
      window.clearInterval(interval)
      if (!document.hidden) {
        visible()
        interval = window.setInterval(visible, 60_000)
      }
    }
    const online = () => visible()
    if (!document.hidden) interval = window.setInterval(visible, 60_000)
    document.addEventListener('visibilitychange', reschedule)
    window.addEventListener('focus', visible)
    window.addEventListener('online', online)
    return () => {
      generation.current++
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', reschedule)
      window.removeEventListener('focus', visible)
      window.removeEventListener('online', online)
    }
  }, [refresh, userId])

  useEffect(() => {
    if (deadline === null) return
    const timer = window.setTimeout(
      () => {
        if (!document.hidden) void refresh()
      },
      Math.max(0, deadline - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [deadline, refresh])

  const read = useCallback(
    async (token: string) => {
      const result = await markBoardNotificationsRead(getToken, token)
      if (result.ok) void refresh()
      return result
    },
    [getToken, refresh],
  )

  const list = useCallback(
    (cursor?: string | null) => fetchBoardNotifications(getToken, false, cursor),
    [getToken],
  )

  const silence = async (silent: boolean) => {
    if (mutation.current || !state) return
    const previous = state
    const now = Date.now()
    generation.current++
    mutation.current = true
    setSaving(true)
    setSilenceError('')
    if (silent) receive({ ...state, silentUntil: now + BOARD_SILENT_MS, serverNow: now })
    const result = await saveBoardNotificationSilence(getToken, silent)
    if (owner.current !== userId) return
    if (result.ok) receive({ ...state, ...result.data, unreadThreadIds: [] })
    else {
      setState(previous)
      setDeadline(previous.silentUntil === null ? null : deadline)
      setSilenceError('通知の設定を保存できませんでした。もう一度お試しください。')
    }
    mutation.current = false
    setSaving(false)
    if (result.ok) void refresh()
  }

  const saveScope = async (scope: NotificationScope) => {
    if (mutation.current || !state || state.scope === scope) return
    generation.current++
    mutation.current = true
    setSaving(true)
    setScopeError('')
    const result = await saveBoardNotificationScope(getToken, scope)
    if (owner.current !== userId) return
    if (result.ok) setState({ ...state, scope, unreadThreadIds: [] })
    else setScopeError('通知の設定を保存できませんでした。もう一度お試しください。')
    mutation.current = false
    setSaving(false)
    if (result.ok) void refresh()
  }

  const unread = useMemo(
    () =>
      state?.silentUntil || state?.scope === 'off' ? emptyUnread : new Set(state?.unreadThreadIds),
    [state],
  )
  return (
    <NotificationContext.Provider
      value={
        userId && stateOwner === userId
          ? {
              scope: state?.scope ?? null,
              silentUntil: state?.silentUntil ?? null,
              unread,
              saving,
              read,
              list,
              silence,
              saveScope,
              silenceError,
              scopeError,
            }
          : null
      }
    >
      {children}
    </NotificationContext.Provider>
  )
}

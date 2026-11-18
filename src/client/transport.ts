/**
 * Delivery channels. Desktop pages post the notification to the Host, which
 * draws the topmost popup and reports activation back; ordinary Web pages use
 * the browser's own Notification API. Both paths converge on one
 * `openSession` callback.
 */

import { isRecord, type ResolvedNotifyConfig } from '../config'

/** One notification handed to a transport. */
export interface TransportPayload {
  readonly kind: 'ask' | 'done' | 'error' | 'self-test'
  readonly title: string
  readonly body: string
  /** Session to open when the notification is activated; empty means focus only. */
  readonly sessionId: string
  readonly autoCloseMs: number
  readonly sound: boolean
  readonly openLabel: string
  readonly ignoreLabel: string
}

/** Callbacks a transport needs from the plugin. */
export interface TransportEvents {
  readonly onOpenSession: (sessionId: string) => void
  readonly log: (message: string) => void
}

/** Delivery channel surface. */
export interface NotificationTransport {
  /** Install listeners and prepare permission handling. */
  start(): void
  /**
   * Deliver one notification.
   * @returns whether the notification was accepted by a channel.
   */
  send(payload: TransportPayload): Promise<boolean>
  /** Release listeners, timers, and outstanding notifications. */
  dispose(): void
}

const TOKEN_HEADER = 'x-dsh-notify-token'
const ACTIVATION_PATH = '/dsh-notify/activation'
const NOTIFY_PATH = '/dsh-notify/notify'
const POLL_INTERVAL_MS = 1_200
const EXTRA_POLL_MS = 30_000

/**
 * Create a process-unique opaque id for one notification.
 * @returns a UUID when the platform provides one, otherwise a random id.
 */
function notificationId(): string {
  const crypto = globalThis.crypto
  if (crypto !== undefined && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `dshn-${String(Date.now())}-${Math.random().toString(16).slice(2)}`
}

/** Desktop transport: Host route in, activation route out. */
function createPopupTransport(config: ResolvedNotifyConfig, events: TransportEvents, fallback: NotificationTransport): NotificationTransport {
  let disposed = false
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let pollDeadline = 0
  let pollInFlight = false

  const stopPolling = (): void => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
  }

  const pollActivation = async (): Promise<void> => {
    if (disposed || pollInFlight) return
    pollInFlight = true
    try {
      const response = await fetch(ACTIVATION_PATH, {
        method: 'GET',
        headers: { [TOKEN_HEADER]: config.token },
        cache: 'no-store',
      })
      if (!response.ok) return
      const body: unknown = await response.json()
      if (!isRecord(body)) return
      const sessionId = body.sessionId
      if (typeof sessionId === 'string' && sessionId !== '') {
        stopPolling()
        events.onOpenSession(sessionId)
      }
    } catch (error) {
      events.log(`activation poll failed: ${String(error)}`)
    } finally {
      pollInFlight = false
    }
  }

  const ensurePolling = (durationMs: number): void => {
    pollDeadline = Math.max(pollDeadline, Date.now() + durationMs + EXTRA_POLL_MS)
    if (pollTimer !== undefined) return
    pollTimer = setInterval(() => {
      if (Date.now() > pollDeadline) {
        stopPolling()
        return
      }
      void pollActivation()
    }, POLL_INTERVAL_MS)
    void pollActivation()
  }

  const onFocus = (): void => { void pollActivation() }
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') void pollActivation()
  }

  return {
    start(): void {
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onVisibility)
    },
    async send(payload: TransportPayload): Promise<boolean> {
      if (disposed) return false
      try {
        const response = await fetch(NOTIFY_PATH, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [TOKEN_HEADER]: config.token,
          },
          body: JSON.stringify({ id: notificationId(), ...payload }),
        })
        if (!response.ok) {
          events.log(`host notify rejected with status ${String(response.status)}`)
          return await fallback.send(payload)
        }
        ensurePolling(payload.autoCloseMs)
        return true
      } catch (error) {
        events.log(`host notify failed: ${String(error)}`)
        return await fallback.send(payload)
      }
    },
    dispose(): void {
      disposed = true
      stopPolling()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}

/** Web transport: browser Notification API. */
function createBrowserTransport(events: TransportEvents): NotificationTransport {
  const active = new Set<Notification>()
  let permissionAsked = false
  let disposed = false

  const requestPermission = (): void => {
    if (permissionAsked || disposed) return
    permissionAsked = true
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
    try {
      const request = Notification.requestPermission()
      if (request !== undefined && typeof request.then === 'function') {
        void request.then((state) => {
          if (state !== 'granted') events.log('notification permission was not granted')
        })
      }
    } catch (error) {
      events.log(`notification permission request failed: ${String(error)}`)
    }
  }

  const onClickGesture = (): void => { requestPermission() }

  return {
    start(): void {
      document.addEventListener('click', onClickGesture, { capture: true, once: true })
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') return
      events.log('browser notifications awaiting permission (first click asks)')
    },
    async send(payload: TransportPayload): Promise<boolean> {
      if (disposed) return false
      if (typeof Notification === 'undefined') {
        events.log('this browser has no Notification API')
        return false
      }
      if (Notification.permission !== 'granted') {
        events.log('browser notification skipped: permission is not granted')
        return false
      }
      try {
        const notification = new Notification(payload.title, {
          body: payload.body,
          tag: notificationId(),
          lang: document.documentElement.lang || undefined,
          silent: !payload.sound,
        })
        active.add(notification)
        notification.onclose = () => { active.delete(notification) }
        notification.onclick = () => {
          active.delete(notification)
          try { window.focus() } catch (error) { events.log(`window.focus failed: ${String(error)}`) }
          if (payload.sessionId !== '') events.onOpenSession(payload.sessionId)
          notification.close()
        }
        return true
      } catch (error) {
        events.log(`browser notification failed: ${String(error)}`)
        return false
      }
    },
    dispose(): void {
      disposed = true
      document.removeEventListener('click', onClickGesture, { capture: true })
      for (const notification of active) notification.close()
      active.clear()
    },
  }
}

/**
 * Create the transport selected by the resolved configuration.
 * @param config - resolved plugin configuration.
 * @param events - callbacks used by the transport.
 * @returns a transport with browser fallback on the popup path.
 */
export function createTransport(config: ResolvedNotifyConfig, events: TransportEvents): NotificationTransport {
  const browser = createBrowserTransport(events)
  if (config.transport !== 'popup') return browser
  return createPopupTransport(config, events, browser)
}

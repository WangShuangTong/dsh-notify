/**
 * Client half: watch Session UI status, compose localized notifications, and
 * deliver them only while the DSH page is not focused. Desktop delivery posts
 * to the Host popup route; Web delivery uses the browser Notification API.
 */

import { resolveClientConfig, type ResolvedNotifyConfig } from '../config'
import type { DshContext, PendingInteraction, SessionStatusSnapshot } from '../dsh'
import { askCopy, doneCopy, errorCopy, languageOf, selfTestCopy, sessionTitleOf, viewsOf, type Lang } from './messages'
import {
  pendingAskIntents, planNotifications, shouldDeliver, type NotifyIntent, type StatusView,
} from './model'
import { createTransport, type NotificationTransport, type TransportPayload } from './transport'

/** Client plugin name shown by diagnostics. */
export const name = 'dsh-notify-client'

const VERSION = '0.1.0'
const LOG_PREFIX = '[dsh-notify]'
const ANNOUNCE_KEY = `dsh-notify:announced:${VERSION}`
const STARTUP_SWEEP_MS = 3_000
const ANNOUNCE_DELAY_MS = 2_500

/** Debug surface exposed only while `config.debug` is true. */
interface DebugSurface {
  readonly ready: boolean
  readonly version: string
  readonly services: Readonly<Record<string, boolean>>
  lastOpenSession: string | undefined
  simulate(kind: 'ask' | 'done' | 'error' | 'self-test', options?: Record<string, unknown>): Promise<boolean>
  state(): unknown
}

/** Diagnostics marker for integration tests and troubleshooting. */
interface LoadedMarker {
  readonly version: string
  ready: boolean
  services: Readonly<Record<string, boolean>>
}

function warn(message: string): void {
  console.warn(`${LOG_PREFIX} ${message}`)
}

function readInjectedConfig(): unknown {
  return (globalThis as { __DSH_NOTIFY_CONFIG__?: unknown }).__DSH_NOTIFY_CONFIG__
}

function markLoaded(marker: LoadedMarker): void {
  ;(globalThis as { __DSH_NOTIFY_LOADED__?: LoadedMarker }).__DSH_NOTIFY_LOADED__ = marker
}

function fallbackConfig(): ResolvedNotifyConfig {
  return {
    version: 1,
    notifyOnAsk: true,
    notifyOnDone: true,
    notifyOnError: true,
    sound: true,
    onlyWhenUnfocused: true,
    announce: false,
    askAutoCloseMs: 60_000,
    doneAutoCloseMs: 15_000,
    transport: 'browser',
    debug: false,
    token: '',
    focusPid: 0,
  }
}

function isFocused(): boolean {
  try {
    return document.hasFocus()
  } catch {
    return true
  }
}

/** Per-install state of the client half. */
function install(scope: DshContext, config: ResolvedNotifyConfig): void {
  const sessions = scope.sessions
  const uiSession = scope.uiSession
  const uiWorkspace = scope.uiWorkspace
  if (sessions === undefined || uiSession === undefined || uiWorkspace === undefined) {
    warn('required client services are unavailable; notifications disabled')
    return
  }
  const lang: Lang = languageOf(document.documentElement.lang)
  let debugSurface: DebugSurface | undefined
  let last: Map<string, StatusView> = new Map()
  let baselineReady = false
  const deliveredAsks = new Map<string, string>()

  const transport: NotificationTransport = createTransport(config, {
    onOpenSession: (sessionId) => {
      if (debugSurface !== undefined) debugSurface.lastOpenSession = sessionId
      try {
        uiWorkspace.openSession(sessionId)
      } catch (error) {
        warn(`openSession failed: ${String(error)}`)
      }
    },
    log: warn,
  })
  transport.start()
  scope.effect(() => () => { transport.dispose() }, 'dsh-notify: transport')

  const listSnapshot = () => sessions.list.getSnapshot()

  const titleOf = (sessionId: string): string => sessionTitleOf(listSnapshot().byId[sessionId], sessionId)

  const topLevel = (): Set<string> => {
    const snapshot = listSnapshot()
    const ids = new Set<string>()
    for (const id of snapshot.ids) {
      if (snapshot.byId[id]?.origin !== 'subagent') ids.add(id)
    }
    return ids
  }

  const payloadOf = (
    copy: { title: string; body: string; openLabel: string; ignoreLabel: string },
    kind: TransportPayload['kind'],
    sessionId: string,
    autoCloseMs: number,
  ): TransportPayload => ({
    kind,
    title: copy.title,
    body: copy.body,
    sessionId,
    autoCloseMs,
    sound: config.sound,
    openLabel: copy.openLabel,
    ignoreLabel: copy.ignoreLabel,
  })

  const sendIntent = async (intent: NotifyIntent): Promise<void> => {
    if (!shouldDeliver(config, isFocused())) return
    if (intent.kind === 'ask') {
      if (!config.notifyOnAsk) return
      const key = intent.interaction.key
      if (deliveredAsks.get(intent.sessionId) === key) return
      const copy = askCopy(intent.interaction, titleOf(intent.sessionId), lang)
      const accepted = await transport.send(payloadOf(copy, 'ask', intent.sessionId, config.askAutoCloseMs))
      if (accepted) deliveredAsks.set(intent.sessionId, key)
      return
    }
    if (!config.notifyOnDone) return
    const copy = doneCopy(intent.sessionIds.map(titleOf), lang)
    const target = intent.sessionIds.length === 1 ? (intent.sessionIds[0] as string) : ''
    await transport.send(payloadOf(copy, 'done', target, config.doneAutoCloseMs))
  }

  const deliver = (intent: NotifyIntent): void => {
    void sendIntent(intent).catch((error: unknown) => { warn(`delivery failed: ${String(error)}`) })
  }

  const cleanupDelivered = (next: ReadonlyMap<string, StatusView>): void => {
    for (const [sessionId, key] of deliveredAsks) {
      if (next.get(sessionId)?.pending?.key !== key) deliveredAsks.delete(sessionId)
    }
  }

  const tick = (): void => {
    const snapshot = uiSession.sessionStatus.getSnapshot()
    const next = viewsOf(snapshot)
    if (!baselineReady) {
      baselineReady = true
      last = next
      return
    }
    const intents = planNotifications({
      prev: last,
      next,
      topLevel: topLevel(),
      deliveredAsks,
    })
    last = next
    cleanupDelivered(next)
    for (const intent of intents) deliver(intent)
  }

  const sweepAsks = (): void => {
    if (!shouldDeliver(config, isFocused())) return
    if (!config.notifyOnAsk) return
    const snapshot: SessionStatusSnapshot = uiSession.sessionStatus.getSnapshot()
    for (const intent of pendingAskIntents(viewsOf(snapshot), topLevel(), deliveredAsks)) deliver(intent)
  }

  const stopStatus = uiSession.sessionStatus.subscribe(() => {
    try {
      tick()
    } catch (error) {
      warn(`status update failed: ${String(error)}`)
    }
  })
  scope.effect(() => stopStatus, 'dsh-notify: status subscription')

  scope.inject(['remote'], (remoteScope) => {
    const remote = remoteScope.remote
    if (remote === undefined) return
    const stopError = remote.$on('api-session/error', (sessionId, message) => {
      try {
        if (!config.notifyOnError) return
        if (!shouldDeliver(config, isFocused())) return
        if (!topLevel().has(sessionId)) return
        const copy = errorCopy(titleOf(sessionId), message, lang)
        void transport.send(payloadOf(copy, 'error', sessionId, config.doneAutoCloseMs))
          .catch((error: unknown) => { warn(`error notification failed: ${String(error)}`) })
      } catch (error) {
        warn(`error handling failed: ${String(error)}`)
      }
    })
    remoteScope.effect(() => stopError, 'dsh-notify: session error subscription')
  })

  const onBlur = (): void => {
    window.setTimeout(() => {
      try {
        sweepAsks()
      } catch (error) {
        warn(`blur sweep failed: ${String(error)}`)
      }
    }, 50)
  }
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      try {
        sweepAsks()
      } catch (error) {
        warn(`visibility sweep failed: ${String(error)}`)
      }
    }
  }
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVisibility)
  scope.effect(() => () => {
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibility)
  }, 'dsh-notify: focus listeners')

  const startupTimer = window.setTimeout(() => {
    try {
      sweepAsks()
    } catch (error) {
      warn(`startup sweep failed: ${String(error)}`)
    }
  }, STARTUP_SWEEP_MS)
  scope.effect(() => () => { window.clearTimeout(startupTimer) }, 'dsh-notify: startup sweep')

  const announceTimer = config.announce
    ? window.setTimeout(() => {
      try {
        let announced = false
        try {
          announced = window.localStorage.getItem(ANNOUNCE_KEY) !== null
        } catch {
          announced = true
        }
        if (announced) return
        const copy = selfTestCopy(lang)
        void transport.send(payloadOf(copy, 'self-test', '', config.doneAutoCloseMs))
          .then((accepted) => {
            if (!accepted) return
            try {
              window.localStorage.setItem(ANNOUNCE_KEY, new Date().toISOString())
            } catch {
              // A blocked storage area only repeats the self test on next load.
            }
          })
          .catch((error: unknown) => { warn(`self-test failed: ${String(error)}`) })
      } catch (error) {
        warn(`announcement failed: ${String(error)}`)
      }
    }, ANNOUNCE_DELAY_MS)
    : undefined
  if (announceTimer !== undefined) {
    scope.effect(() => () => { window.clearTimeout(announceTimer) }, 'dsh-notify: self test')
  }

  if (config.debug) {
    const surface: DebugSurface = {
      ready: true,
      version: VERSION,
      services: { sessions: true, uiSession: true, uiWorkspace: true },
      lastOpenSession: undefined,
      async simulate(kind, options = {}) {
        const sessionId = typeof options.sessionId === 'string' ? options.sessionId : `debug-${String(Date.now())}`
        const title = typeof options.title === 'string' ? options.title : 'Debug session'
        if (kind === 'ask') {
          const interactionKind = typeof options.interactionKind === 'string' ? options.interactionKind : 'question'
          const pending: PendingInteraction = {
            key: `debug-${String(Date.now())}`,
            kind: interactionKind,
            sessionId,
            toolName: 'debug_tool',
            reason: 'debug reason',
            questions: [{ question: typeof options.question === 'string' ? options.question : 'Debug question?', options: [{ label: 'A' }, { label: 'B' }] }],
          }
          const copy = askCopy(pending, title, lang)
          return transport.send(payloadOf(copy, 'ask', sessionId, Math.min(config.askAutoCloseMs, 30_000)))
        }
        if (kind === 'done') {
          const copy = doneCopy([title], lang)
          return transport.send(payloadOf(copy, 'done', sessionId, config.doneAutoCloseMs))
        }
        if (kind === 'error') {
          const copy = errorCopy(title, typeof options.message === 'string' ? options.message : 'debug failure', lang)
          return transport.send(payloadOf(copy, 'error', sessionId, config.doneAutoCloseMs))
        }
        const copy = selfTestCopy(lang)
        return transport.send(payloadOf(copy, 'self-test', '', config.doneAutoCloseMs))
      },
      state() {
        return {
          baselineReady,
          sessions: [...last.entries()].map(([id, view]) => ({ id, running: view.running, pending: view.pending?.key })),
          deliveredAsks: [...deliveredAsks.entries()],
          focused: isFocused(),
        }
      },
    }
    debugSurface = surface
    ;(globalThis as { __DSH_NOTIFY_DEBUG__?: DebugSurface }).__DSH_NOTIFY_DEBUG__ = surface
    scope.effect(() => () => {
      if ((globalThis as { __DSH_NOTIFY_DEBUG__?: DebugSurface }).__DSH_NOTIFY_DEBUG__ === surface) {
        delete (globalThis as { __DSH_NOTIFY_DEBUG__?: DebugSurface }).__DSH_NOTIFY_DEBUG__
      }
    }, 'dsh-notify: debug surface')
  }

  markLoaded({ version: VERSION, ready: true, services: { sessions: true, uiSession: true, uiWorkspace: true } })
}

/**
 * Client plugin body. Never throws into the module loader: a failure here must
 * not fail the whole page boot.
 * @param ctx - client root context.
 */
export function apply(ctx: DshContext): void {
  try {
    const injected = readInjectedConfig()
    const config = resolveClientConfig(injected, warn) ?? fallbackConfig()
    if (injected === undefined) warn('no injected configuration; desktop popup transport unavailable')
    markLoaded({ version: VERSION, ready: false, services: {} })
    ctx.inject(['sessions', 'uiSession', 'uiWorkspace'], (scope) => {
      try {
        install(scope, config)
      } catch (error) {
        warn(`install failed: ${String(error)}`)
      }
    })
  } catch (error) {
    warn(`client plugin failed: ${String(error)}`)
  }
}

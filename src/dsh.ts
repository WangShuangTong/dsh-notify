/**
 * Minimal structural view of the DSH services and runtime objects this plugin
 * uses. It is intentionally declared here instead of importing DSH packages so
 * the plugin stays portable across DSH patch releases. Every member mirrors a
 * public service or event at the tested version (0.2.2-alpha.2).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Bare observable source published by DSH client stores. */
export interface HostObservable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/**
 * Common identity of every Session-scoped pending interaction. Concrete DSH
 * values (approval / question / plan review) carry extra public fields read
 * opportunistically below.
 */
export interface PendingInteraction {
  readonly key: string
  readonly kind: string
  readonly sessionId: string
  /** Approval requests only: the tool awaiting a decision. */
  readonly toolName?: string
  /** Approval requests only: the asker's plain explanation. */
  readonly reason?: string
  /** Approval requests only: localized presentation copy. */
  readonly displayReason?: Readonly<Record<string, string>>
  /** Question requests only: the structured question batch. */
  readonly questions?: readonly unknown[]
}

/** Independent UI status facts for one Session identity. */
export interface SessionStatus {
  readonly running: boolean | undefined
  readonly pendingInteraction: PendingInteraction | undefined
  readonly completionUnread: boolean
}

/** Current UI status indexed by Session identity. */
export type SessionStatusSnapshot = ReadonlyMap<string, SessionStatus>

/** Session list row facts used for notification titles and filtering. */
export interface SessionSummary {
  readonly displayTitle?: string
  readonly title?: string
  readonly origin?: string
  readonly running?: boolean
}

/** Session catalog snapshot published by the client module system. */
export interface SessionListState {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionSummary | undefined>>
}

/** Client Session catalog service (`ctx.sessions`). */
export interface SessionsService {
  readonly list: HostObservable<SessionListState>
}

/** Client Session UI adapter (`ctx.uiSession`). */
export interface UiSessionService {
  readonly sessionStatus: HostObservable<SessionStatusSnapshot>
}

/** Client workspace navigation service (`ctx.uiWorkspace`). */
export interface UiWorkspaceService {
  openSession(sessionId: string): void
}

/** Client Remote Event service (`ctx.remote`). */
export interface RemoteService {
  $on(event: 'api-session/error', handler: (sessionId: string, message: string) => void): () => void
}

/** One row contributed to the served index boot table. */
export interface InjectionRow {
  readonly kind: 'global'
  readonly name: string
  readonly value: unknown
}

/** Route handler owning the full HTTP response lifecycle. */
export type WebRouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

/** One named host route registration. */
export interface WebRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: WebRouteHandler
}

/** Host web server service (`ctx.webServer`). */
export interface WebServerService {
  register(route: WebRoute): () => void
}

/**
 * The subset of the Cordis plugin context this plugin consumes. Host and
 * client halves receive the real Cordis context; only these members are used.
 */
export interface DshContext {
  on(event: 'webserver/index-inject', listener: (table: InjectionRow[], peer: unknown) => void): () => void
  inject(services: readonly string[], callback: (scope: DshContext) => void): void
  effect(setup: () => void | (() => void), label?: string): void
  webServer?: WebServerService
  sessions?: SessionsService
  uiSession?: UiSessionService
  uiWorkspace?: UiWorkspaceService
  remote?: RemoteService
}

/**
 * Pure notification planning: compare two Session status snapshots and decide
 * what the user must be told. No DOM, no DSH runtime, fully unit-testable.
 */

import type { NotifyConfig } from '../config'
import type { PendingInteraction, SessionStatus } from '../dsh'

/** The status facts the planner compares. */
export interface StatusView {
  readonly running: boolean | undefined
  readonly pending: PendingInteraction | undefined
}

/** One notification the planner decided to send. */
export type NotifyIntent =
  | { readonly kind: 'ask'; readonly sessionId: string; readonly interaction: PendingInteraction }
  | { readonly kind: 'done'; readonly sessionIds: readonly string[] }

/** Inputs of {@link planNotifications}. */
export interface PlanInput {
  /** Status snapshot observed on the previous tick. */
  readonly prev: ReadonlyMap<string, StatusView>
  /** Status snapshot observed now. */
  readonly next: ReadonlyMap<string, StatusView>
  /** Session ids eligible for notifications (non-subagent list rows). */
  readonly topLevel: ReadonlySet<string>
  /** Interaction keys already delivered, per Session. */
  readonly deliveredAsks: ReadonlyMap<string, string>
}

/**
 * Reduce one Session status to the planner's view.
 * @param status - DSH status value.
 * @returns the comparable view.
 */
export function toStatusView(status: SessionStatus): StatusView {
  return { running: status.running, pending: status.pendingInteraction }
}

/**
 * Decide which notifications a status transition produces.
 *
 * - A pending interaction whose key is new (and was not already delivered)
 *   produces one ask notification.
 * - A running -> idle transition produces a completion notification only when
 *   the Session is not waiting on the user.
 * - Asks take precedence; completions from the same tick are merged.
 * @param input - previous/current status, eligible Sessions, delivered asks.
 * @returns intents in send order.
 */
export function planNotifications(input: PlanInput): NotifyIntent[] {
  const asks: NotifyIntent[] = []
  const completed: string[] = []
  const askedSessions = new Set<string>()
  for (const [sessionId, status] of input.next) {
    if (!input.topLevel.has(sessionId)) continue
    const previous = input.prev.get(sessionId)
    const pending = status.pending
    const pendingKey = pending?.key
    const previousKey = previous?.pending?.key
    if (
      pending !== undefined
      && pendingKey !== undefined
      && pendingKey !== previousKey
      && input.deliveredAsks.get(sessionId) !== pendingKey
    ) {
      asks.push({ kind: 'ask', sessionId, interaction: pending })
      askedSessions.add(sessionId)
      continue
    }
    if (
      status.pending === undefined
      && previous?.running === true
      && status.running === false
      && !askedSessions.has(sessionId)
    ) {
      completed.push(sessionId)
    }
  }
  const intents: NotifyIntent[] = [...asks]
  if (completed.length === 1) intents.push({ kind: 'done', sessionIds: [completed[0] as string] })
  else if (completed.length > 1) intents.push({ kind: 'done', sessionIds: completed })
  return intents
}

/**
 * Pending asks that still need delivery, used when the window loses focus or
 * when a page reload replayed an outstanding request.
 * @param next - current status snapshot.
 * @param topLevel - eligible Session ids.
 * @param deliveredAsks - interaction keys already delivered.
 * @returns ask intents in snapshot order.
 */
export function pendingAskIntents(
  next: ReadonlyMap<string, StatusView>,
  topLevel: ReadonlySet<string>,
  deliveredAsks: ReadonlyMap<string, string>,
): NotifyIntent[] {
  const intents: NotifyIntent[] = []
  for (const [sessionId, status] of next) {
    if (!topLevel.has(sessionId)) continue
    const pending = status.pending
    const pendingKey = pending?.key
    if (pending === undefined || pendingKey === undefined) continue
    if (deliveredAsks.get(sessionId) === pendingKey) continue
    intents.push({ kind: 'ask', sessionId, interaction: pending })
  }
  return intents
}

/**
 * Whether the delivery gate allows a notification right now.
 * @param config - notification configuration.
 * @param focused - whether the DSH document currently has focus.
 * @returns true when the notification should be sent.
 */
export function shouldDeliver(config: Pick<NotifyConfig, 'onlyWhenUnfocused'>, focused: boolean): boolean {
  return !config.onlyWhenUnfocused || !focused
}

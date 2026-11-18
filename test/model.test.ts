import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import type { PendingInteraction } from '../src/dsh.ts'
import {
  pendingAskIntents, planNotifications, shouldDeliver, toStatusView, type StatusView,
} from '../src/client/model.ts'

function pending(key: string, kind = 'question'): PendingInteraction {
  return { key, kind, sessionId: 's1' }
}

function status(running: boolean | undefined, interaction?: PendingInteraction): StatusView {
  return { running, pending: interaction }
}

const ALL = new Set(['s1', 's2'])

function plan(prev: Map<string, StatusView>, next: Map<string, StatusView>, delivered = new Map<string, string>()) {
  return planNotifications({ prev, next, topLevel: ALL, deliveredAsks: delivered })
}

describe('planNotifications', () => {
  it('produces nothing when the status is unchanged', () => {
    const snapshot = new Map([['s1', status(true)]])
    assert.deepEqual(plan(snapshot, snapshot), [])
  })

  it('notifies a running to idle transition once', () => {
    const intents = plan(new Map([['s1', status(true)]]), new Map([['s1', status(false)]]))
    assert.equal(intents.length, 1)
    assert.deepEqual(intents[0], { kind: 'done', sessionIds: ['s1'] })
  })

  it('ignores sessions that never reported running', () => {
    assert.deepEqual(plan(new Map([['s1', status(undefined)]]), new Map([['s1', status(false)]]), new Map()), [])
  })

  it('notifies a new pending interaction once', () => {
    const interaction = pending('q1')
    const intents = plan(new Map([['s1', status(true)]]), new Map([['s1', status(true, interaction)]]))
    assert.deepEqual(intents, [{ kind: 'ask', sessionId: 's1', interaction }])
  })

  it('does not repeat a delivered interaction', () => {
    const interaction = pending('q1')
    const delivered = new Map([['s1', 'q1']])
    const intents = plan(
      new Map([['s1', status(true)]]),
      new Map([['s1', status(true, interaction)]]),
      delivered,
    )
    assert.deepEqual(intents, [])
  })

  it('treats a changed interaction key as a new request', () => {
    const intents = plan(
      new Map([['s1', status(true, pending('q1'))]]),
      new Map([['s1', status(true, pending('q2'))]]),
      new Map([['s1', 'q1']]),
    )
    assert.equal(intents.length, 1)
    assert.equal(intents[0]?.kind, 'ask')
  })

  it('sends only the ask when a request and an idle transition arrive together', () => {
    const intents = plan(
      new Map([['s1', status(true)]]),
      new Map([['s1', status(false, pending('q1'))]]),
    )
    assert.equal(intents.length, 1)
    assert.equal(intents[0]?.kind, 'ask')
  })

  it('never sends a completion for a session that is waiting on the user', () => {
    const intents = plan(
      new Map([['s1', status(true, pending('q1'))], ['s2', status(true)]]),
      new Map([['s1', status(false, pending('q1'))], ['s2', status(false)]]),
      new Map([['s1', 'q1']]),
    )
    assert.deepEqual(intents, [{ kind: 'done', sessionIds: ['s2'] }])
  })

  it('merges simultaneous completions into one notification', () => {
    const intents = plan(
      new Map([['s1', status(true)], ['s2', status(true)]]),
      new Map([['s1', status(false)], ['s2', status(false)]]),
    )
    assert.deepEqual(intents, [{ kind: 'done', sessionIds: ['s1', 's2'] }])
  })

  it('ignores subagent and unlisted sessions', () => {
    const subagent = new Map([['s1', status(true)]])
    const intents = planNotifications({
      prev: subagent,
      next: new Map([['s1', status(false)]]),
      topLevel: new Set(),
      deliveredAsks: new Map(),
    })
    assert.deepEqual(intents, [])
  })
})

describe('pendingAskIntents', () => {
  it('reports only undelivered pending asks for eligible sessions', () => {
    const next = new Map([
      ['s1', status(false, pending('q1'))],
      ['s2', status(false, pending('q2'))],
    ])
    const intents = pendingAskIntents(next, new Set(['s1']), new Map([['s1', 'q1']]))
    assert.deepEqual(intents, [])
    const delivered = new Map<string, string>()
    assert.deepEqual(pendingAskIntents(next, new Set(['s1']), delivered), [
      { kind: 'ask', sessionId: 's1', interaction: pending('q1') },
    ])
  })
})

describe('shouldDeliver', () => {
  it('follows onlyWhenUnfocused', () => {
    assert.equal(shouldDeliver({ onlyWhenUnfocused: true }, false), true)
    assert.equal(shouldDeliver({ onlyWhenUnfocused: true }, true), false)
    assert.equal(shouldDeliver({ onlyWhenUnfocused: false }, true), true)
  })
})

describe('toStatusView', () => {
  it('reduces the DSH status value', () => {
    assert.deepEqual(toStatusView({ running: true, pendingInteraction: undefined, completionUnread: false }), {
      running: true,
      pending: undefined,
    })
  })
})

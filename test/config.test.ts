import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  DEFAULT_NOTIFY_CONFIG, normalizeNotifyConfig, resolveClientConfig, resolveHostConfig,
} from '../src/config.ts'

function collector(): { warnings: string[]; warn: (message: string) => void } {
  const warnings: string[] = []
  return { warnings, warn: (message) => { warnings.push(message) } }
}

describe('normalizeNotifyConfig', () => {
  it('applies defaults without warnings when the value is absent', () => {
    const { warnings, warn } = collector()
    assert.deepEqual(normalizeNotifyConfig(undefined, warn), DEFAULT_NOTIFY_CONFIG)
    assert.deepEqual(warnings, [])
  })

  it('keeps valid members', () => {
    const { warnings, warn } = collector()
    const config = normalizeNotifyConfig({
      notifyOnAsk: false,
      notifyOnDone: false,
      notifyOnError: false,
      sound: false,
      onlyWhenUnfocused: false,
      announce: false,
      askAutoCloseMs: 0,
      doneAutoCloseMs: 5_000,
      transport: 'popup',
      debug: true,
    }, warn)
    assert.deepEqual(config, {
      notifyOnAsk: false,
      notifyOnDone: false,
      notifyOnError: false,
      sound: false,
      onlyWhenUnfocused: false,
      announce: false,
      askAutoCloseMs: 0,
      doneAutoCloseMs: 5_000,
      transport: 'popup',
      debug: true,
    })
    assert.deepEqual(warnings, [])
  })

  it('falls back per member and warns on malformed values', () => {
    const { warnings, warn } = collector()
    const config = normalizeNotifyConfig({
      notifyOnAsk: 'yes',
      askAutoCloseMs: -1,
      transport: 'toast',
      sound: 1,
    }, warn)
    assert.equal(config.notifyOnAsk, DEFAULT_NOTIFY_CONFIG.notifyOnAsk)
    assert.equal(config.askAutoCloseMs, DEFAULT_NOTIFY_CONFIG.askAutoCloseMs)
    assert.equal(config.transport, DEFAULT_NOTIFY_CONFIG.transport)
    assert.equal(config.sound, DEFAULT_NOTIFY_CONFIG.sound)
    assert.equal(warnings.length, 4)
  })

  it('clamps oversized close delays', () => {
    const { warn } = collector()
    const config = normalizeNotifyConfig({ askAutoCloseMs: 9_999_999, doneAutoCloseMs: Number.POSITIVE_INFINITY }, warn)
    assert.equal(config.askAutoCloseMs, 600_000)
    assert.equal(config.doneAutoCloseMs, DEFAULT_NOTIFY_CONFIG.doneAutoCloseMs)
  })
})

describe('resolveHostConfig', () => {
  it('auto-selects the popup on a Windows Electron host', () => {
    const { warn } = collector()
    const config = resolveHostConfig({}, { underElectron: true, platform: 'win32', ppid: 4242 }, 'tok', warn)
    assert.equal(config.transport, 'popup')
    assert.equal(config.focusPid, 4242)
    assert.equal(config.token, 'tok')
  })

  it('auto-selects browser notifications on a Web host', () => {
    const { warn } = collector()
    const config = resolveHostConfig({}, { underElectron: false, platform: 'win32', ppid: 4242 }, 'tok', warn)
    assert.equal(config.transport, 'browser')
    assert.equal(config.focusPid, 0)
  })

  it('honours an explicit popup transport on Windows outside Electron', () => {
    const { warn } = collector()
    const config = resolveHostConfig(
      { transport: 'popup', focusPid: 777 },
      { underElectron: false, platform: 'win32', ppid: 4242 },
      'tok',
      warn,
    )
    assert.equal(config.transport, 'popup')
    assert.equal(config.focusPid, 777)
  })

  it('treats focusPid 0 as focus disabled', () => {
    const { warnings, warn } = collector()
    const config = resolveHostConfig(
      { focusPid: 0 },
      { underElectron: true, platform: 'win32', ppid: 4242 },
      'tok',
      warn,
    )
    assert.equal(config.focusPid, 0)
    assert.deepEqual(warnings, [])
  })

  it('rejects the popup transport outside Windows', () => {
    const { warnings, warn } = collector()
    const config = resolveHostConfig(
      { transport: 'popup' },
      { underElectron: true, platform: 'linux', ppid: 1 },
      'tok',
      warn,
    )
    assert.equal(config.transport, 'browser')
    assert.match(warnings.join('\n'), /popup/u)
  })

  it('ignores an invalid focusPid', () => {
    const { warn } = collector()
    const config = resolveHostConfig(
      { focusPid: -5 },
      { underElectron: true, platform: 'win32', ppid: 4242 },
      'tok',
      warn,
    )
    assert.equal(config.focusPid, 4242)
  })
})

describe('resolveClientConfig', () => {
  it('returns undefined when nothing was injected', () => {
    const { warn } = collector()
    assert.equal(resolveClientConfig(undefined, warn), undefined)
  })

  it('accepts a resolved popup configuration', () => {
    const { warn } = collector()
    const config = resolveClientConfig({
      version: 1,
      notifyOnAsk: true,
      transport: 'popup',
      token: 'tok',
      focusPid: 42,
    }, warn)
    assert.equal(config?.transport, 'popup')
    assert.equal(config?.token, 'tok')
    assert.equal(config?.focusPid, 42)
  })

  it('downgrades a popup configuration without a token', () => {
    const { warnings, warn } = collector()
    const config = resolveClientConfig({ transport: 'popup' }, warn)
    assert.equal(config?.transport, 'browser')
    assert.match(warnings.join('\n'), /token/u)
  })

  it('rejects a non-object value', () => {
    const { warn } = collector()
    assert.equal(resolveClientConfig('nope', warn), undefined)
  })
})

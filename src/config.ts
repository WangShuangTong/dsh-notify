/** Validated plugin configuration shared by the Host and Client halves. */

/** Delivery channel: resolved Host-side from deployment facts, or forced for tests. */
export type NotifyTransport = 'auto' | 'popup' | 'browser'

/** Raw plugin configuration accepted from a Loader row's `config`. */
export interface NotifyConfig {
  readonly notifyOnAsk: boolean
  readonly notifyOnDone: boolean
  readonly notifyOnError: boolean
  readonly sound: boolean
  readonly onlyWhenUnfocused: boolean
  readonly announce: boolean
  readonly askAutoCloseMs: number
  readonly doneAutoCloseMs: number
  readonly transport: NotifyTransport
  readonly debug: boolean
}

/** Fully resolved configuration injected into the browser page. */
export interface ResolvedNotifyConfig extends Omit<NotifyConfig, 'transport'> {
  readonly version: number
  readonly transport: 'popup' | 'browser'
  readonly token: string
  readonly focusPid: number
}

/** Configuration injected as `globalThis.__DSH_NOTIFY_CONFIG__`. */
export type InjectedNotifyConfig = ResolvedNotifyConfig

/** Defaults applied when a key is absent or malformed. */
export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  notifyOnAsk: true,
  notifyOnDone: true,
  notifyOnError: true,
  sound: true,
  onlyWhenUnfocused: true,
  announce: true,
  askAutoCloseMs: 60_000,
  doneAutoCloseMs: 15_000,
  transport: 'auto',
  debug: false,
}

/** Upper bounds keep a misconfigured row from holding a popup forever. */
const ASK_CLOSE_MAX = 600_000
const DONE_CLOSE_MAX = 300_000

type Warn = (message: string) => void

/**
 * Whether a value is a plain record.
 * @param value - candidate.
 * @returns true for a non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBoolean(source: Record<string, unknown>, key: keyof NotifyConfig, fallback: boolean, warn: Warn): boolean {
  const value = source[key]
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  warn(`config.${key} must be a boolean; using ${String(fallback)}`)
  return fallback
}

function readCloseMs(
  source: Record<string, unknown>,
  key: 'askAutoCloseMs' | 'doneAutoCloseMs',
  fallback: number,
  max: number,
  warn: Warn,
): number {
  const value = source[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    warn(`config.${key} must be a non-negative number; using ${String(fallback)}`)
    return fallback
  }
  return Math.min(Math.trunc(value), max)
}

function readTransport(source: Record<string, unknown>, fallback: NotifyTransport, warn: Warn): NotifyTransport {
  const value = source.transport
  if (value === undefined) return fallback
  if (value === 'auto' || value === 'popup' || value === 'browser') return value
  warn(`config.transport must be one of auto, popup, browser; using ${fallback}`)
  return fallback
}

/**
 * Validate every configuration member with a fallback instead of failing the
 * plugin load. A malformed operator value degrades to the default with a
 * warning; it never prevents DSH from starting.
 * @param raw - Loader row config value.
 * @param warn - diagnostic sink.
 * @returns the validated configuration.
 */
export function normalizeNotifyConfig(raw: unknown, warn: Warn): NotifyConfig {
  const source = isRecord(raw) ? raw : {}
  return {
    notifyOnAsk: readBoolean(source, 'notifyOnAsk', DEFAULT_NOTIFY_CONFIG.notifyOnAsk, warn),
    notifyOnDone: readBoolean(source, 'notifyOnDone', DEFAULT_NOTIFY_CONFIG.notifyOnDone, warn),
    notifyOnError: readBoolean(source, 'notifyOnError', DEFAULT_NOTIFY_CONFIG.notifyOnError, warn),
    sound: readBoolean(source, 'sound', DEFAULT_NOTIFY_CONFIG.sound, warn),
    onlyWhenUnfocused: readBoolean(source, 'onlyWhenUnfocused', DEFAULT_NOTIFY_CONFIG.onlyWhenUnfocused, warn),
    announce: readBoolean(source, 'announce', DEFAULT_NOTIFY_CONFIG.announce, warn),
    askAutoCloseMs: readCloseMs(source, 'askAutoCloseMs', DEFAULT_NOTIFY_CONFIG.askAutoCloseMs, ASK_CLOSE_MAX, warn),
    doneAutoCloseMs: readCloseMs(source, 'doneAutoCloseMs', DEFAULT_NOTIFY_CONFIG.doneAutoCloseMs, DONE_CLOSE_MAX, warn),
    transport: readTransport(source, DEFAULT_NOTIFY_CONFIG.transport, warn),
    debug: readBoolean(source, 'debug', DEFAULT_NOTIFY_CONFIG.debug, warn),
  }
}

function readFocusPid(source: Record<string, unknown>, warn: Warn): number | undefined {
  const value = source.focusPid
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return Math.min(value, 2_147_483_647)
  warn('config.focusPid must be a non-negative integer; using the default')
  return undefined
}

/**
 * Resolve the Host deployment facts into one delivered configuration.
 * @param raw - Loader row config value.
 * @param environment - deployment facts: running under Electron, platform, parent pid.
 * @param token - process-scoped route token injected into the page.
 * @param warn - diagnostic sink.
 * @returns the resolved configuration and the injected page value.
 */
export function resolveHostConfig(
  raw: unknown,
  environment: { readonly underElectron: boolean; readonly platform: string; readonly ppid: number },
  token: string,
  warn: Warn,
): ResolvedNotifyConfig {
  const base = normalizeNotifyConfig(raw, warn)
  let transport: 'popup' | 'browser'
  if (base.transport === 'browser') {
    transport = 'browser'
  } else if (base.transport === 'popup') {
    // An explicit popup request is honoured on Windows even outside the Desktop
    // host: tests and custom compositions may drive it with a focusPid.
    transport = environment.platform === 'win32' ? 'popup' : 'browser'
    if (transport !== 'popup') warn('config.transport popup requires Windows; using browser notifications')
  } else {
    transport = environment.underElectron && environment.platform === 'win32' ? 'popup' : 'browser'
  }
  const configuredFocusPid = readFocusPid(isRecord(raw) ? raw : {}, warn)
  const focusPid = configuredFocusPid !== undefined
    ? configuredFocusPid
    : (environment.underElectron ? environment.ppid : 0)
  return {
    version: 1,
    ...base,
    transport,
    token,
    focusPid,
  }
}

/**
 * Validate the page-side copy of the configuration. A malformed or missing
 * injected value falls back to browser notifications with no token; the client
 * then keeps working without the Host popup channel.
 * @param raw - value read from `globalThis.__DSH_NOTIFY_CONFIG__`.
 * @param warn - diagnostic sink.
 * @returns the validated resolved configuration, or undefined when absent.
 */
export function resolveClientConfig(raw: unknown, warn: Warn): ResolvedNotifyConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    warn('injected config is not an object; using browser notifications')
    return undefined
  }
  const base = normalizeNotifyConfig(raw, warn)
  const token = typeof raw.token === 'string' ? raw.token : ''
  const requested = base.transport
  let transport: 'popup' | 'browser' = requested === 'popup' ? 'popup' : 'browser'
  if (transport === 'popup' && token === '') {
    warn('popup transport requires a route token; using browser notifications')
    transport = 'browser'
  }
  const focusPid = typeof raw.focusPid === 'number' && Number.isSafeInteger(raw.focusPid) && raw.focusPid > 0
    ? raw.focusPid
    : 0
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    ...base,
    transport,
    token,
    focusPid,
  }
}

/**
 * Host half: inject the process-scoped configuration and token into the page,
 * expose the popup notification route, and turn a user click on the popup into
 * a one-shot activation record the page consumes when DSH regains focus.
 *
 * The popup itself is a short-lived PowerShell WinForms process; the Host only
 * spawns it and parses its stdout. Windows toast activation proved unreliable
 * in the tested developer Desktop, while this window keeps click handling,
 * focus, and multi-line content fully under our control.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord, resolveHostConfig, type ResolvedNotifyConfig } from './config'
import type { DshContext, InjectionRow } from './dsh'

/** Plugin name registered by the bundle patch. */
export const name = 'dsh-notify'

const LOG_PREFIX = '[dsh-notify]'
const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const POPUP_SCRIPT = join(MODULE_DIRECTORY, 'popup.ps1')
const NOTIFY_PATH = '/dsh-notify/notify'
const ACTIVATION_PATH = '/dsh-notify/activation'
const TOKEN_HEADER = 'x-dsh-notify-token'
const MAX_BODY_BYTES = 16 * 1024
const ACTIVATION_TTL_MS = 30_000
const MAX_SLOTS = 3

const KINDS = ['ask', 'done', 'error', 'self-test'] as const
type NotificationKind = (typeof KINDS)[number]

function warn(message: string): void {
  console.warn(`${LOG_PREFIX} ${message}`)
}

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`)
}

/** One validated notification request from the page. */
interface NotifyRequest {
  readonly id: string
  readonly kind: NotificationKind
  readonly title: string
  readonly body: string
  readonly sessionId: string
  readonly autoCloseMs: number
  readonly sound: boolean
  readonly openLabel: string
  readonly ignoreLabel: string
}

/** One consumed popup activation. */
interface Activation {
  readonly sessionId: string
  readonly at: number
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function textField(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined
}

function parseNotifyRequest(value: unknown, config: ResolvedNotifyConfig): NotifyRequest | undefined {
  if (!isRecord(value)) return undefined
  const id = textField(value.id, 120)
  const kind = value.kind
  if (id === undefined || id === '') return undefined
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return undefined
  const title = textField(value.title, 300)
  if (title === undefined || title === '') return undefined
  const body = textField(value.body, 2000) ?? ''
  const sessionId = textField(value.sessionId, 300) ?? ''
  const defaultClose = kind === 'ask' ? config.askAutoCloseMs : config.doneAutoCloseMs
  const requestedClose = typeof value.autoCloseMs === 'number' && Number.isFinite(value.autoCloseMs)
    ? value.autoCloseMs
    : defaultClose
  return {
    id,
    kind: kind as NotificationKind,
    title,
    body,
    sessionId,
    autoCloseMs: clampInt(requestedClose, 0, 600_000),
    sound: typeof value.sound === 'boolean' ? value.sound : config.sound,
    openLabel: textField(value.openLabel, 60) ?? 'Open DSH',
    ignoreLabel: textField(value.ignoreLabel, 60) ?? 'Dismiss',
  }
}

async function readRequestBody(req: IncomingMessage, limit: number): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > limit) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function respondJson(res: ServerResponse, status: number, value: unknown): void {
  const text = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers[TOKEN_HEADER]
  return typeof header === 'string' && header === token
}

function encodeArg(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

/**
 * Install the Host half.
 * @param ctx - Host plugin context.
 * @param rawConfig - Loader row configuration.
 */
export function apply(ctx: DshContext, rawConfig?: unknown): void {
  try {
    setup(ctx, rawConfig)
  } catch (error) {
    warn(`host plugin failed: ${String(error)}`)
  }
}

function setup(ctx: DshContext, rawConfig: unknown): void {
  const token = randomUUID()
  const underElectron = (process.versions as Record<string, string | undefined>).electron !== undefined
  const config = resolveHostConfig(
    rawConfig,
    { underElectron, platform: process.platform, ppid: process.ppid },
    token,
    warn,
  )
  const runtimes = new Set<ChildProcess>()
  let slots = 0
  let latestActivation: Activation | undefined

  ctx.effect(() => () => {
    for (const child of runtimes) {
      try { child.kill() } catch (error) { warn(`popup kill failed: ${String(error)}`) }
    }
    runtimes.clear()
  }, 'dsh-notify: popups')

  ctx.effect(() => ctx.on('webserver/index-inject', (table: InjectionRow[]) => {
    table.push({ kind: 'global', name: '__DSH_NOTIFY_CONFIG__', value: config })
  }), 'dsh-notify: page config')

  const spawnPopup = (request: NotifyRequest): void => {
    const slot = slots % MAX_SLOTS
    slots += 1
    const args = [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      POPUP_SCRIPT,
      '-Id',
      request.id,
      '-Kind',
      request.kind,
      '-TitleB64',
      encodeArg(request.title),
      '-BodyB64',
      encodeArg(request.body),
      '-OpenLabelB64',
      encodeArg(request.openLabel),
      '-IgnoreLabelB64',
      encodeArg(request.ignoreLabel),
      '-FocusPid',
      String(config.focusPid),
      '-AutoCloseMs',
      String(request.autoCloseMs),
      '-Sound',
      request.sound ? '1' : '0',
      '-Slot',
      String(slot),
    ]
    let child: ChildProcess
    try {
      child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      warn(`popup spawn failed: ${String(error)}`)
      return
    }
    runtimes.add(child)
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', () => { /* WinRT/module loader progress noise; exit status carries failures */ })
    child.on('error', (error) => { warn(`popup process error: ${String(error)}`) })
    // 'close' runs after stdout is drained; 'exit' can fire before the last
    // activation line arrives.
    child.on('close', (code) => {
      runtimes.delete(child)
      for (const line of stdout.split(/\r?\n/u)) {
        if (line.startsWith('activate ')) {
          if (request.sessionId !== '') {
            latestActivation = { sessionId: request.sessionId, at: Date.now() }
            log(`popup activated for session ${request.sessionId.slice(0, 8)}…`)
          }
          return
        }
      }
      if (code !== 0 && code !== null) warn(`popup exited with code ${String(code)}`)
    })
  }

  const handleNotify = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    if (!authorized(req, token)) {
      res.writeHead(403)
      res.end()
      return
    }
    const raw = await readRequestBody(req, MAX_BODY_BYTES)
    if (raw === undefined) {
      res.writeHead(413)
      res.end()
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const request = parseNotifyRequest(parsed, config)
    if (request === undefined) {
      res.writeHead(400)
      res.end()
      return
    }
    if (config.transport !== 'popup') {
      res.writeHead(503)
      res.end()
      return
    }
    spawnPopup(request)
    res.writeHead(204)
    res.end()
  }

  const handleActivation = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET' })
      res.end()
      return
    }
    if (!authorized(req, token)) {
      res.writeHead(403)
      res.end()
      return
    }
    const activation = latestActivation
    if (activation !== undefined && Date.now() - activation.at <= ACTIVATION_TTL_MS) {
      latestActivation = undefined
      respondJson(res, 200, { sessionId: activation.sessionId })
      return
    }
    latestActivation = undefined
    respondJson(res, 200, { sessionId: null })
  }

  ctx.inject(['webServer'], (scope) => {
    const server = scope.webServer
    if (server === undefined) return
    try {
      const disposeNotify = server.register({
        kind: 'exact',
        path: NOTIFY_PATH,
        handler: (req, res) => {
          void handleNotify(req, res).catch((error: unknown) => {
            warn(`notify handler failed: ${String(error)}`)
            if (!res.headersSent) {
              res.writeHead(400)
              res.end()
            } else {
              res.destroy()
            }
          })
        },
      })
      const disposeActivation = server.register({
        kind: 'exact',
        path: ACTIVATION_PATH,
        handler: handleActivation,
      })
      scope.effect(() => () => {
        disposeNotify()
        disposeActivation()
      }, 'dsh-notify: routes')
      log(`host ready (transport=${config.transport}, focusPid=${String(config.focusPid)})`)
    } catch (error) {
      warn(`route registration failed: ${String(error)}`)
    }
  })
}

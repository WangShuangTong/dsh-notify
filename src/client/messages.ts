/**
 * Pure localized copy for every notification kind. UI language follows the
 * document language DSH already sets; any non-Chinese locale falls back to
 * English. All user-facing text is produced here so the transport and planner
 * stay copy-free.
 */

import { isRecord } from '../config'
import type { PendingInteraction } from '../dsh'
import type { StatusView } from './model'

/** Supported copy languages. */
export type Lang = 'zh' | 'en'

/** One composed notification. */
export interface NotificationCopy {
  readonly title: string
  readonly body: string
  readonly openLabel: string
  readonly ignoreLabel: string
}

/** Item shape of a structured user question, read defensively. */
interface QuestionInfo {
  readonly text: string
  readonly options: readonly string[]
  readonly remaining: number
}

const APP = 'DSH'
const SESSION_TITLE_MAX = 60
const REASON_MAX = 120
const QUESTION_MAX = 200
const MESSAGE_MAX = 120
const BODY_MAX = 300

/**
 * Pick the copy language from the document language tag.
 * @param tag - value of `document.documentElement.lang`.
 * @returns Chinese for a Chinese tag, English otherwise.
 */
export function languageOf(tag: string | undefined): Lang {
  return tag !== undefined && tag.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * Human-facing Session label with fallbacks.
 * @param summary - list row, when the Session is listed.
 * @param sessionId - Session identity fallback.
 * @returns a non-empty display title.
 */
export function sessionTitleOf(
  summary: { readonly displayTitle?: string; readonly title?: string } | undefined,
  sessionId: string,
): string {
  const title = summary?.displayTitle ?? summary?.title
  if (title !== undefined && title.trim() !== '') return truncateText(title.trim(), SESSION_TITLE_MAX)
  return sessionId.length > 10 ? `${sessionId.slice(0, 8)}…` : sessionId
}

/**
 * Normalize whitespace and cap a text at a maximum length.
 * @param text - source text.
 * @param max - maximum characters kept.
 * @returns the compacted text.
 */
export function truncateText(text: string, max: number): string {
  const compact = text.replace(/\s+/gu, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 1))}…`
}

function sessionLine(title: string, lang: Lang): string {
  return lang === 'zh' ? `会话：${title}` : `Session: ${title}`
}

function toolLine(name: string, lang: Lang): string {
  return lang === 'zh' ? `工具：${truncateText(name, 60)}` : `Tool: ${truncateText(name, 60)}`
}

function resolveDisplayReason(pending: PendingInteraction, lang: Lang): string | undefined {
  const display = pending.displayReason
  if (display !== undefined) {
    const preferred = lang === 'zh' ? ['zh', 'zh-CN', 'zh-Hans'] : ['en']
    for (const key of preferred) {
      const value = display[key]
      if (typeof value === 'string' && value.trim() !== '') return truncateText(value, REASON_MAX)
    }
    for (const value of Object.values(display)) {
      if (typeof value === 'string' && value.trim() !== '') return truncateText(value, REASON_MAX)
    }
  }
  return pending.reason !== undefined && pending.reason.trim() !== ''
    ? truncateText(pending.reason, REASON_MAX)
    : undefined
}

function readQuestion(pending: PendingInteraction): QuestionInfo {
  const questions = Array.isArray(pending.questions) ? pending.questions : []
  const first = questions.length > 0 && isRecord(questions[0]) ? questions[0] : undefined
  const text = first !== undefined && typeof first.question === 'string'
    ? truncateText(first.question, QUESTION_MAX)
    : ''
  const rawOptions = first !== undefined && Array.isArray(first.options) ? first.options : []
  const options: string[] = []
  for (const option of rawOptions) {
    if (!isRecord(option)) continue
    const label = option.label
    if (typeof label === 'string' && label.trim() !== '') options.push(truncateText(label, 30))
  }
  return { text, options, remaining: Math.max(0, questions.length - 1) }
}

function askBody(pending: PendingInteraction, sessionTitle: string, lang: Lang): string[] {
  const lines: string[] = [sessionLine(sessionTitle, lang)]
  const info = readQuestion(pending)
  if (info.text !== '') lines.push(info.text)
  if (info.options.length > 0) {
    lines.push(lang === 'zh'
      ? `选项：${info.options.slice(0, 3).join(' / ')}`
      : `Options: ${info.options.slice(0, 3).join(' / ')}`)
  }
  if (info.remaining > 0) lines.push(lang === 'zh' ? `还有 ${String(info.remaining)} 个问题` : `${String(info.remaining)} more question(s)`)
  return lines
}

function finish(title: string, lines: readonly string[], lang: Lang): NotificationCopy {
  const compact = lines
    .map(line => truncateText(line, BODY_MAX))
    .filter(line => line !== '')
  let body = compact.join('\n')
  if (body.length > BODY_MAX) body = `${body.slice(0, Math.max(0, BODY_MAX - 1))}…`
  return {
    title: `${APP} · ${truncateText(title, 60)}`,
    body,
    openLabel: lang === 'zh' ? '打开 DSH' : 'Open DSH',
    ignoreLabel: lang === 'zh' ? '忽略' : 'Dismiss',
  }
}

/**
 * Compose an approval / question / plan-review notification.
 * @param pending - the pending interaction value published by DSH.
 * @param sessionTitle - display title of the owning Session.
 * @param lang - copy language.
 * @returns the composed notification.
 */
export function askCopy(pending: PendingInteraction, sessionTitle: string, lang: Lang): NotificationCopy {
  if (pending.kind === 'approval') {
    const lines = [sessionLine(sessionTitle, lang)]
    if (pending.toolName !== undefined && pending.toolName !== '') lines.push(toolLine(pending.toolName, lang))
    const reason = resolveDisplayReason(pending, lang)
    if (reason !== undefined) lines.push(reason)
    return finish(lang === 'zh' ? '需要你的批准' : 'Approval needed', lines, lang)
  }
  if (pending.kind === 'plan-review') {
    return finish(lang === 'zh' ? '计划等待确认' : 'Plan awaiting review', askBody(pending, sessionTitle, lang), lang)
  }
  return finish(lang === 'zh' ? '在等你回答' : 'A question is waiting', askBody(pending, sessionTitle, lang), lang)
}

/**
 * Compose a completion notification, merged when several Sessions finished.
 * @param sessionTitles - display titles of the finished Sessions.
 * @param lang - copy language.
 * @returns the composed notification.
 */
export function doneCopy(sessionTitles: readonly string[], lang: Lang): NotificationCopy {
  const titles = sessionTitles.map(title => truncateText(title, SESSION_TITLE_MAX))
  if (titles.length > 1) {
    const heading = lang === 'zh'
      ? `${String(titles.length)} 个会话已完成`
      : `${String(titles.length)} sessions finished`
    return finish(heading, [titles.join(lang === 'zh' ? '、' : ', ')], lang)
  }
  return finish(lang === 'zh' ? '任务完成' : 'Turn complete', [sessionLine(titles[0] ?? '', lang)], lang)
}

/**
 * Compose an error notification.
 * @param sessionTitle - display title of the failed Session.
 * @param message - user-safe failure chain reported by DSH.
 * @param lang - copy language.
 * @returns the composed notification.
 */
export function errorCopy(sessionTitle: string, message: string, lang: Lang): NotificationCopy {
  const lines = [sessionLine(sessionTitle, lang)]
  const compact = truncateText(message, MESSAGE_MAX)
  if (compact !== '') lines.push(compact)
  return finish(lang === 'zh' ? '任务出错' : 'Turn failed', lines, lang)
}

/**
 * Compose the one-time enablement notification.
 * @param lang - copy language.
 * @returns the composed notification.
 */
export function selfTestCopy(lang: Lang): NotificationCopy {
  return finish(
    lang === 'zh' ? '通知已启用' : 'Notifications are on',
    lang === 'zh'
      ? ['切到其他程序时，DSH 需要你处理或完成任务时会在这里提醒。']
      : ['When you switch away, DSH will remind you here when it needs you or finishes a turn.'],
    lang,
  )
}

/**
 * Snapshot the status map into the planner's view.
 * @param snapshot - DSH status snapshot.
 * @returns one view per Session.
 */
export function viewsOf(snapshot: ReadonlyMap<string, { running: boolean | undefined; pendingInteraction: PendingInteraction | undefined }>): Map<string, StatusView> {
  const views = new Map<string, StatusView>()
  for (const [sessionId, status] of snapshot) {
    views.set(sessionId, { running: status.running, pending: status.pendingInteraction })
  }
  return views
}

/**
 * Presentation rules for the usage strip, kept pure so they can be tested
 * without React: how much of a window is left, how alarming that is, which
 * window is binding, and how a reset instant reads in Chinese.
 *
 * `percent` on the wire is the **used** share; every helper here converts once,
 * at the boundary, so no caller has to remember which way round it is.
 */

import { USAGE_WINDOW_KEYS, type UsageWindow, type UsageWindowKey, type UsageWindows } from '../rpc-contract.ts'

/** Which tone a window is displayed in. */
export type WindowTone = 'ok' | 'warning' | 'blocked'

/** Chinese labels owned by the browser half. */
export const WINDOW_LABELS: Readonly<Record<UsageWindowKey, string>> = {
  rolling: '5小时',
  weekly: '周',
  monthly: '月',
}

/**
 * Remaining share of a window, 0–100.
 * @param window - the window.
 * @returns the remaining percent.
 */
export function remainingPercent(window: UsageWindow): number {
  return clamp(100 - window.percent)
}

/**
 * Tone for a window: a rate-limited window is blocked regardless of percent;
 * otherwise the remaining share decides.
 * @param window - the window.
 * @returns the tone.
 */
export function windowTone(window: UsageWindow): WindowTone {
  if (window.status === 'rate-limited') return 'blocked'
  const remaining = remainingPercent(window)
  if (remaining <= 10) return 'blocked'
  if (remaining <= 30) return 'warning'
  return 'ok'
}

/** Colours per tone, shared by every chip. */
export const TONE_COLORS: Readonly<Record<WindowTone, { fg: string; bar: string; bg: string }>> = {
  ok: { fg: '#1f7a4d', bar: '#34a06a', bg: 'rgba(52,160,106,0.12)' },
  warning: { fg: '#9a6b10', bar: '#d99a1f', bg: 'rgba(217,154,31,0.14)' },
  blocked: { fg: '#a3352b', bar: '#c9503f', bg: 'rgba(201,80,63,0.14)' },
}

/**
 * The binding window of an account: the one that will stop work first — the
 * highest used share, with a rate-limited window always winning.
 * @param windows - the account's windows.
 * @returns the binding key.
 */
export function bindingWindowKey(windows: UsageWindows): UsageWindowKey {
  let best: UsageWindowKey = USAGE_WINDOW_KEYS[0]
  let bestScore = -1
  for (const key of USAGE_WINDOW_KEYS) {
    const window = windows[key]
    const score = window.status === 'rate-limited' ? 1_000 + window.percent : window.percent
    if (score > bestScore) {
      bestScore = score
      best = key
    }
  }
  return best
}

/**
 * The reset instant of the binding window.
 * @param windows - the account's windows.
 * @returns the ISO instant.
 */
export function bindingResetAt(windows: UsageWindows): string {
  return windows[bindingWindowKey(windows)].resetsAt
}

/**
 * Render a reset instant as a short relative countdown.
 * @param resetsAt - the ISO instant.
 * @param nowMs - current epoch milliseconds.
 * @returns text such as `2小时10分 后`, `3天 后`, or `已到重置点`.
 */
export function formatReset(resetsAt: string, nowMs: number): string {
  const target = Date.parse(resetsAt)
  if (!Number.isFinite(target)) return '重置时间未知'
  const deltaMs = target - nowMs
  if (deltaMs <= 0) return '已到重置点'
  const minutes = Math.floor(deltaMs / 60_000)
  const days = Math.floor(minutes / (60 * 24))
  if (days >= 1) return `${String(days)}天 后`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours >= 1) return restMinutes > 0 ? `${String(hours)}小时${String(restMinutes)}分 后` : `${String(hours)}小时 后`
  return `${String(Math.max(minutes, 1))}分 后`
}

/**
 * Render an instant as a local `HH:MM` clock time.
 * @param iso - the ISO instant.
 * @returns the clock text, or an empty string when unparsable.
 */
export function formatClock(iso: string): string {
  const instant = Date.parse(iso)
  if (!Number.isFinite(instant)) return ''
  const date = new Date(instant)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

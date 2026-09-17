/**
 * Browser/host contract for the OpenCode Go usage strip: one channel, two
 * endpoints, and the payload shape both halves validate before use.
 *
 * `percent` is always the **used** share of a window, exactly as the upstream
 * `GET /zen/go/v1/usage` endpoint reports it; every consumer derives the
 * remaining share as `100 - percent`, so a display bug can never turn usage
 * into headroom.
 */

export const OPENCODE_GO_USAGE_CHANNEL = '/opencode-go-usage'
export const OPENCODE_GO_USAGE_PROTOCOL_VERSION = 1 as const

/** Read the cached account snapshot (refreshing only what the TTL expired). */
export const OPENCODE_GO_USAGE_ENDPOINT = 'usage'
/** Force an upstream re-read for every account, bypassing the TTL. */
export const OPENCODE_GO_USAGE_REFRESH_ENDPOINT = 'refresh'

/** Upstream origin every managed route is expected to live on. */
export const OPENCODE_GO_USAGE_ORIGIN = 'https://opencode.ai/zen/go/v1'

/** Upstream path appended to the origin. */
export const OPENCODE_GO_USAGE_PATH = '/usage'

/** The three rolling windows the upstream endpoint reports. */
export const USAGE_WINDOW_KEYS = ['rolling', 'weekly', 'monthly'] as const

export type UsageWindowKey = typeof USAGE_WINDOW_KEYS[number]

/** Chinese labels are owned by the browser half; this is only the wire key. */
export type UsageWindowStatus = 'ok' | 'rate-limited'

/** One upstream usage window. */
export interface UsageWindow {
  status: UsageWindowStatus
  /** Used share of the window, 0–100. */
  percent: number
  /** ISO instant the window rolls over. */
  resetsAt: string
}

/** All three windows of one account. */
export type UsageWindows = Record<UsageWindowKey, UsageWindow>

/** A non-2xx or unparsable upstream answer, normalized for display. */
export interface UsageError {
  /** Upstream error code (`CreditsError`, `GoUsageLimitError`, …) or a local code. */
  type: string
  message: string
}

/** One OpenCode Go account: the routes it backs plus its latest known windows. */
export interface UsageAccount {
  /** Stable identity (the credential reference). */
  id: string
  /** Human label derived from the route display names, e.g. `OpenCodeGo_1`. */
  label: string
  /** The settings credential reference this account is resolved through. */
  apiKeyEnv: string
  /** Masked credential, enough to tell two same-labelled accounts apart. */
  maskedKey: string
  /** Model route keys in `llm-pi-ai.providers` that share this credential. */
  providers: readonly string[]
  /** Model ids served by those routes. */
  models: readonly string[]
  /** Upstream origin the routes point at. */
  origin: string
  /** Latest known windows, or null when nothing has been read yet. */
  windows: UsageWindows | null
  /** Latest read failure; null after a successful read. */
  error: UsageError | null
  /** When `windows`/`error` were last refreshed (ISO), or null before the first read. */
  fetchedAt: string | null
}

/** One full answer for the browser half. */
export interface UsageSnapshot {
  protocolVersion: typeof OPENCODE_GO_USAGE_PROTOCOL_VERSION
  /** When this answer was assembled (ISO). */
  fetchedAt: string
  /** Every OpenCode Go account this host knows about, in stable order. */
  accounts: readonly UsageAccount[]
}

/** Both endpoints take the same versioned request. */
export interface UsageRequest {
  protocolVersion: typeof OPENCODE_GO_USAGE_PROTOCOL_VERSION
}

export function isUsageRequest(value: unknown): value is UsageRequest {
  return hasExactKeys(value, ['protocolVersion'])
    && value.protocolVersion === OPENCODE_GO_USAGE_PROTOCOL_VERSION
}

export function isUsageSnapshot(value: unknown): value is UsageSnapshot {
  if (!hasExactKeys(value, ['protocolVersion', 'fetchedAt', 'accounts'])) return false
  if (value.protocolVersion !== OPENCODE_GO_USAGE_PROTOCOL_VERSION) return false
  if (typeof value.fetchedAt !== 'string') return false
  if (!Array.isArray(value.accounts)) return false
  return value.accounts.every(isUsageAccount)
}

export function isUsageAccount(value: unknown): value is UsageAccount {
  if (!hasExactKeys(value, [
    'id', 'label', 'apiKeyEnv', 'maskedKey', 'providers', 'models', 'origin', 'windows', 'error', 'fetchedAt',
  ])) return false
  return typeof value.id === 'string'
    && typeof value.label === 'string'
    && typeof value.apiKeyEnv === 'string'
    && typeof value.maskedKey === 'string'
    && isStringArray(value.providers)
    && isStringArray(value.models)
    && typeof value.origin === 'string'
    && (value.windows === null || isUsageWindows(value.windows))
    && (value.error === null || isUsageError(value.error))
    && (value.fetchedAt === null || typeof value.fetchedAt === 'string')
}

/**
 * Whether a value carries all three windows. Deliberately tolerant of unknown
 * extra keys: the upstream may add a window without notice, and failing the
 * whole read over an unrecognized sibling would hide data the strip can still
 * show. (Account objects, which this plugin builds itself, stay strict.)
 */
export function isUsageWindows(value: unknown): value is UsageWindows {
  if (!isRecord(value)) return false
  return USAGE_WINDOW_KEYS.every(key => isUsageWindow((value as Record<string, unknown>)[key]))
}

export function isUsageWindow(value: unknown): value is UsageWindow {
  if (!hasExactKeys(value, ['status', 'percent', 'resetsAt'])) return false
  return (value.status === 'ok' || value.status === 'rate-limited')
    && typeof value.percent === 'number'
    && Number.isFinite(value.percent)
    && value.percent >= 0
    && value.percent <= 100
    && typeof value.resetsAt === 'string'
}

export function isUsageError(value: unknown): value is UsageError {
  return hasExactKeys(value, ['type', 'message'])
    && typeof value.type === 'string'
    && typeof value.message === 'string'
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length !== keys.length) return false
  return keys.every(key => Object.hasOwn(value, key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

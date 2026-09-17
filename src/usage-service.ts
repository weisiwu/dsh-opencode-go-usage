/**
 * Host-side OpenCode Go usage reader: fetch `GET {origin}/usage` per account
 * with a TTL cache and single-flight collapsing, so several strips polling at
 * once cost one request per account.
 *
 * This module owns no filesystem or YAML knowledge (see `settings.ts` for
 * that); every side effect is injectable, so it is exercised in tests without a
 * network.
 */

import type { AccountSeed } from './routes.ts'
import { maskSecret } from './routes.ts'
import {
  OPENCODE_GO_USAGE_PATH,
  USAGE_WINDOW_KEYS,
  isUsageWindows,
  type UsageAccount,
  type UsageError,
  type UsageWindows,
} from './rpc-contract.ts'

/** Default cache lifetime: the upstream windows move slowly, 60s is plenty. */
export const DEFAULT_TTL_MS = 60_000

/** Default per-request timeout. */
export const DEFAULT_TIMEOUT_MS = 15_000

/** Identifies this client to the upstream, as the Go terms of use require. */
export const USER_AGENT = 'dsh-opencode-go-usage/0.1.0'

/** The subset of `fetch` this service uses. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** Dependencies of {@link createUsageReader}. */
export interface UsageReaderOptions {
  fetcher?: Fetcher
  now?: () => number
  ttlMs?: number
  timeoutMs?: number
  userAgent?: string
}

/** One account's cached read. */
interface CacheEntry {
  at: number
  windows: UsageWindows | null
  error: UsageError | null
  fetchedAt: string | null
}

/** Resolves credential references; returns undefined when a reference is unset. */
export type SecretResolver = (ref: string) => Promise<string | undefined>

/** The reader returned by {@link createUsageReader}. */
export interface UsageReader {
  /**
   * Read every account, serving entries younger than the TTL from cache.
   * @param seeds - accounts to read.
   * @param secrets - credential resolver.
   * @param options - `force` bypasses the TTL.
   * @returns one account entry per seed, in seed order.
   */
  read(seeds: readonly AccountSeed[], secrets: SecretResolver, options?: { force?: boolean }): Promise<UsageAccount[]>
}

/**
 * Build the usage reader.
 * @param options - injectable clock, fetcher, TTL and timeout.
 * @returns the reader.
 */
export function createUsageReader(options: UsageReaderOptions = {}): UsageReader {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  const now = options.now ?? (() => Date.now())
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const userAgent = options.userAgent ?? USER_AGENT
  const cache = new Map<string, CacheEntry>()
  const flights = new Map<string, Promise<CacheEntry>>()

  const readShared = async (seed: AccountSeed, secret: string, force: boolean): Promise<CacheEntry> => {
    const cached = cache.get(seed.apiKeyEnv)
    if (!force && cached !== undefined && now() - cached.at < ttlMs) return cached
    const pending = flights.get(seed.apiKeyEnv)
    if (pending !== undefined) return await pending

    const flight = (async (): Promise<CacheEntry> => {
      const entry = await readOne(seed, secret, { fetcher, timeoutMs, userAgent, now })
      cache.set(seed.apiKeyEnv, entry)
      return entry
    })()
    flights.set(seed.apiKeyEnv, flight)
    try {
      return await flight
    } finally {
      flights.delete(seed.apiKeyEnv)
    }
  }

  return {
    async read(seeds, secrets, readOptions = {}) {
      const force = readOptions.force === true
      return await Promise.all(seeds.map(async (seed): Promise<UsageAccount> => {
        const base = {
          id: seed.apiKeyEnv,
          label: seed.label,
          apiKeyEnv: seed.apiKeyEnv,
          providers: seed.providers,
          models: seed.models,
          origin: seed.origin,
        }
        const secret = await secrets(seed.apiKeyEnv)
        if (secret === undefined) {
          return {
            ...base,
            maskedKey: '',
            windows: null,
            error: { type: 'credential-missing', message: `未找到凭据 ${seed.apiKeyEnv}。` },
            fetchedAt: null,
          }
        }
        const entry = await readShared(seed, secret, force)
        return { ...base, maskedKey: maskSecret(secret), ...entry }
      }))
    },
  }
}

/** Read one account from upstream, never throwing. */
async function readOne(
  seed: AccountSeed,
  secret: string,
  context: { fetcher: Fetcher; timeoutMs: number; userAgent: string; now: () => number },
): Promise<CacheEntry> {
  const at = context.now()
  const fetchedAt = new Date(at).toISOString()
  const url = `${seed.origin}${OPENCODE_GO_USAGE_PATH}`
  try {
    const response = await context.fetcher(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
        'User-Agent': context.userAgent,
      },
      signal: AbortSignal.timeout(context.timeoutMs),
    })
    const body = await readJson(response)
    if (!response.ok) return { at, windows: null, error: upstreamError(response.status, body), fetchedAt }
    const windows = usageWindowsOf(body)
    if (windows === undefined) {
      return {
        at,
        windows: null,
        error: { type: 'invalid-response', message: '上游返回了无法识别的额度结构。' },
        fetchedAt,
      }
    }
    return { at, windows, error: null, fetchedAt }
  } catch (error) {
    return { at, windows: null, error: describeTransportError(error), fetchedAt }
  }
}

/**
 * Extract the windows from an upstream payload, accepting both the documented
 * `{ usage: { rolling, weekly, monthly } }` envelope and a bare window object.
 * @param body - the decoded JSON body.
 * @returns the windows, or undefined when the shape is unrecognized.
 */
export function usageWindowsOf(body: unknown): UsageWindows | undefined {
  if (!isRecord(body)) return undefined
  const usage = body.usage
  if (usage === undefined) return isUsageWindows(body) ? body : undefined
  return isUsageWindows(usage) ? usage : undefined
}

/**
 * Normalize an upstream error payload into the contract's error shape.
 * @param status - the HTTP status.
 * @param body - the decoded JSON body, when any.
 * @returns the normalized error.
 */
export function upstreamError(status: number, body: unknown): UsageError {
  if (isRecord(body) && isRecord(body.error)) {
    const type = typeof body.error.type === 'string' ? body.error.type : `http-${String(status)}`
    const message = typeof body.error.message === 'string' ? body.error.message : `HTTP ${String(status)}`
    return { type, message }
  }
  return { type: `http-${String(status)}`, message: `HTTP ${String(status)}` }
}

/** Normalize a transport failure. */
function describeTransportError(error: unknown): UsageError {
  if (error instanceof Error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError'
    return {
      type: timedOut ? 'timeout' : 'network',
      message: timedOut ? '读取额度超时。' : `读取额度失败：${error.message}`,
    }
  }
  return { type: 'network', message: `读取额度失败：${String(error)}` }
}

/** Read a JSON body, tolerating an empty or non-JSON one. */
async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text()
    if (text.trim().length === 0) return undefined
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Re-exported for callers that only import this module. */
export { USAGE_WINDOW_KEYS }

/**
 * Host-side RPC surface of the usage strip: one channel answering with the
 * current per-account usage snapshot, plus a forced-refresh endpoint.
 *
 * Both endpoints answer with the whole account table rather than a single
 * account: the browser half already knows which route its session selected, and
 * a table costs one round trip when several sessions are open.
 */

import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { AccountSeed } from './routes.ts'
import {
  OPENCODE_GO_USAGE_CHANNEL,
  OPENCODE_GO_USAGE_ENDPOINT,
  OPENCODE_GO_USAGE_PROTOCOL_VERSION,
  OPENCODE_GO_USAGE_REFRESH_ENDPOINT,
  isUsageRequest,
  type UsageSnapshot,
} from './rpc-contract.ts'
import { createUsageReader, type SecretResolver, type UsageReader } from './usage-service.ts'

/** The result envelope the connection layer expects. */
type RpcResult = Awaited<ReturnType<ConnectionRpcHandler>>

/** Dependencies of {@link createUsageRpcHandler}. */
export interface UsageRpcOptions {
  /** Discover the accounts declared by the current settings (re-read per call). */
  loadAccounts: () => Promise<AccountSeed[]>
  /** Resolve a credential reference to its value. */
  resolveSecret: SecretResolver
  /** Injectable reader (tests pass a stub). */
  reader?: UsageReader
  /** Injectable clock. */
  now?: () => number
}

/**
 * Register the usage channel on the host connection.
 * @param connection - the host connection handle.
 * @param options - account loader and credential resolver.
 * @returns the disposer returned by the connection service.
 */
export function registerUsageRpc(
  connection: HostConnectionHandle,
  options: UsageRpcOptions,
): () => Promise<void> {
  return connection.rpc.handle(OPENCODE_GO_USAGE_CHANNEL, createUsageRpcHandler(options))
}

/**
 * Build the channel handler.
 * @param options - account loader and credential resolver.
 * @returns the handler.
 */
export function createUsageRpcHandler(options: UsageRpcOptions): ConnectionRpcHandler {
  const now = options.now ?? (() => Date.now())

  return async (endpoint, payload) => {
    const refresh = endpoint === OPENCODE_GO_USAGE_REFRESH_ENDPOINT
    if (!refresh && endpoint !== OPENCODE_GO_USAGE_ENDPOINT) {
      return badRequest(`未知的额度接口 ${JSON.stringify(endpoint)}。`)
    }
    if (!isUsageRequest(payload)) return badRequest('额度请求参数无效。')

    const reader = options.reader ?? createUsageReader({ now })
    try {
      const seeds = await options.loadAccounts()
      const accounts = await reader.read(seeds, options.resolveSecret, { force: refresh })
      const snapshot: UsageSnapshot = {
        protocolVersion: OPENCODE_GO_USAGE_PROTOCOL_VERSION,
        fetchedAt: new Date(now()).toISOString(),
        accounts,
      }
      return { ok: true, value: snapshot } as RpcResult
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return internal(`读取额度失败：${message}`)
    }
  }
}

function badRequest(message: string): RpcResult {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } } as RpcResult
}

function internal(message: string): RpcResult {
  return { ok: false, error: { code: 'internal', message, details: {} } } as RpcResult
}

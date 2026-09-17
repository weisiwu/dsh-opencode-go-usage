/**
 * Browser-side call into the host usage channel, with the same validation the
 * host applies on the way out: a snapshot that does not match the contract is
 * rejected here rather than rendered.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  OPENCODE_GO_USAGE_CHANNEL,
  OPENCODE_GO_USAGE_ENDPOINT,
  OPENCODE_GO_USAGE_PROTOCOL_VERSION,
  OPENCODE_GO_USAGE_REFRESH_ENDPOINT,
  isUsageSnapshot,
  type UsageSnapshot,
} from '../rpc-contract.ts'

/**
 * Read the account table from the host.
 * @param connection - the browser connection handle.
 * @param options - `force` bypasses the host cache; `signal` cancels.
 * @returns the validated snapshot.
 * @throws Error when the host refuses or answers an incompatible payload.
 */
export async function loadUsage(
  connection: ConnectionHandle,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<UsageSnapshot> {
  const endpoint = options.force === true ? OPENCODE_GO_USAGE_REFRESH_ENDPOINT : OPENCODE_GO_USAGE_ENDPOINT
  const result = await connection.rpc.call(
    OPENCODE_GO_USAGE_CHANNEL,
    endpoint,
    { protocolVersion: OPENCODE_GO_USAGE_PROTOCOL_VERSION },
    options.signal,
  )
  if (!result.ok) throw new Error(result.error.message)
  if (!isUsageSnapshot(result.value)) throw new Error('后端返回了不兼容的额度数据。')
  return result.value
}

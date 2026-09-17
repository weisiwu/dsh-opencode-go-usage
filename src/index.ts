/**
 * Host half of the DSH OpenCode Go usage plugin.
 *
 * It owns everything the browser must not: locating the harness home, reading
 * `settings.yaml` and `.credentials.yaml`, and calling the upstream usage
 * endpoint. The browser half only ever receives already-masked account data
 * across the `/opencode-go-usage` channel.
 */

import type {} from '@deepseek-ai/dsh-client-connection'
import type { Context } from '@deepseek-ai/cordis'
import { registerUsageRpc } from './rpc.ts'
import { createSecretResolver, discoverAccounts, resolveDshHome } from './settings.ts'

export const name = 'dsh-opencode-go-usage'

/** The connection service carries the channel; nothing else is required. */
export const inject = ['connection']

/**
 * Plugin body: mount the usage channel.
 * @param ctx - host root context.
 */
export function apply(ctx: Context): void {
  const homeDir = resolveDshHome()
  const resolveSecret = createSecretResolver({ homeDir })

  ctx.effect(
    () => registerUsageRpc(ctx.connection, {
      loadAccounts: async () => await discoverAccounts(homeDir),
      resolveSecret,
    }),
    'dsh-opencode-go-usage: RPC channel',
  )
}

export { collectGoRoutes, groupAccounts, accountLabel, maskSecret } from './routes.ts'
export { createUsageReader, usageWindowsOf, upstreamError } from './usage-service.ts'
export { createSecretResolver, discoverAccounts, parseCredentialRefs, resolveDshHome } from './settings.ts'
export type { AccountSeed, GoRoute } from './routes.ts'
export type { UsageAccount, UsageError, UsageSnapshot, UsageWindow, UsageWindows } from './rpc-contract.ts'

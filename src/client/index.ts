/**
 * Browser half of the DSH OpenCode Go usage plugin: the resident strip under
 * the composer card.
 *
 * The strip is registered into `conversation.composer.dock` — the ambient list
 * directly below the composer card — and reads the Session's durable
 * model-selection projection to decide which account to show. It performs no
 * network or filesystem work of its own: everything comes back through the host
 * channel, already masked.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the SlotMap merge that declares 'conversation.composer.dock'.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext, SessionId } from './context.ts'
import { UsageStrip, type UsageStripInjected } from './UsageStrip.tsx'
import { createSelectionSource } from './model-selection.ts'

export const inject = ['slots', 'connection', 'sessions']

/**
 * Client plugin body: mount the quota strip in the composer dock.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.inject(['slots', 'connection', 'sessions'], (scope: ClientContext) => {
    const connection = scope.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) return

    scope.effect(() => scope.slots.register({
      name: 'conversation.composer.dock',
      id: 'opencode-go-usage',
      order: 30,
      inject: (sessionId: SessionId): UsageStripInjected => ({
        connection,
        selection: createSelectionSource(scope, sessionId),
      }),
    }, UsageStrip), 'dsh-opencode-go-usage: quota strip')
  })
}

export { UsageStrip, POLL_INTERVAL_MS } from './UsageStrip.tsx'
export { createSelectionSource, selectionOf } from './model-selection.ts'
export { loadUsage } from './usage-client.ts'
export type { ClientContext, SessionId } from './context.ts'
export {
  TONE_COLORS, WINDOW_LABELS, bindingResetAt, bindingWindowKey, formatClock, formatReset,
  remainingPercent, windowTone,
} from './format.ts'

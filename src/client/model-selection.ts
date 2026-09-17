/**
 * Browser-side view of the Session's durable model-selection projection.
 *
 * The strip must follow the model the user is *about to* use, not the one the
 * last completed request used: `next` (a pending switch) wins over `lastUsed`.
 * `useSyncExternalStore` demands reference stability, so the derived selection
 * is memoized against the raw projection reference — without that, every render
 * would hand React a fresh object and loop.
 */

import type { ClientContext, ObservableSnapshot, SessionId } from './context.ts'

/** The provider/model a session is pointed at. */
export interface ModelSelectionSnapshot {
  provider: string
  model: string
}

/** Raw projection value as published by the session-controller. */
interface ModelSelectionProjection {
  lastUsed?: unknown
  next?: unknown
}

/** A face the strip can bind with `useSyncExternalStore`. */
export type SelectionSource = ObservableSnapshot<ModelSelectionSnapshot | undefined>

/**
 * Resolve the model-selection face for a session.
 * @param ctx - client root context.
 * @param sessionId - the owning session.
 * @returns an identity-stable, always-defined face.
 */
export function createSelectionSource(ctx: ClientContext, sessionId: SessionId): SelectionSource {
  const resolve = (): ObservableSnapshot<unknown> | undefined =>
    ctx.sessions.binding(sessionId)?.session.projections.faceOf('modelSelection')

  let face = resolve()
  let raw: unknown
  let derived: ModelSelectionSnapshot | undefined
  let detach: (() => void) | undefined
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const ensure = (): ObservableSnapshot<unknown> | undefined => {
    if (face !== undefined) return face
    face = resolve()
    if (face !== undefined) detach = face.subscribe(notify)
    return face
  }

  return {
    getSnapshot() {
      const next = ensure()?.getSnapshot()
      if (next !== raw) {
        raw = next
        derived = selectionOf(next)
      }
      return derived
    },
    subscribe(listener) {
      listeners.add(listener)
      if (detach === undefined) {
        const current = ensure()
        if (current !== undefined) detach = current.subscribe(notify)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && detach !== undefined) {
          detach()
          detach = undefined
        }
      }
    },
  }
}

/**
 * Pick the effective selection out of a raw projection value.
 * @param value - the raw `modelSelection` projection snapshot.
 * @returns the pending selection, else the last used one, else undefined.
 */
export function selectionOf(value: unknown): ModelSelectionSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const projection = value as ModelSelectionProjection
  return normalize(projection.next) ?? normalize(projection.lastUsed)
}

function normalize(candidate: unknown): ModelSelectionSnapshot | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const { provider, model } = candidate as { provider?: unknown; model?: unknown }
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  if (typeof model !== 'string' || model.length === 0) return undefined
  return { provider, model }
}

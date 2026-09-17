/**
 * The slice of the client runtime this plugin actually uses, declared
 * structurally.
 *
 * Why not import it: the harness ships its client half through the shell's
 * frozen module table, and `@deepseek-ai/dsh-client-runtime` is not among the
 * packages published in the harness's own release train — depending on it would
 * pin this plugin to a version that cannot be installed next to the packages
 * that *are* published. The declarations here are erased at build time, so they
 * cost the bundle nothing; the slot names they check against are the real
 * `SlotMap`, merged by `@deepseek-ai/dsh-client-ui-slots` and its consumers.
 */

import type { SlotMap } from '@deepseek-ai/dsh-client-ui-slots'

/** A session identifier; the harness brands it, structurally it is a string. */
export type SessionId = string

/** The two-method observable shape the projection store hands out. */
export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** One session's projection faces. */
export interface ProjectionsFace {
  faceOf(key: string): ObservableSnapshot<unknown>
}

/** The per-session binding the client runtime exposes. */
export interface SessionBinding {
  session: { projections: ProjectionsFace }
}

/** The `sessions` client service, narrowed to the binding lookup. */
export interface SessionsFace {
  binding(sessionId: SessionId): SessionBinding | undefined
}

/** One slot registration. */
export interface SlotRegistration {
  /** A name declared in the merged `SlotMap`; a typo here fails the build. */
  name: keyof SlotMap & string
  /** Stable entry id, unique within the slot. */
  id: string
  /** Ascending render order. */
  order?: number
  /** Entry-scoped props, computed per session (the framework supplies the id). */
  inject?: (sessionId: SessionId) => object
}

/** The `slots` client service, narrowed to what a resident entry needs. */
export interface SlotsFace {
  register(registration: SlotRegistration, component: unknown): () => void
  inject(name: keyof SlotMap & string, callback: () => void): void
}

/** The client root context. */
export interface ClientContext {
  get(name: string): unknown
  inject(names: readonly string[], callback: (scope: ClientContext) => void): void
  effect(callback: () => void | (() => void), label?: string): void
  slots: SlotsFace
  sessions: SessionsFace
}

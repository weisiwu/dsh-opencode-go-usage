/**
 * The resident quota strip: one row under the composer card showing the
 * OpenCode Go account behind the session's currently selected route — its
 * remaining share of the 5-hour, weekly and monthly windows, the binding
 * window's reset countdown, and any read failure.
 *
 * The strip renders nothing at all unless the selected provider is one of the
 * discovered Go routes, so every other model in the harness is untouched.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createElement, type CSSProperties, type ReactNode } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { USAGE_WINDOW_KEYS, type UsageAccount, type UsageSnapshot, type UsageWindowKey } from '../rpc-contract.ts'
import {
  TONE_COLORS,
  WINDOW_LABELS,
  bindingWindowKey,
  bindingResetAt,
  formatClock,
  formatReset,
  remainingPercent,
  windowTone,
} from './format.ts'
import type { SelectionSource } from './model-selection.ts'
import { loadUsage } from './usage-client.ts'

/** Poll interval for the resident strip. */
export const POLL_INTERVAL_MS = 60_000

/** Props injected by the client plugin's slot registration. */
export interface UsageStripInjected {
  connection: ConnectionHandle
  selection: SelectionSource
}

/**
 * Which account the strip shows for a session's selected provider: the one
 * whose route list contains it, or undefined when the selection is not an
 * OpenCode Go route at all (the strip renders nothing in that case).
 * @param provider - the session's selected provider id.
 * @param snapshot - the latest host snapshot, or null before the first read.
 * @returns the account to display, when there is one.
 */
export function selectAccount(
  provider: string | undefined,
  snapshot: UsageSnapshot | null,
): UsageAccount | undefined {
  if (provider === undefined || snapshot === null) return undefined
  return snapshot.accounts.find(candidate => candidate.providers.includes(provider))
}

/**
 * The strip.
 * @param props - injected connection and model-selection face.
 * @returns the strip, or null when the selected route is not an OpenCode Go one.
 */
export function UsageStrip({ connection, selection }: UsageStripInjected): ReactNode {
  const selected = useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot)
  const provider = selected?.provider

  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const aliveRef = useRef(true)

  const load = useCallback(async (force: boolean): Promise<void> => {
    setLoading(true)
    try {
      const next = await loadUsage(connection, { force })
      if (!aliveRef.current) return
      setSnapshot(next)
      setError(null)
    } catch (failure) {
      if (!aliveRef.current) return
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [connection])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Re-read whenever the session's route changes: a switch to another account
  // must not keep showing the previous account's headroom.
  useEffect(() => {
    if (provider === undefined) return
    void load(false)
    const timer = setInterval(() => void load(false), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [provider, load])

  // Countdown ticker: the reset text moves on its own, the data does not.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const account = selectAccount(provider, snapshot)
  if (account === undefined) return null

  return createElement(UsageStripBody, { account, error, loading, nowMs, onRefresh: () => void load(true) })
}

/** Props of the presentational body, split out so it can be rendered directly. */
export interface UsageStripBodyProps {
  account: UsageAccount
  error: string | null
  loading: boolean
  nowMs: number
  onRefresh: () => void
}

/**
 * The strip's markup, as a pure function of its props.
 * @param props - the account, its read state and the clock.
 * @returns the row.
 */
export function UsageStripBody({ account, error, loading, nowMs, onRefresh }: UsageStripBodyProps): ReactNode {
  const binding = account.windows === null ? undefined : bindingWindowKey(account.windows)
  const failure = error ?? account.error?.message ?? null

  return createElement(
    'div',
    { style: ROW, 'data-dsh-opencode-go-usage': '' },
    createElement('span', { style: LABEL }, account.label),
    createElement('span', { style: KEY }, account.maskedKey.length > 0 ? account.maskedKey : '—'),
    account.windows === null
      ? createElement('span', { style: FAILURE }, failure ?? '读取中…')
      : createElement(
        'span',
        { style: CHIPS },
        ...USAGE_WINDOW_KEYS.map(key => chip(key, account, key === binding)),
      ),
    account.windows !== null
      ? createElement('span', { style: RESET }, `${formatReset(bindingResetAt(account.windows), nowMs)}重置`)
      : null,
    failure !== null && account.windows !== null ? createElement('span', { style: FAILURE }, failure) : null,
    createElement(
      'button',
      {
        type: 'button',
        onClick: onRefresh,
        disabled: loading,
        title: '立即刷新额度',
        style: REFRESH,
      },
      loading ? '刷新中' : '刷新',
    ),
    account.fetchedAt !== null
      ? createElement('span', { style: STAMP }, `更新 ${formatClock(account.fetchedAt)}`)
      : null,
  )
}

function chip(key: UsageWindowKey, account: UsageAccount, binding: boolean): ReactNode {
  const window = account.windows?.[key]
  if (window === undefined) return null
  const tone = windowTone(window)
  const colors = TONE_COLORS[tone]
  const remaining = remainingPercent(window)
  return createElement(
    'span',
    {
      key,
      style: { ...CHIP, background: colors.bg, borderColor: binding ? colors.bar : 'transparent' },
      title: `${WINDOW_LABELS[key]}窗口已用 ${String(Math.round(window.percent))}%`,
    },
    createElement('span', { style: { color: colors.fg } }, WINDOW_LABELS[key]),
    createElement(
      'span',
      { style: TRACK },
      createElement('span', { style: { ...FILL, width: `${String(remaining)}%`, background: colors.bar } }),
    ),
    createElement('span', { style: { ...PERCENT, color: colors.fg } }, `${String(remaining)}%`),
  )
}

const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
  padding: '4px 10px',
  font: '12px/1.5 ui-sans-serif, system-ui, sans-serif',
  color: 'var(--dsh-text-secondary, #6b7280)',
}

const LABEL: CSSProperties = { fontWeight: 600, color: 'var(--dsh-text-primary, #374151)' }

const KEY: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, monospace', opacity: 0.7 }

const CHIPS: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '6px' }

const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '1px 6px',
  borderRadius: '6px',
  border: '1px solid transparent',
}

const TRACK: CSSProperties = {
  display: 'inline-block',
  width: '34px',
  height: '4px',
  borderRadius: '2px',
  background: 'rgba(0,0,0,0.10)',
  overflow: 'hidden',
}

const FILL: CSSProperties = { display: 'block', height: '100%' }

const PERCENT: CSSProperties = { fontVariantNumeric: 'tabular-nums', fontWeight: 600 }

const RESET: CSSProperties = { opacity: 0.8 }

const FAILURE: CSSProperties = { color: '#a3352b' }

const STAMP: CSSProperties = { opacity: 0.6, marginLeft: 'auto' }

const REFRESH: CSSProperties = {
  border: '1px solid rgba(0,0,0,0.15)',
  background: 'transparent',
  color: 'inherit',
  borderRadius: '6px',
  padding: '0 6px',
  font: 'inherit',
  cursor: 'pointer',
}

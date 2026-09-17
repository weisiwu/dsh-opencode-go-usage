import { describe, expect, it, vi } from 'vitest'
import type { AccountSeed } from '../src/routes.ts'
import { createUsageRpcHandler } from '../src/rpc.ts'
import { isUsageRequest, isUsageSnapshot, type UsageAccount } from '../src/rpc-contract.ts'
import { createUsageReader } from '../src/usage-service.ts'

const SEED: AccountSeed = {
  apiKeyEnv: 'OPENCODE_GO_1_API_KEY',
  providers: ['opencode-go-1-glm-5-3'],
  models: ['glm-5.3'],
  label: 'OpenCodeGo_1',
  origin: 'https://opencode.ai/zen/go/v1',
}

const OK_BODY = {
  usage: {
    rolling: { status: 'ok', percent: 5, resetsAt: '2026-09-17T18:31:53.624Z' },
    weekly: { status: 'ok', percent: 48, resetsAt: '2026-09-21T00:00:00.624Z' },
    monthly: { status: 'ok', percent: 24, resetsAt: '2026-10-16T06:28:15.245Z' },
  },
}

/** The exact key set the browser half accepts on one account. */
const ACCOUNT_KEYS = [
  'id', 'label', 'apiKeyEnv', 'providers', 'models', 'origin', 'maskedKey', 'windows', 'error', 'fetchedAt',
]

function handlerFor(options: { status?: number; body?: unknown } = {}) {
  const reader = createUsageReader({
    fetcher: async () => new Response(JSON.stringify(options.body ?? OK_BODY), {
      status: options.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
    now: () => 1_000,
  })
  return createUsageRpcHandler({
    loadAccounts: async () => [SEED],
    resolveSecret: async () => 'sk-example0000000000000000000000000000000000000000000000001KEY',
    reader,
    now: () => 1_000,
  })
}

describe('usage channel handler', () => {
  it('answers with a snapshot the browser half accepts', async () => {
    const result = await handlerFor()('usage', { protocolVersion: 1 }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The contract is the interface: the host's own output must pass the very
    // guard the browser applies, exact keys included.
    expect(isUsageSnapshot(result.value)).toBe(true)
    const snapshot = result.value as { accounts: UsageAccount[] }
    expect(Object.keys(snapshot.accounts[0] ?? {}).sort()).toEqual([...ACCOUNT_KEYS].sort())
  })

  it('keeps a refusal readable and still shape-valid', async () => {
    const result = await handlerFor({
      status: 401,
      body: { type: 'error', error: { type: 'CreditsError', message: 'Insufficient balance.' } },
    })('usage', { protocolVersion: 1 }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isUsageSnapshot(result.value)).toBe(true)
    const snapshot = result.value as { accounts: UsageAccount[] }
    expect(snapshot.accounts[0]?.error).toEqual({ type: 'CreditsError', message: 'Insufficient balance.' })
    expect(Object.keys(snapshot.accounts[0] ?? {}).sort()).toEqual([...ACCOUNT_KEYS].sort())
  })

  it('rejects an unknown endpoint and a malformed request', async () => {
    const handler = handlerFor()
    const signal = new AbortController().signal

    const unknown = await handler('nope', { protocolVersion: 1 }, signal)
    expect(unknown.ok).toBe(false)

    const malformed = await handler('usage', { protocolVersion: 2 }, signal)
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) expect(malformed.error.code).toBe('bad-request')
  })

  it('reports an internal failure instead of throwing', async () => {
    const handler = createUsageRpcHandler({
      loadAccounts: async () => {
        throw new Error('settings unreadable')
      },
      resolveSecret: async () => undefined,
    })

    const result = await handler('usage', { protocolVersion: 1 }, new AbortController().signal)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('internal')
      expect(result.error.message).toContain('settings unreadable')
    }
  })

  it('passes the force flag through on the refresh endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(OK_BODY), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const reader = createUsageReader({ fetcher, now: () => 1_000 })
    const handler = createUsageRpcHandler({
      loadAccounts: async () => [SEED],
      resolveSecret: async () => 'sk-example0000000000000000000000000000000000000000000000001KEY',
      reader,
      now: () => 1_000,
    })
    const signal = new AbortController().signal

    await handler('usage', { protocolVersion: 1 }, signal)
    await handler('usage', { protocolVersion: 1 }, signal)
    expect(fetcher).toHaveBeenCalledTimes(1)

    await handler('refresh', { protocolVersion: 1 }, signal)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('accepts only the versioned request payload', () => {
    expect(isUsageRequest({ protocolVersion: 1 })).toBe(true)
    expect(isUsageRequest({ protocolVersion: 1, extra: 'x' })).toBe(false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { AccountSeed } from '../src/routes.ts'
import { createUsageReader, upstreamError, usageWindowsOf } from '../src/usage-service.ts'

const SEED: AccountSeed = {
  apiKeyEnv: 'OPENCODE_GO_1_API_KEY',
  providers: ['opencode-go-1-glm-5-3'],
  models: ['glm-5.3'],
  label: 'OpenCodeGo_1',
  origin: 'https://opencode.ai/zen/go/v1',
}

const SECOND_SEED: AccountSeed = { ...SEED, apiKeyEnv: 'OPENCODE_GO_2_API_KEY', label: 'OpenCodeGo_2' }

/** The upstream success body, with the used shares observed in production. */
const OK_BODY = {
  usage: {
    rolling: { status: 'ok', percent: 0, resetsAt: '2026-09-17T18:31:53.624Z' },
    weekly: { status: 'rate-limited', percent: 100, resetsAt: '2026-09-21T00:00:00.624Z' },
    monthly: { status: 'ok', percent: 50, resetsAt: '2026-10-15T15:38:52.624Z' },
  },
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function secretsFor(map: Record<string, string>): (ref: string) => Promise<string | undefined> {
  return async (ref: string) => map[ref]
}

describe('usageWindowsOf', () => {
  it('reads the documented envelope', () => {
    expect(usageWindowsOf(OK_BODY)?.weekly.percent).toBe(100)
  })

  it('accepts a bare window object and rejects anything else', () => {
    expect(usageWindowsOf(OK_BODY.usage)?.monthly.status).toBe('ok')
    expect(usageWindowsOf({ usage: { rolling: { status: 'ok' } } })).toBeUndefined()
    expect(usageWindowsOf(null)).toBeUndefined()
  })
})

describe('upstreamError', () => {
  it('keeps the upstream code and message', () => {
    expect(upstreamError(401, {
      type: 'error',
      error: { type: 'CreditsError', message: 'Insufficient balance.' },
    })).toEqual({ type: 'CreditsError', message: 'Insufficient balance.' })
  })

  it('falls back to the status when the body is not an error envelope', () => {
    expect(upstreamError(502, '<html>')).toEqual({ type: 'http-502', message: 'HTTP 502' })
  })
})

describe('createUsageReader', () => {
  it('normalizes a successful read and masks the credential', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(200, OK_BODY))
    const reader = createUsageReader({ fetcher, now: () => 1_000 })
    const [account] = await reader.read([SEED], secretsFor({ OPENCODE_GO_1_API_KEY: 'sk-abcdefghijklmnop' }))

    expect(account.label).toBe('OpenCodeGo_1')
    expect(account.maskedKey).toBe('sk-abcd…mnop')
    expect(account.windows?.weekly.status).toBe('rate-limited')
    expect(account.windows?.monthly.percent).toBe(50)
    expect(account.error).toBeNull()
    expect(account.fetchedAt).toBe('1970-01-01T00:00:01.000Z')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const call = fetcher.mock.calls[0]
    expect(call?.[0]).toBe('https://opencode.ai/zen/go/v1/usage')
    expect(call?.[1].headers).toMatchObject({ Authorization: 'Bearer sk-abcdefghijklmnop' })
  })

  it('surfaces an upstream refusal without throwing', async () => {
    const fetcher = vi.fn(async () => jsonResponse(401, {
      type: 'error',
      error: { type: 'CreditsError', message: 'Insufficient balance.' },
    }))
    const reader = createUsageReader({ fetcher, now: () => 1_000 })
    const [account] = await reader.read([SEED], secretsFor({ OPENCODE_GO_1_API_KEY: 'sk-abcdefghijklmnop' }))

    expect(account.windows).toBeNull()
    expect(account.error).toEqual({ type: 'CreditsError', message: 'Insufficient balance.' })
  })

  it('reports a missing credential without calling upstream', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, OK_BODY))
    const reader = createUsageReader({ fetcher })
    const [account] = await reader.read([SEED], secretsFor({}))

    expect(account.error?.type).toBe('credential-missing')
    expect(account.maskedKey).toBe('')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('serves a cached read inside the TTL and refreshes when forced', async () => {
    let clock = 1_000
    const fetcher = vi.fn(async () => jsonResponse(200, OK_BODY))
    const reader = createUsageReader({ fetcher, now: () => clock, ttlMs: 60_000 })
    const secrets = secretsFor({ OPENCODE_GO_1_API_KEY: 'sk-abcdefghijklmnop' })

    await reader.read([SEED], secrets)
    clock = 30_000
    await reader.read([SEED], secrets)
    expect(fetcher).toHaveBeenCalledTimes(1)

    clock = 200_000
    await reader.read([SEED], secrets)
    expect(fetcher).toHaveBeenCalledTimes(2)

    await reader.read([SEED], secrets, { force: true })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('collapses concurrent reads of one account into a single request', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetcher = vi.fn(async () => {
      await gate
      return jsonResponse(200, OK_BODY)
    })
    const reader = createUsageReader({ fetcher })
    const secrets = secretsFor({ OPENCODE_GO_1_API_KEY: 'sk-abcdefghijklmnop' })

    const first = reader.read([SEED], secrets)
    const second = reader.read([SEED], secrets)
    release?.()
    await Promise.all([first, second])

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reads each account separately and keeps seed order', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, OK_BODY))
    const reader = createUsageReader({ fetcher })
    const accounts = await reader.read([SEED, SECOND_SEED], secretsFor({
      OPENCODE_GO_1_API_KEY: 'sk-abcdefghijklmnop',
      OPENCODE_GO_2_API_KEY: 'sk-qrstuvwxyzabcdef',
    }))

    expect(accounts.map(account => account.apiKeyEnv)).toEqual([
      'OPENCODE_GO_1_API_KEY',
      'OPENCODE_GO_2_API_KEY',
    ])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('turns a transport failure and an unparsable body into readable errors', async () => {
    const throwing = createUsageReader({
      fetcher: async () => {
        throw new TypeError('fetch failed')
      },
    })
    const [failed] = await throwing.read([SEED], secretsFor({ OPENCODE_GO_1_API_KEY: 'sk-abcdefghijklmnop' }))
    expect(failed.error?.type).toBe('network')
    expect(failed.error?.message).toContain('fetch failed')

    const garbage = createUsageReader({ fetcher: async () => new Response('<html/>', { status: 200 }) })
    const [invalid] = await garbage.read([SEED], secretsFor({ OPENCODE_GO_1_API_KEY: 'sk-abcdefghijklmnop' }))
    expect(invalid.error?.type).toBe('invalid-response')
  })
})

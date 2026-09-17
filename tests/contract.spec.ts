import { describe, expect, it } from 'vitest'
import { isUsageAccount, isUsageRequest, isUsageSnapshot, isUsageWindow, isUsageWindows } from '../src/rpc-contract.ts'

const WINDOW = { status: 'ok', percent: 50, resetsAt: '2026-09-21T00:00:00.624Z' }
const WINDOWS = { rolling: WINDOW, weekly: WINDOW, monthly: WINDOW }
const ACCOUNT = {
  id: 'OPENCODE_GO_1_API_KEY',
  label: 'OpenCodeGo_1',
  apiKeyEnv: 'OPENCODE_GO_1_API_KEY',
  maskedKey: 'sk-exam…1KEY',
  providers: ['opencode-go-1-glm-5-3'],
  models: ['glm-5.3'],
  origin: 'https://opencode.ai/zen/go/v1',
  windows: WINDOWS,
  error: null,
  fetchedAt: '2026-09-17T13:30:00.000Z',
}
const SNAPSHOT = { protocolVersion: 1, fetchedAt: '2026-09-17T13:30:00.000Z', accounts: [ACCOUNT] }

describe('usage request guard', () => {
  it('accepts exactly the versioned request', () => {
    expect(isUsageRequest({ protocolVersion: 1 })).toBe(true)
    expect(isUsageRequest({ protocolVersion: 2 })).toBe(false)
    expect(isUsageRequest({ protocolVersion: 1, extra: true })).toBe(false)
    expect(isUsageRequest(null)).toBe(false)
  })
})

describe('usage window guard', () => {
  it('accepts a complete window and rejects out-of-range or partial ones', () => {
    expect(isUsageWindow(WINDOW)).toBe(true)
    expect(isUsageWindow({ ...WINDOW, status: 'rate-limited' })).toBe(true)
    expect(isUsageWindow({ ...WINDOW, percent: 101 })).toBe(false)
    expect(isUsageWindow({ ...WINDOW, percent: -1 })).toBe(false)
    expect(isUsageWindow({ ...WINDOW, status: 'weird' })).toBe(false)
    expect(isUsageWindow({ status: 'ok', percent: 1 })).toBe(false)
  })

  it('requires every window key', () => {
    expect(isUsageWindows(WINDOWS)).toBe(true)
    expect(isUsageWindows({ rolling: WINDOW, weekly: WINDOW })).toBe(false)
    expect(isUsageWindows({ monthly: WINDOW })).toBe(false)
  })

  it('tolerates an unknown extra window so an upstream addition cannot hide the known ones', () => {
    expect(isUsageWindows({ ...WINDOWS, daily: WINDOW })).toBe(true)
  })
})

describe('usage account guard', () => {
  it('accepts a complete account, including the unresolved-credential state', () => {
    expect(isUsageAccount(ACCOUNT)).toBe(true)
    expect(isUsageAccount({ ...ACCOUNT, windows: null, error: { type: 'credential-missing', message: '未找到凭据。' }, fetchedAt: null })).toBe(true)
  })

  it('rejects a missing field or a mistyped one', () => {
    const { maskedKey: _omitted, ...withoutKey } = ACCOUNT
    expect(isUsageAccount(withoutKey)).toBe(false)
    expect(isUsageAccount({ ...ACCOUNT, providers: 'opencode-go-1' })).toBe(false)
    expect(isUsageAccount({ ...ACCOUNT, error: { type: 'x' } })).toBe(false)
    expect(isUsageAccount({ ...ACCOUNT, windows: 'none' })).toBe(false)
  })

  it('tolerates an unknown extra field so a host-side addition cannot blank the strip', () => {
    // 2026-09-17: a host build published its internal cache stamp; the browser
    // refused the whole payload and the strip vanished. The host now projects
    // its output explicitly (asserted in the host tests); this guard stays
    // lenient so version skew degrades to "an unused field", never to nothing.
    expect(isUsageAccount({ ...ACCOUNT, at: 1789650869253 })).toBe(true)
  })
})

describe('usage snapshot guard', () => {
  it('accepts an empty or populated snapshot', () => {
    expect(isUsageSnapshot(SNAPSHOT)).toBe(true)
    expect(isUsageSnapshot({ protocolVersion: 1, fetchedAt: 'x', accounts: [] })).toBe(true)
  })

  it('rejects a wrong version, a missing field and a broken account', () => {
    expect(isUsageSnapshot({ ...SNAPSHOT, protocolVersion: 2 })).toBe(false)
    expect(isUsageSnapshot({ protocolVersion: 1, accounts: [] })).toBe(false)
    expect(isUsageSnapshot({ ...SNAPSHOT, accounts: [{ ...ACCOUNT, windows: { rolling: WINDOW } }] })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UsageAccount, UsageSnapshot, UsageWindows } from '../src/rpc-contract.ts'
import { UsageStripBody, selectAccount } from '../src/client/UsageStrip.tsx'

const WINDOWS: UsageWindows = {
  rolling: { status: 'ok', percent: 3, resetsAt: '2026-09-17T18:31:53.624Z' },
  weekly: { status: 'ok', percent: 47, resetsAt: '2026-09-21T00:00:00.624Z' },
  monthly: { status: 'ok', percent: 23, resetsAt: '2026-10-16T06:28:15.245Z' },
}

const ACCOUNT: UsageAccount = {
  id: 'OPENCODE_GO_1_API_KEY',
  label: 'OpenCodeGo_1',
  apiKeyEnv: 'OPENCODE_GO_1_API_KEY',
  maskedKey: 'sk-exam…1KEY',
  providers: ['opencode-go-1-glm-5-3', 'opencode-go-1-deepseek-v41'],
  models: ['glm-5.3', 'deepseek-v4.1-flash'],
  origin: 'https://opencode.ai/zen/go/v1',
  windows: WINDOWS,
  error: null,
  fetchedAt: '2026-09-17T13:30:00.000Z',
}

const SNAPSHOT: UsageSnapshot = {
  protocolVersion: 1,
  fetchedAt: '2026-09-17T13:30:00.000Z',
  accounts: [ACCOUNT, { ...ACCOUNT, id: 'OPENCODE_GO_2_API_KEY', label: 'OpenCodeGo_2', providers: ['opencode-go-2-glm-5-3'] }],
}

/** Render the presentational body the way the shell would mount it. */
function render(account: UsageAccount, options: { error?: string | null; loading?: boolean; nowMs?: number } = {}): string {
  return renderToStaticMarkup(createElement(UsageStripBody, {
    account,
    error: options.error ?? null,
    loading: options.loading ?? false,
    nowMs: options.nowMs ?? Date.parse('2026-09-17T13:30:00.000Z'),
    onRefresh: () => undefined,
  }))
}

describe('selectAccount', () => {
  it('picks the account whose routes contain the selected provider', () => {
    expect(selectAccount('opencode-go-1-deepseek-v41', SNAPSHOT)?.label).toBe('OpenCodeGo_1')
    expect(selectAccount('opencode-go-2-glm-5-3', SNAPSHOT)?.label).toBe('OpenCodeGo_2')
  })

  it('returns nothing for a non-Go route, an unset selection or no snapshot yet', () => {
    expect(selectAccount('deepseek-official', SNAPSHOT)).toBeUndefined()
    expect(selectAccount(undefined, SNAPSHOT)).toBeUndefined()
    expect(selectAccount('opencode-go-1-glm-5-3', null)).toBeUndefined()
  })
})

describe('UsageStripBody markup', () => {
  it('shows the account, its masked credential and the remaining share of each window', () => {
    const markup = render(ACCOUNT)

    expect(markup).toContain('OpenCodeGo_1')
    expect(markup).toContain('sk-exam…1KEY')
    expect(markup).toContain('5小时')
    expect(markup).toContain('周')
    expect(markup).toContain('月')
    // Headroom, not usage: 3/47/23 used means 97/53/77 left. Assert on rendered
    // text nodes (`>97%<`) because the usage figures legitimately survive in the
    // chips' title attributes.
    expect(markup).toContain('>97%<')
    expect(markup).toContain('>53%<')
    expect(markup).toContain('>77%<')
    expect(markup).not.toContain('>47%<')
    expect(markup).not.toContain('>3%<')
  })

  it('counts down to the reset of the binding window — the one with least headroom (weekly 53% left)', () => {
    const markup = render(ACCOUNT, { nowMs: Date.parse('2026-09-17T13:30:00.000Z') })
    expect(markup).toContain('>3天后<')
    // The short text keeps the row on one line; the full sentence lives in the tooltip.
    expect(markup).toContain('周窗口 3天后重置')
  })

  it('marks a rate-limited window and shows the failure text next to usable numbers', () => {
    const blocked: UsageAccount = {
      ...ACCOUNT,
      windows: {
        ...WINDOWS,
        weekly: { status: 'rate-limited', percent: 100, resetsAt: '2026-09-21T00:00:00.000Z' },
      },
    }
    const markup = render(blocked, { error: '上游拒绝了这次读取。' })

    expect(markup).toContain('>0%<')
    expect(markup).toContain('>3天后<')
    expect(markup).toContain('上游拒绝了这次读取。')
  })

  it('stays on one line: no wrap, and the read time rides in the refresh tooltip', () => {
    const markup = render(ACCOUNT, { nowMs: Date.parse('2026-09-17T13:30:00.000Z') })

    // Wrapping was what pushed the second line against the window edge on a
    // 756px-wide window; the row must declare nowrap and allow the label to
    // ellipsize rather than grow the row.
    expect(markup).toContain('flex-wrap:nowrap')
    expect(markup).toContain('text-overflow:ellipsis')
    // The stamp is no longer a trailing field…
    expect(markup).not.toContain('margin-left:auto')
    expect(markup).not.toContain('>更新 ')
    // …it is the refresh control's tooltip.
    expect(markup).toContain('立即刷新额度（更新 21:30）')
  })

  it('renders the unresolved-credential state instead of numbers', () => {
    const markup = render({ ...ACCOUNT, windows: null, maskedKey: '', error: { type: 'credential-missing', message: '未找到凭据 OPENCODE_GO_9_API_KEY。' } })
    expect(markup).toContain('未找到凭据 OPENCODE_GO_9_API_KEY。')
    expect(markup).not.toContain('97%')
  })

  it('reports loading on the refresh control', () => {
    expect(render(ACCOUNT, { loading: true })).toContain('刷新中')
    expect(render(ACCOUNT)).toContain('刷新')
  })
})

import { describe, expect, it } from 'vitest'
import type { UsageWindow, UsageWindows } from '../src/rpc-contract.ts'
import {
  WINDOW_LABELS,
  bindingResetAt,
  bindingWindowKey,
  formatClock,
  formatReset,
  remainingPercent,
  windowTone,
} from '../src/client/format.ts'

function window(percent: number, status: 'ok' | 'rate-limited' = 'ok', resetsAt = '2026-09-21T00:00:00.000Z'): UsageWindow {
  return { status, percent, resetsAt }
}

function windows(rolling: UsageWindow, weekly: UsageWindow, monthly: UsageWindow): UsageWindows {
  return { rolling, weekly, monthly }
}

describe('remainingPercent', () => {
  it('reports headroom, not usage', () => {
    expect(remainingPercent(window(0))).toBe(100)
    expect(remainingPercent(window(50))).toBe(50)
    expect(remainingPercent(window(100))).toBe(0)
    expect(remainingPercent(window(23.4))).toBe(77)
  })
})

describe('windowTone', () => {
  it('marks a rate-limited window blocked whatever the percent says', () => {
    expect(windowTone(window(0, 'rate-limited'))).toBe('blocked')
  })

  it('steps from ok to warning to blocked as headroom shrinks (boundaries at 30% and 10% left)', () => {
    expect(windowTone(window(0))).toBe('ok')
    expect(windowTone(window(69))).toBe('ok')
    expect(windowTone(window(70))).toBe('warning')
    expect(windowTone(window(89))).toBe('warning')
    expect(windowTone(window(90))).toBe('blocked')
    expect(windowTone(window(100))).toBe('blocked')
  })
})

describe('WINDOW_LABELS', () => {
  it('names the three upstream windows in Chinese', () => {
    expect(WINDOW_LABELS).toEqual({ rolling: '5小时', weekly: '周', monthly: '月' })
  })
})

describe('bindingWindowKey', () => {
  it('picks the window that stops work first', () => {
    expect(bindingWindowKey(windows(window(10), window(20), window(90)))).toBe('monthly')
  })

  it('lets a rate-limited window win over a merely high one', () => {
    expect(bindingWindowKey(windows(window(0), window(100, 'rate-limited'), window(50)))).toBe('weekly')
  })

  it('reports that window reset instant', () => {
    const set = windows(window(0), window(100, 'rate-limited', '2026-09-21T00:00:00.624Z'), window(50))
    expect(bindingWindowKey(set)).toBe('weekly')
    expect(bindingResetAt(set)).toBe('2026-09-21T00:00:00.624Z')
  })
})

describe('formatReset', () => {
  const now = Date.parse('2026-09-17T13:30:00.000Z')

  it('renders days, hours and minutes', () => {
    expect(formatReset('2026-09-21T00:00:00.000Z', now)).toBe('3天 后')
    expect(formatReset('2026-09-17T15:40:00.000Z', now)).toBe('2小时10分 后')
    expect(formatReset('2026-09-17T14:30:00.000Z', now)).toBe('1小时 后')
    expect(formatReset('2026-09-17T13:45:00.000Z', now)).toBe('15分 后')
  })

  it('reports an elapsed or unparsable instant instead of a nonsense countdown', () => {
    expect(formatReset('2026-09-17T13:00:00.000Z', now)).toBe('已到重置点')
    expect(formatReset('not-a-date', now)).toBe('重置时间未知')
  })
})

describe('formatClock', () => {
  it('renders a local clock time and tolerates junk', () => {
    const local = new Date(2026, 8, 17, 6, 5).toISOString()
    expect(formatClock(local)).toBe('06:05')
    expect(formatClock('nope')).toBe('')
  })
})

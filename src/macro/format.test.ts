import { describe, it, expect } from 'vitest'
import { eventDayKey, fmtCivilLongDay } from './format'

describe('date civile des marqueurs de réunion', () => {
  it('le jour 1 garde sa date quel que soit le fuseau du navigateur', () => {
    // BCE, jour 1 = 28/10/2026 00:00 Francfort = 27/10 23:00 UTC
    const day1 = { ts: Date.UTC(2026, 9, 27, 23, 0), allDay: true, meeting: { bank: 'ECB' as const, start: '2026-10-28', end: '2026-10-29', sep: false, day1Ts: 0, decisionTs: 0 } }
    expect(eventDayKey(day1)).toBe('2026-10-28')
    expect(fmtCivilLongDay('2026-10-28')).toBe('Wednesday, October 28')
    expect(fmtCivilLongDay('2026-09-15')).toBe('Tuesday, September 15')
  })
})

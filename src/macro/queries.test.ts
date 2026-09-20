import { describe, expect, it } from 'vitest'
import { calendarRefetchInterval } from './queries'
import type { CalendarData, MacroEvent } from './types'
import type { Envelope } from '../lib/api'

const MIN = 60_000
const NOW = Date.UTC(2026, 8, 17, 12, 31)

const envelope = (events: Partial<MacroEvent>[]) => ({ data: { events } }) as unknown as Envelope<CalendarData>
const claims = (actual: string | null, actualFrom?: string): Partial<MacroEvent> => ({
  impact: 'Medium',
  allDay: false,
  ts: Date.UTC(2026, 8, 17, 12, 30),
  measures: [{ name: 'Unemployment Claims', forecast: '207K', previous: '206K', actual, ...(actualFrom ? { actualFrom } : {}) }],
})

describe('cadence de sondage du calendrier', () => {
  it('chiffre officiel attendu (même Medium) : 1 min pendant 30 min', () => {
    expect(calendarRefetchInterval(envelope([claims(null, 'US Department of Labor')]), NOW)).toBe(MIN)
    expect(calendarRefetchInterval(envelope([claims(null, 'US Department of Labor')]), NOW + 40 * MIN)).toBe(5 * MIN)
  })
  it('chiffre déjà lu, ou aucune source ouverte : cadence normale', () => {
    expect(calendarRefetchInterval(envelope([claims('196K', 'US Department of Labor')]), NOW)).toBe(5 * MIN)
    expect(calendarRefetchInterval(envelope([claims(null)]), NOW)).toBe(5 * MIN)
  })
  it('événement High à moins de 2 h', () => {
    expect(calendarRefetchInterval(envelope([{ ...claims('196K'), impact: 'High' }]), NOW)).toBe(MIN)
  })
})

import { describe, it, expect } from 'vitest'
import { FOMC_MEETINGS, ECB_MEETINGS, referenceEvents, meetingEvents, nextMeeting, lastMeeting } from './reference.mjs'

const H = 3_600_000

describe('calendriers de référence', () => {
  it('réunions sur deux jours consécutifs, triées', () => {
    for (const list of [FOMC_MEETINGS, ECB_MEETINGS]) {
      for (let i = 0; i < list.length; i++) {
        const { start, end } = list[i]
        expect(Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)).toBe(86_400_000)
        if (i > 0) expect(start > list[i - 1].end).toBe(true)
      }
    }
  })

  it('FOMC du 15-16/09/2026 : jour 1, décision 18:00 UTC (20:00 Paris), conférence 18:30 UTC', () => {
    const events = referenceEvents(Date.UTC(2026, 8, 13, 4), Date.UTC(2026, 8, 27, 4))
    expect(events.map((e) => [e.id, e.ts])).toEqual([
      ['fomc-2026-09-15-day1', Date.UTC(2026, 8, 15, 4, 0)],
      ['fomc-2026-09-16-decision', Date.UTC(2026, 8, 16, 18, 0)],
      ['fomc-2026-09-16-presser', Date.UTC(2026, 8, 16, 18, 30)],
    ])
    expect(events[1]).toMatchObject({ impact: 'High', category: 'decision', isReference: true, country: 'USD' })
    expect(events[1].meeting).toMatchObject({ sep: true, day1Ts: Date.UTC(2026, 8, 15, 4, 0) })
  })

  it('BCE du 29/10/2026 (heure d’hiver à Francfort) : 13:15 et 13:45 UTC', () => {
    const [, decision, presser] = meetingEvents('ecb', ECB_MEETINGS[0])
    expect(decision.ts).toBe(Date.UTC(2026, 9, 29, 13, 15))
    expect(presser.ts).toBe(Date.UTC(2026, 9, 29, 13, 45))
    expect(decision.title).toBe('ECB rate decision')
  })

  it('FOMC de décembre (heure d’hiver à New York) : 19:00 UTC', () => {
    const dec = FOMC_MEETINGS.find((m) => m.end === '2026-12-09')
    expect(meetingEvents('fomc', dec)[1].ts).toBe(Date.UTC(2026, 11, 9, 19, 0))
  })

  it('prochaine et dernière réunion', () => {
    const morning = Date.UTC(2026, 8, 16, 12, 53)
    expect(nextMeeting('fomc', morning)?.id).toBe('fomc-2026-09-16-decision')
    expect(lastMeeting('fomc', morning)?.id).toBe('fomc-2026-07-29-decision')
    // maintien 2 h après la décision, puis bascule sur octobre
    expect(nextMeeting('fomc', Date.UTC(2026, 8, 16, 19, 0), 2 * H)?.id).toBe('fomc-2026-09-16-decision')
    expect(nextMeeting('fomc', Date.UTC(2026, 8, 16, 20, 30), 2 * H)?.id).toBe('fomc-2026-10-28-decision')
    expect(nextMeeting('ecb', morning)?.id).toBe('ecb-2026-10-29-decision')
    expect(nextMeeting('fomc', Date.UTC(2028, 0, 1))).toBeNull()
  })
})

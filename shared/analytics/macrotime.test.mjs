import { describe, it, expect } from 'vitest'
import {
  zonedTimeToUtc,
  tzOffsetMinutes,
  formatUtcOffset,
  dayKey,
  calendarWeekStart,
  parseFeedDate,
  nextMajorEvent,
  pickHero,
  countdownParts,
  formatCountdown,
} from './macrotime.mjs'

const H = 3_600_000

describe('fuseaux horaires', () => {
  it('décision FOMC du 16/09/2026 : 14:00 New York = 18:00 UTC = 20:00 Paris', () => {
    const ts = zonedTimeToUtc({ year: 2026, month: 9, day: 16, hour: 14 }, 'America/New_York')
    expect(ts).toBe(Date.UTC(2026, 8, 16, 18, 0))
    expect(tzOffsetMinutes(ts, 'Europe/Paris')).toBe(120)
    expect(tzOffsetMinutes(ts, 'America/New_York')).toBe(-240)
  })

  it('changements d’heure : BCE 29/10/2026 14:15 Francfort (CET) et FOMC 09/12 (EST)', () => {
    expect(zonedTimeToUtc({ year: 2026, month: 10, day: 29, hour: 14, minute: 15 }, 'Europe/Berlin')).toBe(
      Date.UTC(2026, 9, 29, 13, 15),
    )
    expect(zonedTimeToUtc({ year: 2026, month: 12, day: 9, hour: 14 }, 'America/New_York')).toBe(
      Date.UTC(2026, 11, 9, 19, 0),
    )
    // semaine où l’Europe est déjà à l’heure d’hiver mais pas New York (27-28 oct. 2026)
    expect(zonedTimeToUtc({ year: 2026, month: 10, day: 28, hour: 14 }, 'America/New_York')).toBe(
      Date.UTC(2026, 9, 28, 18, 0),
    )
  })

  it('libellé de décalage', () => {
    expect(formatUtcOffset(120)).toBe('UTC+2')
    expect(formatUtcOffset(-240)).toBe('UTC−4')
    expect(formatUtcOffset(330)).toBe('UTC+5:30')
    expect(formatUtcOffset(0)).toBe('UTC')
  })

  it('clé de jour selon le fuseau', () => {
    const ts = Date.UTC(2026, 8, 16, 23, 30)
    expect(dayKey(ts, 'Europe/Paris')).toBe('2026-09-17')
    expect(dayKey(ts, 'America/New_York')).toBe('2026-09-16')
  })

  it('semaine FairEconomy : dimanche 00:00 New York', () => {
    expect(calendarWeekStart(Date.UTC(2026, 8, 16, 12, 53))).toBe(Date.UTC(2026, 8, 13, 4, 0))
    // samedi 23:00 à New York = dimanche 03:00 UTC → encore la semaine précédente
    expect(calendarWeekStart(Date.UTC(2026, 8, 13, 3, 0))).toBe(Date.UTC(2026, 8, 6, 4, 0))
    expect(calendarWeekStart(Date.UTC(2026, 8, 13, 4, 0))).toBe(Date.UTC(2026, 8, 13, 4, 0))
  })

  it('dates de flux : décalage obligatoire', () => {
    expect(parseFeedDate('2026-09-16T14:00:00-04:00')).toBe(Date.UTC(2026, 8, 16, 18, 0))
    expect(parseFeedDate('2026-09-16T14:00:00Z')).toBe(Date.UTC(2026, 8, 16, 14, 0))
    expect(parseFeedDate('2026-09-16T14:00:00')).toBeNull()
    expect(parseFeedDate('Tentative')).toBeNull()
    expect(parseFeedDate(null)).toBeNull()
  })
})

describe('prochain événement / héro', () => {
  const fomc = { id: 'fomc', impact: 'High', category: 'decision', ts: Date.UTC(2026, 8, 16, 18, 0) }
  const presser = { id: 'presser', impact: 'High', category: 'presser', ts: Date.UTC(2026, 8, 16, 18, 30) }
  const retail = { id: 'retail', impact: 'Medium', category: 'data', ts: Date.UTC(2026, 8, 16, 17, 0) }
  const boe = { id: 'boe', impact: 'High', category: 'decision', ts: Date.UTC(2026, 8, 17, 11, 0) }
  const day1 = { id: 'day1', impact: 'High', category: 'meeting', allDay: true, ts: Date.UTC(2026, 8, 16, 20, 0) }
  const events = [boe, presser, retail, fomc, day1]

  it('le FOMC du 16/09 sort en tête à 12:53 UTC', () => {
    expect(nextMajorEvent(events, Date.UTC(2026, 8, 16, 12, 53))?.id).toBe('fomc')
  })

  it('juste après la décision : résultat affiché + conférence en suivant', () => {
    const hero = pickHero(events, Date.UTC(2026, 8, 16, 18, 5))
    expect(hero.current?.id).toBe('fomc')
    expect(hero.next?.id).toBe('presser')
  })

  it('bascule sur l’événement suivant après la fenêtre de maintien', () => {
    const hero = pickHero(events, Date.UTC(2026, 8, 16, 20, 30))
    expect(hero.current).toBeNull()
    expect(hero.next?.id).toBe('boe')
  })

  it('une conférence de presse n’est jamais un « résultat »', () => {
    const hero = pickHero([presser], Date.UTC(2026, 8, 16, 18, 40))
    expect(hero.current).toBeNull()
  })
})

describe('compte à rebours', () => {
  it('composantes', () => {
    expect(countdownParts(5 * H + 7 * 60_000 + 59_000)).toEqual({ days: 0, hours: 5, minutes: 7, totalMinutes: 307 })
  })
  it('formats', () => {
    expect(formatCountdown(5 * H + 7 * 60_000)).toBe('5h 07m')
    expect(formatCountdown(42 * 60_000)).toBe('42m')
    expect(formatCountdown(30_000)).toBe('<1m')
    expect(formatCountdown(0)).toBe('now')
    expect(formatCountdown(47 * H + 59 * 60_000)).toBe('47h 59m')
    expect(formatCountdown(52 * H)).toBe('2d 04h')
  })
  it('précision à la seconde sous l’heure', () => {
    expect(formatCountdown(9 * 60_000 + 5_400, true)).toBe('9m 05s')
    expect(formatCountdown(42_000, true)).toBe('42s')
    expect(formatCountdown(2 * H, true)).toBe('2h 00m')
    expect(formatCountdown(-1, true)).toBe('now')
  })
})

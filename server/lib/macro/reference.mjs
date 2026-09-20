/*
 * Calendriers de référence codés en dur (publics, connus longtemps à l'avance).
 * Ils garantissent que le calendrier et le héro FOMC fonctionnent flux coupé.
 *
 * FOMC : federalreserve.gov/monetarypolicy/fomccalendars.htm (consulté le 16/09/2026).
 *   Décision 14:00 heure de New York le 2e jour, conférence de presse 14:30.
 *   `sep` = réunion avec projections économiques (SEP).
 * BCE : ecb.europa.eu/press/calendars/mgcgc (consulté le 16/09/2026) — la page ne
 *   liste que les réunions à venir. Décision 14:15 heure de Francfort, conférence 14:45.
 */
import { zonedTimeToUtc } from '../../../shared/analytics/macrotime.mjs'

export const FOMC_MEETINGS = [
  { start: '2026-01-27', end: '2026-01-28', sep: false },
  { start: '2026-03-17', end: '2026-03-18', sep: true },
  { start: '2026-04-28', end: '2026-04-29', sep: false },
  { start: '2026-06-16', end: '2026-06-17', sep: true },
  { start: '2026-07-28', end: '2026-07-29', sep: false },
  { start: '2026-09-15', end: '2026-09-16', sep: true },
  { start: '2026-10-27', end: '2026-10-28', sep: false },
  { start: '2026-12-08', end: '2026-12-09', sep: true },
  { start: '2027-01-26', end: '2027-01-27', sep: false },
  { start: '2027-03-16', end: '2027-03-17', sep: true },
  { start: '2027-04-27', end: '2027-04-28', sep: false },
  { start: '2027-06-08', end: '2027-06-09', sep: true },
  { start: '2027-07-27', end: '2027-07-28', sep: false },
  { start: '2027-09-14', end: '2027-09-15', sep: true },
  { start: '2027-10-26', end: '2027-10-27', sep: false },
  { start: '2027-12-07', end: '2027-12-08', sep: true },
]

export const ECB_MEETINGS = [
  { start: '2026-10-28', end: '2026-10-29' },
  { start: '2026-12-16', end: '2026-12-17' },
  { start: '2027-02-03', end: '2027-02-04' },
  { start: '2027-03-17', end: '2027-03-18' },
  { start: '2027-04-28', end: '2027-04-29' },
  { start: '2027-06-09', end: '2027-06-10' },
  { start: '2027-07-21', end: '2027-07-22' },
  { start: '2027-09-08', end: '2027-09-09' },
  { start: '2027-10-27', end: '2027-10-28' },
  { start: '2027-12-15', end: '2027-12-16' },
]

export const FED_LINKS = {
  calendar: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  pressReleases: 'https://www.federalreserve.gov/newsevents/pressreleases.htm',
}

export const ECB_LINKS = {
  decisions: 'https://www.ecb.europa.eu/press/govcdec/mopo/html/index.en.html',
  calendar: 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html',
}

const BANKS = {
  fomc: {
    meetings: FOMC_MEETINGS,
    timeZone: 'America/New_York',
    country: 'USD',
    decision: { hour: 14, minute: 0 },
    presser: { hour: 14, minute: 30 },
    names: {
      decision: 'FOMC rate decision',
      presser: 'FOMC press conference',
      day1: 'FOMC meeting — day 1 of 2',
    },
    links: [{ label: 'FOMC calendar & statements', url: FED_LINKS.calendar }],
  },
  ecb: {
    meetings: ECB_MEETINGS,
    timeZone: 'Europe/Berlin',
    country: 'EUR',
    decision: { hour: 14, minute: 15 },
    presser: { hour: 14, minute: 45 },
    names: {
      decision: 'ECB rate decision',
      presser: 'ECB press conference',
      day1: 'ECB Governing Council — day 1 of 2',
    },
    links: [{ label: 'ECB monetary policy decisions', url: ECB_LINKS.decisions }],
  },
}

const ymd = (date) => {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day }
}

/** Informations de réunion partagées par les événements d'une même réunion. */
function meetingInfo(kind, meeting) {
  const bank = BANKS[kind]
  return {
    bank: kind === 'fomc' ? 'Fed' : 'ECB',
    start: meeting.start,
    end: meeting.end,
    sep: Boolean(meeting.sep),
    day1Ts: zonedTimeToUtc(ymd(meeting.start), bank.timeZone),
    decisionTs: zonedTimeToUtc({ ...ymd(meeting.end), ...bank.decision }, bank.timeZone),
  }
}

function baseEvent(kind, meeting, category, ts) {
  const bank = BANKS[kind]
  const suffix = category === 'meeting' ? 'day1' : category
  const date = category === 'meeting' ? meeting.start : meeting.end
  return {
    id: `${kind}-${date}-${suffix}`,
    kind,
    category,
    title: bank.names[suffix],
    country: bank.country,
    ts,
    impact: category === 'meeting' ? 'Info' : 'High',
    allDay: category === 'meeting',
    forecast: null,
    previous: null,
    actual: null,
    measures: [],
    isReference: true,
    sources: ['reference'],
    meeting: meetingInfo(kind, meeting),
    links: bank.links,
  }
}

/** Événements d'une réunion : jour 1 (information), décision, conférence de presse. */
export function meetingEvents(kind, meeting) {
  const bank = BANKS[kind]
  const tz = bank.timeZone
  return [
    baseEvent(kind, meeting, 'meeting', zonedTimeToUtc(ymd(meeting.start), tz)),
    baseEvent(kind, meeting, 'decision', zonedTimeToUtc({ ...ymd(meeting.end), ...bank.decision }, tz)),
    baseEvent(kind, meeting, 'presser', zonedTimeToUtc({ ...ymd(meeting.end), ...bank.presser }, tz)),
  ]
}

/** Événements de référence dont l'heure tombe dans [fromTs, toTs). */
export function referenceEvents(fromTs, toTs) {
  const out = []
  for (const kind of Object.keys(BANKS)) {
    for (const meeting of BANKS[kind].meetings) {
      for (const event of meetingEvents(kind, meeting)) {
        if (event.ts >= fromTs && event.ts < toTs) out.push(event)
      }
    }
  }
  return out.sort((a, b) => a.ts - b.ts)
}

/**
 * Prochaine réunion (décision non encore passée depuis plus de `holdMs`),
 * indépendamment de la fenêtre du calendrier — pour le « policy corner ».
 */
export function nextMeeting(kind, now, holdMs = 0) {
  for (const meeting of BANKS[kind].meetings) {
    const info = meetingInfo(kind, meeting)
    if (info.decisionTs + holdMs > now) return { id: `${kind}-${meeting.end}-decision`, ...info }
  }
  return null
}

/** Dernière réunion dont la décision est passée. */
export function lastMeeting(kind, now) {
  let last = null
  for (const meeting of BANKS[kind].meetings) {
    const info = meetingInfo(kind, meeting)
    if (info.decisionTs <= now) last = { id: `${kind}-${meeting.end}-decision`, ...info }
  }
  return last
}

import { useMemo, useState } from 'react'
import { CountryTag, ImpactChip } from './chips'
import {
  COUNTRY_NAMES,
  eventDayKey,
  fmtCivilLongDay,
  fmtTime,
  localDayKey,
  relativeDayLabel,
  surpriseGlyph,
  surpriseLabel,
} from './format'
import { missingActual } from './MeasuresTable'
import type { CalendarData, MacroEvent, Measure } from './types'

const DAY = 86_400_000
const REGIONS = [
  { key: 'all', label: 'All' },
  { key: 'USD', label: 'US' },
  { key: 'EUR', label: 'EZ' },
  { key: 'GBP', label: 'UK' },
  { key: 'JPY', label: 'JP' },
] as const
type RegionKey = (typeof REGIONS)[number]['key']

const hasNumbers = (m: Measure) => m.actual != null || m.forecast != null || m.previous != null

/** Nom court d'une mesure dans la liste (le titre de l'événement porte déjà la zone). */
const shortName = (name: string) =>
  name
    .replace(/^Federal Funds Rate$/, 'Fed funds rate')
    .replace(/^Non-Farm Employment Change$/, 'Payrolls')
    .replace(/^Average Hourly Earnings m\/m$/, 'Avg hourly earnings m/m')

function rowLabel(e: MacroEvent): string {
  const parts = [
    e.title,
    COUNTRY_NAMES[e.country] ?? e.country,
    `${e.impact} impact`,
    e.allDay ? 'all day' : fmtTime(e.ts),
  ]
  for (const m of e.measures.filter(hasNumbers)) {
    const bits = [
      m.actual
        ? `actual ${m.actual}${m.surprise ? `, ${surpriseLabel(m.surprise)}` : ''}`
        : m.actualFrom
          ? `actual pending from ${m.actualFrom}`
          : 'actual not available',
      m.forecast ? `forecast ${m.forecast}` : null,
      m.previous ? `previous ${m.previous}` : null,
    ].filter(Boolean)
    parts.push(`${m.name}: ${bits.join(', ')}`)
  }
  return `${parts.join('. ')}. Open details.`
}

function EventRow({ event, now, onOpen }: { event: MacroEvent; now: number; onOpen: (id: string) => void }) {
  const past = event.allDay ? eventDayKey(event) < localDayKey(now) : event.ts <= now
  const numeric = event.measures.filter(hasNumbers)
  const components = event.measures.filter((m) => !hasNumbers(m))
  return (
    <button
      type="button"
      className={`cal-row${past ? ' is-past' : ''}${event.impact === 'High' ? ' is-high' : ''}${event.allDay ? ' is-info' : ''}`}
      onClick={() => onOpen(event.id)}
      aria-haspopup="dialog"
      aria-label={rowLabel(event)}
    >
      <span className="cal-time mono">{event.allDay ? 'All day' : fmtTime(event.ts)}</span>
      <span className="cal-main">
        <span className="cal-title-line">
          <CountryTag country={event.country} />
          <span className="cal-title">{event.title}</span>
          <ImpactChip impact={event.impact} />
          {event.isReference && !event.allDay && <span className="kind-tag">schedule</span>}
        </span>
        {numeric.length > 0 && (
          <span className="cal-measures">
            {numeric.map((m) => (
              <span className="cal-measure" key={m.name}>
                <span className="cal-mname">{shortName(m.name)}</span>
                <span className={`cal-val mono ${m.actual ? 'cal-actual' : 'cal-pending'}`}>
                  {m.actual ?? (past ? missingActual(m, true) : '—')}
                  {m.surprise && (
                    <span className="surprise" aria-hidden="true">
                      {' '}
                      {surpriseGlyph(m.surprise)}
                    </span>
                  )}
                </span>
                <span className="cal-val mono">{m.forecast ?? '—'}</span>
                <span className="cal-val mono">{m.previous ?? '—'}</span>
              </span>
            ))}
          </span>
        )}
        {components.length > 0 && event.category === 'decision' && (
          <span className="cal-components">+ {components.map((m) => m.name.replace(/^FOMC /, '')).join(' · ')}</span>
        )}
      </span>
    </button>
  )
}

function DayGroup({
  dayKey,
  events,
  now,
  onOpen,
}: {
  dayKey: string
  events: MacroEvent[]
  now: number
  onOpen: (id: string) => void
}) {
  const rel = relativeDayLabel(dayKey, now)
  const isToday = rel === 'Today'
  const headId = `cal-day-${dayKey}`
  const nowIndex = isToday ? events.findIndex((e) => !e.allDay && e.ts > now) : -1
  return (
    <section className={`cal-day${isToday ? ' is-today' : ''}`} aria-labelledby={headId}>
      <h4 id={headId} className="cal-day-head">
        <span>{fmtCivilLongDay(dayKey)}</span>
        {rel && <span className="cal-rel">{rel}</span>}
      </h4>
      <ul className="cal-list">
        {events.map((e, i) => (
          <li key={e.id}>
            {i === nowIndex && (
              <div className="cal-now" aria-hidden="true">
                <span>Now · {fmtTime(now)}</span>
              </div>
            )}
            <EventRow event={e} now={now} onOpen={onOpen} />
          </li>
        ))}
        {isToday && nowIndex === -1 && (
          <li className="cal-now-end" aria-hidden="true">
            <div className="cal-now">
              <span>Now · {fmtTime(now)}</span>
            </div>
          </li>
        )}
      </ul>
    </section>
  )
}

function groupByLocalDay(events: MacroEvent[]): Array<[string, MacroEvent[]]> {
  const groups = new Map<string, MacroEvent[]>()
  for (const e of events) {
    const key = eventDayKey(e)
    const list = groups.get(key)
    if (list) list.push(e)
    else groups.set(key, [e])
  }
  // jours dans l'ordre ; dans un jour, les marqueurs « toute la journée » d'abord
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, list]) => [key, list.sort((x, y) => Number(y.allDay) - Number(x.allDay) || x.ts - y.ts)])
}

export function WeekCalendar({ data, now, onOpen }: { data: CalendarData; now: number; onOpen: (id: string) => void }) {
  const [region, setRegion] = useState<RegionKey>('all')
  const [highOnly, setHighOnly] = useState(false)

  const { thisWeek, nextWeek } = useMemo(() => {
    const filtered = data.events.filter(
      (e) => (region === 'all' || e.country === region) && (!highOnly || e.impact === 'High' || e.allDay),
    )
    const split = data.window.from + 7 * DAY
    return {
      thisWeek: groupByLocalDay(filtered.filter((e) => e.ts < split)),
      nextWeek: groupByLocalDay(filtered.filter((e) => e.ts >= split)),
    }
  }, [data, region, highOnly])

  return (
    <div className="cal">
      <div className="cal-filters">
        <div className="seg" role="group" aria-label="Region">
          {REGIONS.map((r) => (
            <button key={r.key} type="button" aria-pressed={region === r.key} onClick={() => setRegion(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        <button type="button" className="toggle-btn" aria-pressed={highOnly} onClick={() => setHighOnly((v) => !v)}>
          High impact only
        </button>
      </div>

      <div className="cal-colhead" aria-hidden="true">
        <span>Time</span>
        <span className="cal-colhead-main">
          <span>Event</span>
          <span>Actual</span>
          <span>Fcst</span>
          <span>Prev</span>
        </span>
      </div>

      <section className="cal-week" aria-labelledby="cal-this-week">
        <h3 id="cal-this-week" className="cal-week-head">
          This week
        </h3>
        {thisWeek.length === 0 ? (
          <p className="panel-note">No curated event matches these filters this week.</p>
        ) : (
          thisWeek.map(([key, events]) => <DayGroup key={key} dayKey={key} events={events} now={now} onOpen={onOpen} />)
        )}
      </section>

      <section className="cal-week" aria-labelledby="cal-next-week">
        <h3 id="cal-next-week" className="cal-week-head">
          Next week
        </h3>
        {!data.nextWeekPublished && (
          <p className="panel-note">
            The detailed calendar for next week is published by the feed late in the week. Central-bank meetings
            below come from official schedules.
          </p>
        )}
        {nextWeek.length === 0 ? (
          <p className="panel-note">
            {data.nextWeekPublished
              ? 'No curated event matches these filters next week.'
              : 'No scheduled central-bank decision next week.'}
          </p>
        ) : (
          nextWeek.map(([key, events]) => <DayGroup key={key} dayKey={key} events={events} now={now} onOpen={onOpen} />)
        )}
      </section>
    </div>
  )
}

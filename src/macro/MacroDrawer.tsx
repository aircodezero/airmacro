import { useEffect, useId, useRef } from 'react'
import { eventExplainer, indicatorExplainer } from '../../shared/macro/explainers.mjs'
import { formatCountdown } from '../../shared/analytics/macrotime.mjs'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { relativeTime } from '../lib/format'
import { AskAI } from './AskAI'
import { CountryTag, ImpactChip, KindTag } from './chips'
import { MacroTimeChart } from './charts/MacroTimeChart'
import { chartForEvent, chartForTile, suggestionsFor, type DrawerChart } from './drawerCharts'
import {
  COUNTRY_NAMES,
  decisionSentence,
  fmtDeltaBase,
  fmtIsoDate,
  fmtLocalDateTime,
  fmtNyTime,
  fmtPeriod,
  fmtTileDelta,
  fmtTileValue,
  fmtUtcTime,
} from './format'
import { DataTable } from './MacroPanels'
import { MeasuresTable } from './MeasuresTable'
import { joinTable } from './summaries'
import type { CalendarData, MacroEvent, MacroSelection, SeriesData, Tile } from './types'
import { useNow } from './useNow'

interface Explainer {
  title: string
  what: string
  why: string
  read: string
}

function ExplainerBlock({ explainer }: { explainer: Explainer | null }) {
  const id = useId()
  if (!explainer) return null
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="drawer-subtitle">
        {explainer.title}
      </h3>
      <dl className="explain">
        <div>
          <dt>What it is</dt>
          <dd>{explainer.what}</dd>
        </div>
        <div>
          <dt>Why it matters</dt>
          <dd>{explainer.why}</dd>
        </div>
        <div>
          <dt>How to read it</dt>
          <dd>{explainer.read}</dd>
        </div>
      </dl>
    </section>
  )
}

function ChartSection({ chart, ariaLabel }: { chart: DrawerChart; ariaLabel: string }) {
  const id = useId()
  const period = chart.table.period
  const label = (d: string) => (period === 'daily' ? fmtIsoDate(d) : fmtPeriod(d, period))
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="drawer-subtitle">
        {chart.title}
      </h3>
      <MacroTimeChart
        series={chart.series}
        height={220}
        format={chart.format}
        dateStyle={chart.dateStyle}
        priceLines={chart.priceLines}
        ariaLabel={ariaLabel}
      />
      <DataTable
        caption={`${chart.title} — latest values`}
        columns={['Period', 'Value']}
        rows={joinTable([{ label: 'Value', rows: chart.table.rows, format: chart.table.format }], label, 8)}
      />
    </section>
  )
}

function eventSources(event: MacroEvent): string {
  const s = new Set(event.sources)
  if (s.has('faireconomy') && s.has('reference')) return 'Calendar feed (FairEconomy), confirmed against the official schedule'
  if (s.has('reference')) return 'Official meeting schedule (not yet confirmed by the live calendar feed)'
  return 'Calendar feed (FairEconomy)'
}

function EventDetails({ event, now }: { event: MacroEvent; now: number }) {
  const released = !event.allDay && event.ts <= now
  const statement = event.decision?.url ?? null
  return (
    <>
      <section aria-label="Timing">
        <dl className="stats-grid">
          <div>
            <dt>Your time</dt>
            <dd className="mono">
              {event.allDay
                ? `${fmtIsoDate(event.meeting?.start ?? new Date(event.ts).toISOString())} · all day (${event.meeting?.bank === 'ECB' ? 'Frankfurt' : 'New York'})`
                : fmtLocalDateTime(event.ts)}
            </dd>
          </div>
          <div>
            <dt>New York · UTC</dt>
            <dd className="mono">{event.allDay ? '—' : `${fmtNyTime(event.ts)} · ${fmtUtcTime(event.ts)}`}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              {event.allDay
                ? 'Meeting day'
                : released
                  ? `Released ${relativeTime(event.ts)}`
                  : `In ${formatCountdown(event.ts - now)}`}
            </dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>{COUNTRY_NAMES[event.country] ?? event.country}</dd>
          </div>
        </dl>
      </section>

      {(event.measures.length > 0 || !event.allDay) && (
        <section aria-label="Figures">
          {event.measures.length > 0 ? (
            <MeasuresTable measures={event.measures} released={released} showSources />
          ) : (
            <p className="panel-note">No consensus figures in the calendar feed for this item.</p>
          )}
        </section>
      )}

      {event.decision && (
        <section aria-label="Decision" className="decision-box">
          <p className="hero-decision">{decisionSentence(event.decision)}</p>
          <p className="hero-caption">
            From the official FOMC statement
            {event.decision.vote ? ` · vote ${event.decision.vote.for}–${event.decision.vote.against}` : ''}
          </p>
        </section>
      )}

      {event.meeting && (
        <p className="hero-note">
          {event.meeting.bank === 'Fed' ? 'FOMC' : 'ECB Governing Council'} meeting {fmtIsoDate(event.meeting.start)} –{' '}
          {fmtIsoDate(event.meeting.end)}
          {event.meeting.sep ? ', with the Summary of Economic Projections (dot plot)' : ''}.
        </p>
      )}

      <p className="drawer-links">
        {statement && (
          <a className="panel-link" href={statement} target="_blank" rel="noopener noreferrer">
            Read the FOMC statement ↗
          </a>
        )}
        {(event.links ?? []).map((l) => (
          <a key={l.url} className="panel-link" href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label} ↗
          </a>
        ))}
      </p>

      <p className="panel-note">Source: {eventSources(event)}.</p>
    </>
  )
}

function EventChart({ event, series }: { event: MacroEvent; series: SeriesData | undefined }) {
  const chart = series ? chartForEvent(event, series.charts) : null
  if (!chart || !chart.series.some((s) => s.data.length > 0)) return null
  return <ChartSection chart={chart} ariaLabel={`${chart.title}: history related to ${event.title}.`} />
}

function IndicatorDetails({ tile, series }: { tile: Tile; series: SeriesData }) {
  const chart = chartForTile(tile.key, series.charts)
  const family = series.families[tile.family]
  const delta = fmtTileDelta(tile)
  return (
    <>
      <section aria-label="Latest value" className="ind-head">
        <p className="ind-value">{fmtTileValue(tile)}</p>
        <p className="mono ind-delta">
          {delta ?? '—'} <span className="muted">{fmtDeltaBase(tile)}</span>
        </p>
        <p className="muted text-sm">
          {tile.key === 'fedTarget' ? `As of ${fmtIsoDate(tile.date)}` : fmtPeriod(tile.date, tile.period)}
          {tile.key === 'fedTarget' && tile.effr ? ` · effective rate ${tile.effr.value.toFixed(2)}% (${fmtIsoDate(tile.effr.date)})` : ''}
          {tile.key === 'nfp' && tile.avg3 != null ? ` · 3-month average ${tile.avg3 > 0 ? '+' : ''}${tile.avg3}k` : ''}
        </p>
      </section>
      {chart && chart.series.some((s) => s.data.length > 0) && (
        <ChartSection chart={chart} ariaLabel={`${chart.title}, full history shown in AirMacro.`} />
      )}
      <p className="panel-note ind-source">
        Source: {series.meta.sourcesBySerie[tile.key] ?? tile.provider ?? 'unknown'}{' '}
        {family?.source && <FreshnessBadge source={family.source} asOf={family.fetchedAt ?? undefined} provider={family.provider ?? undefined} />}
      </p>
    </>
  )
}

interface DrawerProps {
  selection: MacroSelection
  calendar: CalendarData | undefined
  series: SeriesData | undefined
  onClose: () => void
}

export function MacroDrawer({ selection, calendar, series, onClose }: DrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const now = useNow(15_000)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      // la fermeture passe par l'événement natif « close » : la page est déjà active ici,
      // le focus peut revenir à l'élément d'origine (pas de close() : StrictMode rejoue ce nettoyage)
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  // Fermeture native (Échap, bouton, fond) : le démontage suit l'événement « close »
  const requestClose = () => dialogRef.current?.close()

  const event = selection.type === 'event' ? (calendar?.events.find((e) => e.id === selection.id) ?? null) : null
  const tile = selection.type === 'indicator' ? (series?.tiles[selection.key] ?? null) : null
  const title = event?.title ?? tile?.label ?? 'Details'
  const explainer: Explainer | null = event ? eventExplainer(event) : tile ? indicatorExplainer(tile.key) : null

  return (
    <dialog
      ref={dialogRef}
      className="drawer mdrawer"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) requestClose()
      }}
    >
      <div className="drawer-inner">
        <header className="drawer-head">
          <div className="drawer-title">
            {event && (
              <div className="hero-tags">
                <CountryTag country={event.country} />
                <KindTag kind={event.kind} />
                <ImpactChip impact={event.impact} />
              </div>
            )}
            {tile && <p className="kind-tag">Indicator</p>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="btn" onClick={requestClose}>
            Close
          </button>
        </header>

        {event ? (
          <EventDetails event={event} now={now} />
        ) : tile && series ? (
          <IndicatorDetails tile={tile} series={series} />
        ) : (
          <p className="panel-note">This item is no longer in the loaded data.</p>
        )}

        <ExplainerBlock explainer={explainer} />

        {(event || tile) && (
          <AskAI
            key={selection.type === 'event' ? `e:${selection.id}` : `i:${selection.key}`}
            contextType={selection.type}
            id={selection.type === 'event' ? selection.id : selection.key}
            suggestions={event ? suggestionsFor({ type: 'event', event }) : suggestionsFor({ type: 'indicator', key: tile!.key })}
          />
        )}

        {event && <EventChart event={event} series={series} />}

        <p className="drawer-disclaimer">
          AirMacro is an information tool built on public data. Consensus forecasts come from the calendar feed;
          actual figures from official statistics. Not investment advice.
        </p>
      </div>
    </dialog>
  )
}

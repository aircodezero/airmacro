/*
 * AirMacro — page principale : prochain événement, politique de la Fed, calendrier,
 * indicateurs et graphiques ; fiche détaillée (explication, IA) en tiroir.
 * Indépendante du routeur : l'app fournit le lien de notification éventuel.
 */
import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Panel } from '../components/Panel'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { ErrorState, LoadingState } from '../components/ErrorState'
import { qMacroCalendar, qMacroSeries } from './queries'
import { HeroNextUp } from './HeroNextUp'
import { WeekCalendar } from './WeekCalendar'
import { IndicatorTiles } from './IndicatorTiles'
import { MacroPanels } from './MacroPanels'
import { PolicyCorner } from './PolicyCorner'
import { MacroDrawer } from './MacroDrawer'
import { useNow } from './useNow'
import { useMediaQuery } from './useMediaQuery'
import type { Source } from '../lib/api'
import type { MacroSelection, TileKey } from './types'

interface MacroPageProps {
  /** Événement à ouvrir (lien d'une notification), déjà validé par le routeur. */
  linkedEvent?: string
  /** Fiche ouverte par lien refermée : l'app nettoie l'URL. */
  onLinkClosed?: () => void
}

export function MacroPage({ linkedEvent, onLinkClosed }: MacroPageProps) {
  const calendar = useQuery(qMacroCalendar())
  const series = useQuery(qMacroSeries())
  const now = useNow(30_000)
  const wide = useMediaQuery('(min-width: 1101px)')
  const phone = useMediaQuery('(max-width: 759px)')
  const [selection, setSelection] = useState<MacroSelection | null>(null)
  const openEvent = useCallback((id: string) => setSelection({ type: 'event', id }), [])
  const openIndicator = useCallback((key: TileKey) => setSelection({ type: 'indicator', key }), [])

  const cal = calendar.data?.data
  const ser = series.data?.data

  // lien de notification : la fiche s'ouvre une fois le calendrier chargé
  const [handledLink, setHandledLink] = useState<string | undefined>(undefined)
  if (linkedEvent !== handledLink && (!linkedEvent || cal || calendar.isError)) {
    setHandledLink(linkedEvent)
    if (linkedEvent) setSelection({ type: 'event', id: linkedEvent })
  }
  const closeDrawer = () => {
    setSelection(null)
    if (linkedEvent) onLinkClosed?.()
  }
  const tilesSource: Source | null = ser
    ? Object.values(ser.families).some((f) => f?.source === 'seed')
      ? 'seed'
      : Object.values(ser.families).some((f) => f?.source === 'cache')
        ? 'cache'
        : 'live'
    : null

  const hero = calendar.isPending ? (
    <Panel title="Next up" className="hero">
      <LoadingState label="Loading the calendar…" />
    </Panel>
  ) : calendar.isError || !cal ? (
    <Panel title="Next up" className="hero">
      <ErrorState message="Calendar temporarily unavailable." onRetry={() => calendar.refetch()} />
    </Panel>
  ) : (
    <HeroNextUp
      events={cal.events}
      source={cal.parts.calendar ?? calendar.data.source}
      asOf={cal.families.calendar?.fetchedAt ?? calendar.data.asOf}
      provider={cal.families.calendar?.provider ?? undefined}
      fallbackMeeting={cal.policy.nextFomc}
      onOpen={openEvent}
    />
  )

  const policyCorner = (ser || cal) && (
    <PolicyCorner
      policy={ser?.policy ?? null}
      meetings={cal?.policy ?? null}
      families={[ser?.families.nyfed ?? null, ser?.families.fed ?? null]}
      now={now}
    />
  )

  const calendarPanel = (
    <Panel
      className="cal-panel"
      title="Economic calendar"
      meta={cal ? `${cal.counts.high} high-impact · US, euro area, UK, Japan` : undefined}
      labelledBy="cal-title"
      actions={
        cal && (
          <FreshnessBadge
            source={cal.parts.calendar ?? 'seed'}
            asOf={cal.families.calendar?.fetchedAt ?? undefined}
            provider={cal.families.calendar?.provider ?? undefined}
          />
        )
      }
    >
      {calendar.isPending ? (
        <LoadingState label="Loading events…" />
      ) : calendar.isError || !cal ? (
        <ErrorState message="Events unavailable." onRetry={() => calendar.refetch()} />
      ) : (
        <>
          <WeekCalendar data={cal} now={now} onOpen={openEvent} />
          <p className="panel-note cal-footnote">
            Actual figures are read from each official publisher (BLS, BEA, Fed, Labor Department, Census, ONS, Bank of
            England, ECB, Eurostat, Bank of Japan, ISM…) within minutes of release; “n/a” means no free official source
            publishes that figure.
          </p>
        </>
      )}
    </Panel>
  )

  const tilesPanel = (
    <Panel
      className="tiles-panel"
      title="Key indicators"
      meta="latest official prints · select a tile for details"
      actions={
        series.data &&
        tilesSource && (
          <FreshnessBadge
            source={tilesSource}
            asOf={series.data.asOf}
            provider="BLS · BEA · Treasury · NY Fed · Cboe · ECB · EIA"
          />
        )
      }
    >
      {series.isPending ? (
        <LoadingState label="Loading indicators…" />
      ) : series.isError || !ser ? (
        <ErrorState message="Indicators temporarily unavailable." onRetry={() => series.refetch()} />
      ) : (
        <IndicatorTiles data={ser} onOpen={openIndicator} />
      )}
    </Panel>
  )

  const charts = (
    <div className="macro-charts">
      {series.isPending ? (
        <Panel title="Charts">
          <LoadingState label="Loading charts…" />
        </Panel>
      ) : series.isError || !ser ? (
        <Panel title="Charts">
          <ErrorState message="Charts temporarily unavailable." onRetry={() => series.refetch()} />
        </Panel>
      ) : (
        <MacroPanels data={ser} />
      )}
    </div>
  )

  return (
    <div className="macro-page">
      {wide ? (
        <div className="macro-grid">
          <div className="macro-left">
            {hero}
            {policyCorner}
            {calendarPanel}
          </div>
          <div className="macro-right">
            {tilesPanel}
            {charts}
          </div>
        </div>
      ) : phone ? (
        // téléphone : l'ordre DOM suit l'ordre visuel (focus clavier cohérent)
        <div className="macro-flow is-phone">
          {hero}
          {tilesPanel}
          {calendarPanel}
          {policyCorner}
          {charts}
        </div>
      ) : (
        <div className="macro-flow">
          {hero}
          {policyCorner}
          {tilesPanel}
          {calendarPanel}
          {charts}
        </div>
      )}

      {selection && <MacroDrawer selection={selection} calendar={cal} series={ser} onClose={closeDrawer} />}
    </div>
  )
}

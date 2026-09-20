import { useMemo } from 'react'
import { dayKey, formatCountdown, pickHero } from '../../shared/analytics/macrotime.mjs'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { relativeTime } from '../lib/format'
import type { Source } from '../lib/api'
import { CountryTag, ImpactChip, KindTag } from './chips'
import { MeasuresTable } from './MeasuresTable'
import {
  decisionSentence,
  fmtCivilLongDay,
  fmtLongDay,
  fmtNyTime,
  fmtTime,
  fmtUtcTime,
  localOffsetLabel,
  surpriseLabel,
} from './format'
import type { MacroEvent, PolicyMeeting } from './types'
import { useNow } from './useNow'

const MIN = 60_000

/** Nuance d'une réunion sur deux jours (jour 1 / jour de décision). */
function meetingNote(event: MacroEvent, now: number): string | null {
  const m = event.meeting
  if (!m || event.category !== 'decision') return null
  const tz = m.bank === 'Fed' ? 'America/New_York' : 'Europe/Berlin'
  const today = dayKey(now, tz)
  const sep = m.sep ? ' Includes the Summary of Economic Projections (dot plot).' : ''
  const presser = 'press conference 30 min later'
  if (now < m.day1Ts) return `Two-day meeting starts ${fmtCivilLongDay(m.start)}; decision on day 2 at ${fmtTime(m.decisionTs)}.${sep}`
  if (today === m.start && now < m.decisionTs)
    return `Meeting in progress — day 1 of 2. Decision tomorrow at ${fmtTime(m.decisionTs)}, ${presser}.${sep}`
  if (today === m.end && now < m.decisionTs)
    return `Decision day — day 2 of 2. Statement at ${fmtTime(m.decisionTs)}, ${presser}.${sep}`
  return m.sep ? 'Meeting with the Summary of Economic Projections (dot plot).' : null
}

/** Annonce lecteur d'écran par paliers (évite une annonce à chaque seconde). */
function announcement(event: MacroEvent | null, now: number, released: boolean): string {
  if (!event) return ''
  if (released) return `${event.title} released${event.actual ? `: ${event.actual}` : ''}.`
  const left = event.ts - now
  const thresholds = [60, 30, 15, 5, 1]
  const crossed = thresholds.find((t) => left <= t * MIN)
  return crossed != null ? `${event.title} in less than ${crossed} minute${crossed > 1 ? 's' : ''}.` : ''
}

interface HeroProps {
  events: MacroEvent[]
  source: Source
  asOf?: string
  provider?: string
  fallbackMeeting: PolicyMeeting | null
  onOpen: (id: string) => void
}

export function HeroNextUp({ events, source, asOf, provider, fallbackMeeting, onOpen }: HeroProps) {
  // tick fin (1 s) dans les 10 dernières minutes, sinon 15 s
  const coarseNow = useNow(15_000)
  const upcoming = useMemo(() => pickHero(events, coarseNow).next, [events, coarseNow])
  const fine = upcoming != null && upcoming.ts - coarseNow < 11 * MIN
  const fineNow = useNow(fine ? 1000 : 60 * MIN)
  const now = fine ? Math.max(fineNow, coarseNow) : coarseNow
  const { current, next } = useMemo(() => pickHero(events, now), [events, now])

  const primary: MacroEvent | null = current ?? next
  const released = primary != null && primary === current
  const left = primary ? primary.ts - now : 0
  const offset = primary ? localOffsetLabel(primary.ts) : ''
  const note = primary ? meetingNote(primary, now) : null
  const link =
    primary?.decision?.url != null
      ? { label: 'Read the FOMC statement', url: primary.decision.url }
      : (primary?.links?.[0] ?? null)

  return (
    <section className="panel hero" aria-labelledby="hero-title">
      <div className="panel-head">
        <div className="panel-title">
          <h2 id="hero-title">{released ? 'Just released' : 'Next up'}</h2>
          <small>major releases & central banks</small>
        </div>
        <div className="panel-actions">
          <FreshnessBadge source={source} asOf={asOf} provider={provider} />
        </div>
      </div>

      <div className="panel-body hero-body">
        {!primary ? (
          <div className="hero-empty">
            <p>No major release left in the loaded two-week window.</p>
            {fallbackMeeting && (
              <p className="muted">
                Next FOMC decision: {fmtLongDay(fallbackMeeting.decisionTs)} at {fmtTime(fallbackMeeting.decisionTs)} ·{' '}
                in {formatCountdown(fallbackMeeting.decisionTs - now)}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="hero-tags">
              <CountryTag country={primary.country} />
              <KindTag kind={primary.kind} />
              <ImpactChip impact={primary.impact} />
              {primary.meeting?.sep && (
                <abbr className="kind-tag" title="Summary of Economic Projections (dot plot)">
                  SEP
                </abbr>
              )}
              {primary.isReference && (
                <span className="kind-tag" title="From the official meeting schedule (live calendar feed not yet confirming)">
                  official schedule
                </span>
              )}
            </div>
            <h3 className="hero-title">{primary.title}</h3>
            <p className="hero-when">
              <span>
                {fmtLongDay(primary.ts)} · <strong>{fmtTime(primary.ts)}</strong> ({offset})
              </span>
              <span className="muted">
                {' '}
                · {fmtNyTime(primary.ts)} · {fmtUtcTime(primary.ts)}
              </span>
            </p>

            {released ? (
              <div className="hero-result">
                {primary.decision ? (
                  <p className="hero-decision">{decisionSentence(primary.decision)}</p>
                ) : primary.actual ? (
                  <p className="hero-decision">
                    {primary.measures[0]?.name}: {primary.actual}
                    {primary.measures[0]?.surprise ? ` (${surpriseLabel(primary.measures[0].surprise)})` : ''}
                  </p>
                ) : primary.actualFrom ? (
                  <p className="hero-decision muted">Figures pending — official source: {primary.actualFrom}</p>
                ) : (
                  <p className="hero-decision muted">No free official source publishes this figure in real time</p>
                )}
                <p className="hero-caption">
                  Released {relativeTime(primary.ts)}
                  {primary.decision?.vote ? ` · vote ${primary.decision.vote.for}–${primary.decision.vote.against}` : ''}
                </p>
              </div>
            ) : (
              <div className="hero-countdown">
                <span className="hero-figure mono" role="timer" aria-label={`Time left: ${formatCountdown(left)}`}>
                  {formatCountdown(left, fine)}
                </span>
                <span className="hero-caption">
                  until {primary.category === 'decision' ? 'the decision' : primary.category === 'presser' ? 'the press conference' : primary.category === 'speech' ? 'the speech' : 'the release'}
                </span>
              </div>
            )}

            <MeasuresTable measures={primary.measures} released={released} />
            {note && <p className="hero-note">{note}</p>}

            <div className="hero-actions">
              <button type="button" className="btn btn-primary" onClick={() => onOpen(primary.id)} aria-haspopup="dialog">
                Details & explanation
              </button>
              {link && (
                <a className="panel-link" href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.label} ↗
                </a>
              )}
            </div>

            {released && next && (
              <p className="hero-upnext">
                Up next:{' '}
                <button type="button" className="linklike" onClick={() => onOpen(next.id)} aria-haspopup="dialog">
                  {next.title}
                </button>{' '}
                · {fmtTime(next.ts)} · in {formatCountdown(next.ts - now)}
              </p>
            )}
          </>
        )}
        <p className="sr-only" aria-live="polite">
          {announcement(primary, now, released)}
        </p>
      </div>
    </section>
  )
}

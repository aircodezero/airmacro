import { surpriseGlyph, surpriseLabel } from './format'
import type { Measure } from './types'

export const hasNumbers = (m: Measure) => m.actual != null || m.forecast != null || m.previous != null

/** Cellule « Actual » sans chiffre : en attente si une source officielle le publiera, sinon n/a. */
export const missingActual = (m: Measure, released: boolean) => (released && !m.actualFrom ? 'n/a' : 'pending')

/** Phrase de provenance sous la table (fiche détaillée). */
function sourcesNote(numeric: Measure[], released: boolean): string {
  const sources = [...new Set(numeric.map((m) => m.actualSource).filter((s): s is string => Boolean(s)))]
  const waiting = numeric.filter((m) => m.actual == null && m.actualFrom)
  const publishers = [...new Set(waiting.map((m) => m.actualFrom as string))].join(' · ')
  const unsourced = numeric.some((m) => m.actual == null && !m.actualFrom)
  if (sources.length) {
    const rest = waiting.length ? ` Other figures pending from ${publishers}.` : unsourced ? ' No free official source for the other figures.' : ''
    return `Actual from ${sources.join(' · ')}. Forecast = market consensus.${rest}`
  }
  if (waiting.length) {
    return released
      ? `Waiting for the official figure from ${publishers} — it appears here as soon as it is published.`
      : `Forecast = market consensus from the calendar feed; the actual will come from ${publishers} once published.`
  }
  return released
    ? 'No free official source publishes this actual in real time — forecast and previous shown only.'
    : 'Forecast = market consensus from the calendar feed. No free official source publishes this actual in real time.'
}

/** Table Actual / Forecast / Previous d'une publication (+ composantes sans chiffres). */
export function MeasuresTable({ measures, released, showSources = false }: { measures: Measure[]; released: boolean; showSources?: boolean }) {
  const numeric = measures.filter(hasNumbers)
  const components = measures.filter((m) => !hasNumbers(m))
  if (!numeric.length && !components.length) return null
  return (
    <>
      {numeric.length > 0 && (
        <div className="table-scroll">
          <table className="hero-measures">
            <caption className="sr-only">Figures for this release</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Actual</th>
                <th scope="col">Forecast</th>
                <th scope="col">Previous</th>
              </tr>
            </thead>
            <tbody>
              {numeric.map((m) => (
                <tr key={m.name}>
                  <th scope="row">{m.name}</th>
                  <td className={m.actual ? 'hero-actual' : 'muted'}>
                    {m.actual ?? missingActual(m, released)}
                    {m.surprise && (
                      <span className="surprise" title={surpriseLabel(m.surprise) ?? undefined}>
                        {' '}
                        <span aria-hidden="true">{surpriseGlyph(m.surprise)}</span>
                        <span className="sr-only">{surpriseLabel(m.surprise)}</span>
                      </span>
                    )}
                  </td>
                  <td>{m.forecast ?? '—'}</td>
                  <td>{m.previous ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {components.length > 0 && (
        <p className="hero-components">
          Also at this time: {components.map((m) => m.name.replace(/^FOMC /, '')).join(' · ')}
        </p>
      )}
      {showSources && numeric.length > 0 && <p className="hero-components">{sourcesNote(numeric, released)}</p>}
    </>
  )
}

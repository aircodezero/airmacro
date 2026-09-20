/*
 * Résumés textuels des graphiques (le texte porte l'information, pas la couleur)
 * et tables de données jumelles. Fonctions pures, testées.
 */
import type { PolicyData, SeriesData, SeriesPoint } from './types'

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortMonthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

const ts = (d: string) => Date.parse(`${d}T00:00:00Z`)
export const monthName = (d: string) => monthFmt.format(ts(d))
export const shortMonth = (d: string) => shortMonthFmt.format(ts(d))
export const dayName = (d: string) => dayFmt.format(ts(d))
export const quarterName = (d: string) => `Q${Math.floor(Number(d.slice(5, 7)) / 3) + 1} ${d.slice(0, 4)}`

const last = <T,>(rows: T[]): T | undefined => rows[rows.length - 1]
const prev = <T,>(rows: T[]): T | undefined => rows[rows.length - 2]

const pct = (v: number, digits = 1) => `${v.toFixed(digits)}%`
const signed = (v: number, digits = 0, unit = '') =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}${unit}`

export function inflationSummary(c: SeriesData['charts']['inflation']): string | null {
  const cpi = last(c.cpiYoY)
  const core = last(c.coreCpiYoY)
  const pce = last(c.corePceYoY)
  if (!cpi && !core && !pce) return null
  const parts: string[] = []
  if (cpi) {
    const before = prev(c.cpiYoY)
    parts.push(
      `CPI inflation was ${pct(cpi.v)} year over year in ${monthName(cpi.d)}${before ? ` (${shortMonth(before.d).split(' ')[0]}: ${pct(before.v)})` : ''}`,
    )
  }
  if (core) parts.push(`core CPI ${pct(core.v)}`)
  let text = `${parts.join('; ')}.`
  if (pce) text += ` Core PCE, the Fed’s preferred gauge, was ${pct(pce.v)} in ${monthName(pce.d)}.`
  const latest = [cpi, core, pce].filter((p): p is SeriesPoint => p != null)
  const above = latest.filter((p) => p.v > c.target).length
  text +=
    above === latest.length
      ? ` All ${latest.length === 3 ? 'three measures are' : 'measures are'} above the ${c.target}% target.`
      : above === 0
        ? ` All measures are at or below the ${c.target}% target.`
        : ` ${above} of ${latest.length} measures are above the ${c.target}% target.`
  return text
}

export function laborSummary(c: SeriesData['charts']['labor']): string | null {
  const nfp = last(c.nfpMoM)
  const u = last(c.unrate)
  if (!nfp && !u) return null
  const out: string[] = []
  if (nfp) {
    const three = c.nfpMoM.slice(-3)
    const avg = three.reduce((a, r) => a + r.v, 0) / three.length
    const verb = nfp.v >= 0 ? 'rose by' : 'fell by'
    out.push(`Payrolls ${verb} ${Math.abs(nfp.v).toFixed(0)}k in ${monthName(nfp.d)} (3-month average ${signed(avg, 0, 'k')}).`)
  }
  if (u) {
    const before = prev(c.unrate)
    const move = before == null ? '' : u.v > before.v ? `, up from ${pct(before.v)}` : u.v < before.v ? `, down from ${pct(before.v)}` : ', unchanged'
    out.push(`The unemployment rate was ${pct(u.v)} in ${monthName(u.d)}${move}.`)
  }
  return out.join(' ')
}

export function ratesSummary(c: SeriesData['charts']['rates'], policy: PolicyData | null): string | null {
  const y10 = last(c.y10)
  const m3 = last(c.m3)
  const sp = last(c.spread10y3m)
  if (!y10 && !policy?.target) return null
  const out: string[] = []
  if (y10 && m3 && sp) {
    const bp = Math.round(sp.v * 100)
    const lo = Math.round(Math.min(...c.spread10y3m.map((r) => r.v)) * 100)
    const hi = Math.round(Math.max(...c.spread10y3m.map((r) => r.v)) * 100)
    out.push(
      `On ${dayName(y10.d)} the 10-year yield was ${pct(y10.v, 2)} and the 3-month bill ${pct(m3.v, 2)}: the 10Y–3M spread is ${signed(bp, 0, ' bp')} (${bp < 0 ? 'inverted curve' : 'curve not inverted'}; range over the period ${signed(lo, 0)} to ${signed(hi, 0)} bp).`,
    )
  }
  if (policy?.target) {
    const t = policy.target
    out.push(
      `The Fed’s target range is ${pct(t.lower, 2)}–${pct(t.upper, 2)}${policy.effr ? ` (effective rate ${pct(policy.effr.value, 2)})` : ''}.`,
    )
  }
  return out.join(' ')
}

export function growthSummary(c: SeriesData['charts']['growthRisk']): string | null {
  const gdp = last(c.gdpQoQ)
  const vix = last(c.vix)
  if (!gdp && !vix) return null
  const out: string[] = []
  if (gdp) {
    const before = prev(c.gdpQoQ)
    out.push(
      `Real GDP ${gdp.v >= 0 ? 'grew' : 'contracted'} at a ${pct(Math.abs(gdp.v))} annualized rate in ${quarterName(gdp.d)}${before ? ` (${quarterName(before.d).split(' ')[0]}: ${signed(before.v, 1, '%')})` : ''}.`,
    )
  }
  if (vix) {
    const values = c.vix.map((r) => r.v)
    out.push(
      `The VIX closed at ${vix.v.toFixed(2)} on ${dayName(vix.d)} (two-year range ${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)}).`,
    )
  }
  return out.join(' ')
}

/**
 * Table jumelle : jointure par date des séries, `limit` dernières dates, colonnes formatées.
 * Les séries en escalier prennent leur dernière valeur connue.
 */
export function joinTable(
  columns: Array<{ label: string; rows: SeriesPoint[]; format: (v: number) => string; asOf?: boolean }>,
  dateLabel: (d: string) => string,
  limit: number,
  driver = 0,
): string[][] {
  const dates = columns[driver]?.rows.slice(-limit).map((r) => r.d) ?? []
  return dates
    .slice()
    .reverse()
    .map((d) => [
      dateLabel(d),
      ...columns.map((col) => {
        let found: SeriesPoint | undefined
        if (col.asOf) {
          for (const r of col.rows) {
            if (r.d <= d) found = r
            else break
          }
        } else {
          found = col.rows.find((r) => r.d === d)
        }
        return found ? col.format(found.v) : '—'
      }),
    ])
}

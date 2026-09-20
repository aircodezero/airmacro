import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Panel } from '../components/Panel'
import { FreshnessBadge } from '../components/FreshnessBadge'
import type { Source } from '../lib/api'
import { MACRO_COLORS } from './colors'
import { MacroTimeChart, toPoints } from './charts/MacroTimeChart'
import {
  dayName,
  growthSummary,
  inflationSummary,
  joinTable,
  laborSummary,
  quarterName,
  ratesSummary,
  shortMonth,
} from './summaries'
import type { FamilyKey, SeriesData } from './types'

export function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: string[][] }) {
  if (!rows.length) return null
  return (
    <details className="mtable">
      <summary>Data table</summary>
      <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
        <table className="data">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={i}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

const pct1 = (v: number) => `${v.toFixed(1)}%`
const pct2 = (v: number) => `${v.toFixed(2)}%`
const kFmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}k`
const bpFmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))} bp`

/** Source la moins fraîche d'un ensemble de familles, avec fournisseurs listés. */
function familyBadge(data: SeriesData, keys: FamilyKey[]) {
  const metas = keys.map((k) => data.families[k]).filter((m) => m != null)
  if (!metas.length) return null
  const rank: Record<Source, number> = { live: 0, cache: 1, seed: 2 }
  let worst: Source = 'live'
  for (const m of metas) if (m.source && rank[m.source] > rank[worst]) worst = m.source
  const fetched = metas.map((m) => m.fetchedAt).filter((d): d is string => Boolean(d)).sort()[0]
  const providers = [...new Set(metas.map((m) => m.provider).filter(Boolean))].join(' · ')
  return <FreshnessBadge source={worst} asOf={fetched} provider={providers} />
}

function ChartBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <figure className="mchart-block">
      <figcaption className="mchart-caption">{title}</figcaption>
      {children}
    </figure>
  )
}

export function MacroPanels({ data }: { data: SeriesData }) {
  const c = data.charts
  const inflation = useMemo(
    () => [
      { key: 'cpi', label: 'CPI', color: MACRO_COLORS.cpi, kind: 'line' as const, data: toPoints(c.inflation.cpiYoY) },
      { key: 'coreCpi', label: 'Core CPI', color: MACRO_COLORS.coreCpi, kind: 'line' as const, data: toPoints(c.inflation.coreCpiYoY) },
      { key: 'corePce', label: 'Core PCE', color: MACRO_COLORS.corePce, kind: 'line' as const, data: toPoints(c.inflation.corePceYoY) },
    ].filter((s) => s.data.length > 0),
    [c.inflation],
  )
  const nfp = useMemo(
    () => [{ key: 'nfp', label: 'Payrolls change', color: MACRO_COLORS.reference, kind: 'bars' as const, data: toPoints(c.labor.nfpMoM) }],
    [c.labor.nfpMoM],
  )
  const unrate = useMemo(
    () => [{ key: 'unrate', label: 'Unemployment rate', color: MACRO_COLORS.unrate, kind: 'line' as const, data: toPoints(c.labor.unrate) }],
    [c.labor.unrate],
  )
  const levels = useMemo(
    () =>
      [
        { key: 'y10', label: '10Y yield', color: MACRO_COLORS.y10, kind: 'line' as const, data: toPoints(c.rates.y10) },
        { key: 'm3', label: '3M bill', color: MACRO_COLORS.m3, kind: 'line' as const, data: toPoints(c.rates.m3) },
        { key: 'fed', label: 'Fed target (upper)', color: MACRO_COLORS.fedTarget, kind: 'step' as const, data: toPoints(c.rates.fedTargetUpper) },
      ].filter((s) => s.data.length > 0),
    [c.rates],
  )
  const spreadSeries = useMemo(
    () => [{ key: 'spread', label: '10Y–3M spread', color: MACRO_COLORS.reference, kind: 'baseline' as const, data: toPoints(c.rates.spread10y3m) }],
    [c.rates.spread10y3m],
  )
  const gdp = useMemo(
    () => [{ key: 'gdp', label: 'Real GDP, % SAAR', color: MACRO_COLORS.reference, kind: 'bars' as const, data: toPoints(c.growthRisk.gdpQoQ) }],
    [c.growthRisk.gdpQoQ],
  )
  const vix = useMemo(
    () => [{ key: 'vix', label: 'VIX', color: MACRO_COLORS.vix, kind: 'line' as const, data: toPoints(c.growthRisk.vix) }],
    [c.growthRisk.vix],
  )

  const inflationText = inflationSummary(c.inflation)
  const laborText = laborSummary(c.labor)
  const ratesText = ratesSummary(c.rates, data.policy)
  const growthText = growthSummary(c.growthRisk)

  return (
    <div className="macro-panels">
      <Panel title="Inflation" meta="% year over year" actions={familyBadge(data, ['bls', 'bea'])} className="mpanel">
        {inflation.length ? (
          <>
            <MacroTimeChart
              series={inflation}
              height={220}
              dateStyle="month"
              format={pct1}
              priceLines={[{ value: c.inflation.target, label: '2% target' }]}
              ariaLabel={`Line chart of CPI, core CPI and core PCE inflation since 2022. ${inflationText ?? ''}`}
            />
            {inflationText && <p className="chart-summary">{inflationText}</p>}
            <DataTable
              caption="Inflation, % year over year, latest 12 months"
              columns={['Month', 'CPI', 'Core CPI', 'Core PCE']}
              rows={joinTable(
                [
                  { label: 'CPI', rows: c.inflation.cpiYoY, format: pct1 },
                  { label: 'Core CPI', rows: c.inflation.coreCpiYoY, format: pct1 },
                  { label: 'Core PCE', rows: c.inflation.corePceYoY, format: pct1 },
                ],
                shortMonth,
                12,
              )}
            />
          </>
        ) : (
          <p className="panel-note">Inflation series unavailable.</p>
        )}
      </Panel>

      <Panel title="Labor market" meta="payrolls & unemployment" actions={familyBadge(data, ['bls'])} className="mpanel">
        {c.labor.nfpMoM.length || c.labor.unrate.length ? (
          <>
            <ChartBlock title="Monthly payroll change, thousands">
              <MacroTimeChart
                series={nfp}
                height={130}
                dateStyle="month"
                format={kFmt}
                ariaLabel={`Bar chart of monthly nonfarm payroll changes over three years. ${laborText ?? ''}`}
              />
            </ChartBlock>
            <ChartBlock title="Unemployment rate, %">
              <MacroTimeChart
                series={unrate}
                height={100}
                dateStyle="month"
                format={pct1}
                ariaLabel="Line chart of the unemployment rate over three years."
              />
            </ChartBlock>
            {laborText && <p className="chart-summary">{laborText}</p>}
            <DataTable
              caption="Labor market, latest 12 months"
              columns={['Month', 'Payrolls', 'Unemployment']}
              rows={joinTable(
                [
                  { label: 'Payrolls', rows: c.labor.nfpMoM, format: kFmt },
                  { label: 'Unemployment', rows: c.labor.unrate, format: pct1 },
                ],
                shortMonth,
                12,
              )}
            />
          </>
        ) : (
          <p className="panel-note">Labor series unavailable.</p>
        )}
      </Panel>

      <Panel title="Rates & curve" meta="Treasury yields, Fed target" actions={familyBadge(data, ['treasury', 'nyfed'])} className="mpanel">
        {levels.length ? (
          <>
            <ChartBlock title="Yields and policy rate, %">
              <MacroTimeChart
                series={levels}
                height={160}
                format={pct2}
                ariaLabel={`Line chart of the 10-year and 3-month Treasury yields with the Fed target upper bound as a step line, three years. ${ratesText ?? ''}`}
              />
            </ChartBlock>
            <ChartBlock title="10Y–3M spread, % (below zero = inverted)">
              <MacroTimeChart
                series={spreadSeries}
                height={120}
                format={pct2}
                priceLines={[{ value: 0 }]}
                ariaLabel="Area chart of the 10-year minus 3-month spread around zero, three years."
              />
            </ChartBlock>
            {ratesText && <p className="chart-summary">{ratesText}</p>}
            <DataTable
              caption="Rates, latest 10 trading days"
              columns={['Date', '10Y', '3M', 'Spread', 'Fed target (upper)']}
              rows={joinTable(
                [
                  { label: '10Y', rows: c.rates.y10, format: pct2 },
                  { label: '3M', rows: c.rates.m3, format: pct2 },
                  { label: 'Spread', rows: c.rates.spread10y3m, format: bpFmt },
                  { label: 'Fed', rows: c.rates.fedTargetUpper, format: pct2, asOf: true },
                ],
                dayName,
                10,
              )}
            />
          </>
        ) : (
          <p className="panel-note">Rates unavailable.</p>
        )}
      </Panel>

      <Panel title="Growth & risk" meta="GDP & volatility" actions={familyBadge(data, ['bea', 'vix'])} className="mpanel">
        {c.growthRisk.gdpQoQ.length || c.growthRisk.vix.length ? (
          <>
            <ChartBlock title="Real GDP growth, % annualized (quarterly)">
              <MacroTimeChart
                series={gdp}
                height={130}
                dateStyle="quarter"
                format={pct1}
                ariaLabel={`Bar chart of quarterly real GDP growth over five years. ${growthText ?? ''}`}
              />
            </ChartBlock>
            <ChartBlock title="VIX, index points">
              <MacroTimeChart
                series={vix}
                height={100}
                format={(v) => v.toFixed(1)}
                ariaLabel="Line chart of the VIX volatility index over two years."
              />
            </ChartBlock>
            {growthText && <p className="chart-summary">{growthText}</p>}
            <DataTable
              caption="Real GDP growth, latest 8 quarters"
              columns={['Quarter', 'GDP, % SAAR']}
              rows={joinTable([{ label: 'GDP', rows: c.growthRisk.gdpQoQ, format: pct1 }], quarterName, 8)}
            />
          </>
        ) : (
          <p className="panel-note">Growth and risk series unavailable.</p>
        )}
      </Panel>
    </div>
  )
}

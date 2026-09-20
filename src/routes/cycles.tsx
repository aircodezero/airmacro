import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Panel } from '../components/Panel'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { ErrorState, LoadingState } from '../components/ErrorState'
import { Gauge } from '../components/Gauge'
import { LineChart } from '../components/charts/LineChart'
import { XYChart, type XYLine } from '../components/charts/XYChart'
import { qCycles } from '../lib/queries'
import { fmtNum, fmtPct, fmtUsd, fmtCompact, formatDate } from '../lib/format'
import { CHART, SERIES } from '../lib/colors'
import type { GaugeComponent } from '../lib/types'

export const Route = createFileRoute('/cycles')({ component: CyclesPage })

const toT = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HALVING_COLORS: Record<string, string> = {
  '2012-11-28': SERIES.blue,
  '2016-07-09': SERIES.aqua,
  '2020-05-11': SERIES.magenta,
  '2024-04-20': SERIES.gold,
}

function cycleColor(score: number) {
  if (score < 40) return CHART.up
  if (score <= 70) return CHART.text
  return CHART.down
}

function GaugeComponents({ components }: { components: GaugeComponent[] }) {
  return (
    <ul className="weight-bars">
      {components.map((c) => (
        <li key={c.key}>
          <div className="wb-head">
            <span>
              {c.label} <span className="muted">({Math.round(c.weight * 100)}%)</span>
            </span>
            <span className="mono">{c.value}</span>
          </div>
          <div className="fam-bar" role="img" aria-label={`${c.label}: ${c.value} out of 100`}>
            <div className="fam-bar-fill" style={{ width: `${c.value}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function SeasonalityTable({
  matrix,
  monthlyMeans,
}: {
  matrix: Record<string, Array<number | null>>
  monthlyMeans: Array<number | null>
}) {
  const years = Object.keys(matrix).sort((a, b) => Number(b) - Number(a))
  const cellStyle = (v: number | null) => {
    if (v == null) return undefined
    const alpha = Math.min(Math.abs(v) / 25, 1) * 0.5
    return {
      background: v >= 0 ? `rgba(62, 207, 163, ${alpha})` : `rgba(255, 126, 147, ${alpha})`,
    }
  }
  return (
    <div className="table-scroll" role="region" aria-label="Bitcoin monthly returns by year" tabIndex={0}>
      <table className="data heatmap">
        <thead>
          <tr>
            <th scope="col">Year</th>
            {MONTHS.map((m) => (
              <th key={m} scope="col">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year}>
              <td className="hm-year">{year}</td>
              {matrix[year].map((v, i) => (
                <td key={i} style={cellStyle(v)}>
                  {v == null ? '' : fmtNum(v, 0)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="hm-mean">
            <td className="hm-year">Avg</td>
            {monthlyMeans.map((v, i) => (
              <td key={i} style={cellStyle(v)}>
                {v == null ? '' : fmtNum(v, 0)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function CyclesPage() {
  const cycles = useQuery(qCycles())
  const d = cycles.data?.data

  const overlayLines = useMemo<XYLine[]>(() => {
    if (!d) return []
    return d.overlay.map((o) => ({
      key: o.halving,
      label: `${o.halving.slice(0, 4)} halving`,
      color: HALVING_COLORS[o.halving] ?? SERIES.violet,
      points: o.points,
      emphasis: o.current,
      width: o.current ? 2.6 : 1.5,
    }))
  }, [d])

  const piSeries = useMemo(() => {
    if (!d?.piCycle) return []
    const s = d.piCycle.series
    return [
      { key: 'price', label: 'BTC', color: SERIES.gold, width: 1 as const, data: s.map((p) => ({ t: toT(p.d), v: p.price })) },
      { key: 'sma111', label: 'SMA111', color: SERIES.blue, data: s.map((p) => ({ t: toT(p.d), v: p.sma111 })) },
      { key: 'sma350x2', label: '2×SMA350', color: SERIES.magenta, dashed: true, data: s.map((p) => ({ t: toT(p.d), v: p.sma350x2 })) },
    ]
  }, [d])

  const mayerSeries = useMemo(
    () =>
      d?.mayer
        ? [{ key: 'mayer', label: 'Mayer Multiple', color: SERIES.blue, data: d.mayer.series.map((p) => ({ t: toT(p.d), v: p.m })) }]
        : [],
    [d],
  )

  const wmaSeries = useMemo(
    () =>
      d?.wma200
        ? [
            { key: 'price', label: 'BTC', color: SERIES.gold, width: 1 as const, data: d.wma200.series.map((p) => ({ t: toT(p.d), v: p.price })) },
            { key: 'wma', label: '200WMA (1400d SMA)', color: SERIES.aqua, data: d.wma200.series.map((p) => ({ t: toT(p.d), v: p.wma })) },
          ]
        : [],
    [d],
  )

  const mvrvSeries = useMemo(
    () =>
      d?.mvrv
        ? [{ key: 'mvrv', label: 'MVRV', color: SERIES.violet, data: d.mvrv.series.map((p) => ({ t: toT(p.d), v: p.v })) }]
        : [],
    [d],
  )

  const powerSeries = useMemo(() => {
    if (!d?.powerLaw) return []
    const s = d.powerLaw.series
    return [
      { key: 'price', label: 'BTC', color: SERIES.gold, width: 1 as const, data: s.map((p) => ({ t: toT(p.d), v: p.price })) },
      { key: 'fit', label: 'Power-law fit', color: SERIES.blue, data: s.map((p) => ({ t: toT(p.d), v: p.fit })) },
      { key: 'lower', label: 'Lower band (q05)', color: '#5b6a80', dashed: true, width: 1 as const, data: s.map((p) => ({ t: toT(p.d), v: p.lower })) },
      { key: 'upper', label: 'Upper band (q95)', color: '#5b6a80', dashed: true, width: 1 as const, data: s.map((p) => ({ t: toT(p.d), v: p.upper })) },
    ]
  }, [d])

  if (cycles.isPending) {
    return (
      <div className="page-stack">
        <h1 className="page-title">Cycles</h1>
        <LoadingState label="Loading cycle indicators…" />
      </div>
    )
  }
  if (cycles.isError || !d) {
    return (
      <div className="page-stack">
        <h1 className="page-title">Cycles</h1>
        <ErrorState message="Cycle indicators unavailable." onRetry={() => cycles.refetch()} />
      </div>
    )
  }

  const badge = cycles.data && (
    <FreshnessBadge source={cycles.data.source} asOf={cycles.data.asOf} provider={cycles.data.provider} />
  )

  return (
    <div className="page-stack">
      <h1 className="page-title">Cycles</h1>

      <Panel title="Cycle position" meta="auto-generated summary" actions={badge}>
        <div className="cycle-synth">
          {d.gauge && (
            <Gauge
              value={d.gauge.score}
              label={d.gauge.label}
              detail="0 = floor · 100 = top zone"
              color={cycleColor(d.gauge.score)}
            />
          )}
          <div className="cycle-clock">
            <dl className="clock-grid">
              <div>
                <dt>Last halving</dt>
                <dd className="mono">{formatDate(d.phase.halving)}</dd>
              </div>
              <div>
                <dt>Days elapsed</dt>
                <dd className="mono">{d.phase.daysSince}</dd>
              </div>
              <div>
                <dt>Typical cycle (~4y)</dt>
                <dd className="mono">{fmtNum(d.phase.pctOfTypicalCycle, 0)}%</dd>
              </div>
              <div>
                <dt>Next halving</dt>
                <dd className="mono">
                  {d.phase.nextEstimate} <span className="muted text-xs">(estimate)</span>
                </dd>
              </div>
            </dl>
            <div className="fam-bar" role="img" aria-label={`Cycle progress: ${fmtNum(d.phase.pctOfTypicalCycle, 0)}%`}>
              <div className="fam-bar-fill" style={{ width: `${Math.min(100, d.phase.pctOfTypicalCycle)}%` }} />
            </div>
            <p className="panel-note">{d.summary}</p>
          </div>
          {d.gauge && <GaugeComponents components={d.gauge.components} />}
        </div>
      </Panel>

      <Panel
        title="Cycle overlay"
        meta="BTC indexed to 100 at each halving · log scale"
        actions={badge}
      >
        <XYChart
          lines={overlayLines}
          height={320}
          logY
          ariaLabel="Bitcoin performance indexed to 100 after each halving, in days"
          xFormat={(x) => `${Math.round(x)}d`}
          yFormat={(y) => fmtCompact(y, 0)}
        />
        <p className="chart-summary">
          BTC trajectories indexed to 100 on each halving day (x-axis: days elapsed, log scale).
          The current cycle ({d.phase.halving.slice(0, 4)}) is drawn thicker.
        </p>
      </Panel>

      <div className="cycles-grid">
        {d.piCycle && (
          <Panel title="Pi Cycle Top" meta="SMA111 vs 2×SMA350" actions={badge}>
            <LineChart
              series={piSeries}
              height={260}
              logScale
              ariaLabel="Pi Cycle Top: price, 111-day SMA and doubled 350-day SMA"
              valueFormat={(v) => fmtUsd(v)}
            />
            <p className="chart-summary">
              {d.piCycle.triggered
                ? 'Triggered: SMA111 is above 2×SMA350 — a configuration historically close to tops.'
                : `Not triggered: SMA111 is ${fmtPct(d.piCycle.gapPct)} from the 2×SMA350 threshold.`}{' '}
              Past crossings: {d.piCycle.crossings.length ? d.piCycle.crossings.map(formatDate).join(', ') : 'none in the period'}.
            </p>
          </Panel>
        )}

        {d.mayer && (
          <Panel title="Mayer Multiple" meta="price / SMA200" actions={badge}>
            <LineChart
              series={mayerSeries}
              height={260}
              ariaLabel="Mayer Multiple: price divided by the 200-day moving average"
              valueFormat={(v) => fmtNum(v, 2)}
              priceLines={[
                { value: d.mayer.bands.high, label: 'overheated', color: '#514049' },
                { value: 1, label: '1.0', color: CHART.border },
                { value: d.mayer.bands.low, label: 'accumulation', color: '#3e4d41' },
              ]}
            />
            <p className="chart-summary">
              Current: {fmtNum(d.mayer.current, 2)} — historical percentile {fmtNum(d.mayer.percentile, 0)}%.
              Above {d.mayer.bands.high}: historically overheated; below {d.mayer.bands.low}: accumulation
              zone.
            </p>
          </Panel>
        )}

        {d.wma200 && (
          <Panel title="Price vs 200WMA" meta="historical cycle floor" actions={badge}>
            <LineChart
              series={wmaSeries}
              height={260}
              logScale
              ariaLabel="Bitcoin price and 200-week moving average"
              valueFormat={(v) => fmtUsd(v)}
            />
            <p className="chart-summary">
              Price is {fmtPct(d.wma200.distancePct)} from the 200WMA ({fmtUsd(d.wma200.current)}) — this
              level has historically acted as the cycle floor.
            </p>
          </Panel>
        )}

        {d.mvrv ? (
          <Panel title="MVRV" meta="market cap / realized cap · Coin Metrics" actions={badge}>
            <LineChart
              series={mvrvSeries}
              height={260}
              ariaLabel="Bitcoin MVRV ratio"
              valueFormat={(v) => fmtNum(v, 2)}
              priceLines={[
                { value: d.mvrv.zones.high, label: 'tops', color: '#514049' },
                { value: d.mvrv.zones.low, label: 'capitulation', color: '#3e4d41' },
              ]}
            />
            <p className="chart-summary">
              Current MVRV: {fmtNum(d.mvrv.current, 2)}. Above {d.mvrv.zones.high}: historical top zones;
              below {d.mvrv.zones.low}: capitulations.
            </p>
          </Panel>
        ) : (
          <Panel title="MVRV" meta="Coin Metrics community">
            <ErrorState message="MVRV series unavailable (on-chain source offline) — labeled fallback." />
          </Panel>
        )}
      </div>

      {d.powerLaw && (
        <Panel
          title="Power-law bands"
          meta={`log(price) ~ log(days since genesis) · slope ${fmtNum(d.powerLaw.slope, 2)} · R² ${fmtNum(d.powerLaw.r2, 3)}`}
          actions={badge}
        >
          <LineChart
            series={powerSeries}
            height={300}
            logScale
            ariaLabel="Bitcoin price with power-law regression bands"
            valueFormat={(v) => fmtUsd(v)}
          />
          <p className="chart-summary">
            Regression over the full history since {formatDate('2009-01-03')} (genesis). Price sits at the
            {fmtNum(d.powerLaw.positionPercentile, 0)}th percentile of historical residuals — q05/q95 bands.
          </p>
        </Panel>
      )}

      <Panel title="Monthly seasonality" meta="BTC monthly returns (%) since 2013" actions={badge}>
        <SeasonalityTable matrix={d.seasonality.matrix} monthlyMeans={d.seasonality.monthlyMeans} />
        <p className="panel-note">
          Monthly returns in % (teal = positive, rose = negative, intensity proportional). The “Avg”
          row aggregates each month across history — seasonality is indicative, not predictive.
        </p>
      </Panel>

      <p className="panel-note">
        Indicators generated automatically from public data (historical heuristics with no guaranteed
        predictive value) — not investment advice.
      </p>
    </div>
  )
}

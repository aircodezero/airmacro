import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Panel } from '../components/Panel'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { ErrorState, LoadingState } from '../components/ErrorState'
import { LineChart, type LineSeriesDef } from '../components/charts/LineChart'
import { XYChart, type XYLine } from '../components/charts/XYChart'
import { qEquities, qSignals, qCycles, qSentiment, qBasis } from '../lib/queries'
import { fmtNum, fmtPct, fmtPctPlain } from '../lib/format'
import { entityColor, CHART } from '../lib/colors'
import {
  alignByDate,
  rollingCorrelation,
  olsRegression,
  toBase100,
} from '../../shared/analytics/series.mjs'

export const Route = createFileRoute('/classe-actifs')({ component: CrossAssetPage })

type DailyRow = { d: string; c: number }
type SeriesMap = Record<string, DailyRow[]>

const CRYPTO_BASKET = ['COIN', 'MSTR', 'HOOD', 'MARA', 'RIOT', 'CLSK']
const AI_BASKET = ['NVDA', 'AMD', 'AVGO', 'MSFT', 'GOOGL', 'PLTR', 'TSM']
const RANGES = ['3M', '6M', '1Y', 'YTD'] as const
type RangeKey = (typeof RANGES)[number]
const toT = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000

function lastDate(series: SeriesMap): string | null {
  let out: string | null = null
  for (const rows of Object.values(series)) {
    const d = rows.at(-1)?.d
    if (d && (!out || d > out)) out = d
  }
  return out
}

function windowStart(range: RangeKey, end: string): string {
  if (range === 'YTD') return `${end.slice(0, 4)}-01-01`
  const days = range === '3M' ? 90 : range === '6M' ? 180 : 365
  return new Date(Date.parse(`${end}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
}

function windowed(rows: DailyRow[] | undefined, start: string): DailyRow[] {
  return (rows ?? []).filter((r) => r.d >= start)
}

/** Panier équipondéré : moyenne des base 100 des membres (dates communes). */
function basketSeries(series: SeriesMap, members: string[], start: string): DailyRow[] {
  const present: SeriesMap = {}
  for (const m of members) {
    const rows = windowed(series[m], start)
    if (rows.length >= 10) present[m] = rows
  }
  const keys = Object.keys(present)
  if (keys.length < Math.max(2, Math.ceil(members.length / 2))) return []
  const { dates, values } = alignByDate(present)
  if (dates.length < 10) return []
  const bases = keys.map((k) => toBase100(values[k]))
  return dates.map((d, i) => ({
    d,
    c: bases.reduce((acc, b) => acc + (b[i] ?? 0), 0) / keys.length,
  }))
}

/** Rendements simples (%) sur dates alignées. */
function alignedReturns(a: DailyRow[], b: DailyRow[]): { dates: string[]; ra: number[]; rb: number[] } {
  const { dates, values } = alignByDate({ a, b })
  const ra: number[] = []
  const rb: number[] = []
  const outDates: string[] = []
  for (let i = 1; i < dates.length; i++) {
    ra.push((values.a[i] / values.a[i - 1] - 1) * 100)
    rb.push((values.b[i] / values.b[i - 1] - 1) * 100)
    outDates.push(dates[i])
  }
  return { dates: outDates, ra, rb }
}

function corrLabel(c: number) {
  const abs = Math.abs(c)
  if (abs < 0.25) return 'low'
  if (abs < 0.55) return 'moderate'
  return 'high'
}

function CrossAssetPage() {
  const equities = useQuery(qEquities())
  const signals = useQuery(qSignals())
  const cycles = useQuery(qCycles())
  const sentiment = useQuery(qSentiment())
  const basis = useQuery(qBasis())

  const [range, setRange] = useState<RangeKey>('6M')
  const [yVar, setYVar] = useState<'BTC' | 'CCI30'>('BTC')
  const [xVar, setXVar] = useState<'QQQ' | 'NVDA'>('QQQ')

  const series = equities.data?.data.series
  const end = useMemo(() => (series ? lastDate(series) : null), [series])
  const start = end ? windowStart(range, end) : null

  /* ---------- Base 100 ---------- */
  const base100Series = useMemo<LineSeriesDef[]>(() => {
    if (!series || !start) return []
    const out: LineSeriesDef[] = []
    const push = (key: string, label: string, rows: DailyRow[]) => {
      if (rows.length < 10) return
      const b = toBase100(rows.map((r) => r.c))
      out.push({
        key,
        label,
        color: entityColor(key === 'CRYPTO_EQ' ? 'Crypto-equities basket' : key === 'AI_EQ' ? 'AI basket' : key),
        data: rows.map((r, i) => ({ t: toT(r.d), v: b[i] as number })).filter((p) => p.v != null),
      })
    }
    push('BTC', 'BTC', windowed(series.BTC, start))
    push('ETH', 'ETH', windowed(series.ETH, start))
    push('CCI30', 'CCi30', windowed(series.CCI30, start))
    push('QQQ', 'QQQ (NASDAQ-100)', windowed(series.QQQ, start))
    push('NVDA', 'NVDA', windowed(series.NVDA, start))
    push('CRYPTO_EQ', 'Crypto-equities basket', basketSeries(series, CRYPTO_BASKET, start))
    push('AI_EQ', 'AI basket', basketSeries(series, AI_BASKET, start))
    return out
  }, [series, start])

  /* ---------- Corrélations glissantes 90 j ---------- */
  const corrSeries = useMemo<LineSeriesDef[]>(() => {
    if (!series) return []
    const pairs: Array<{ key: string; label: string; a: string; b: string }> = [
      { key: 'btc-qqq', label: 'BTC–QQQ', a: 'BTC', b: 'QQQ' },
      { key: 'btc-nvda', label: 'BTC–NVDA', a: 'BTC', b: 'NVDA' },
      { key: 'cci-qqq', label: 'CCi30–QQQ', a: 'CCI30', b: 'QQQ' },
    ]
    const out: LineSeriesDef[] = []
    for (const pair of pairs) {
      const a = series[pair.a]
      const b = series[pair.b]
      if (!a?.length || !b?.length) continue
      const { dates, ra, rb } = alignedReturns(a, b)
      if (ra.length < 100) continue
      const roll = rollingCorrelation(ra, rb, 90)
      const points = dates
        .map((d, i) => ({ t: toT(d), v: roll[i] as number }))
        .filter((p) => p.v != null)
        .slice(-260)
      out.push({
        key: pair.key,
        label: pair.label,
        color: entityColor(pair.a === 'CCI30' ? 'CCI30' : pair.b === 'NVDA' ? 'NVDA' : 'BTC'),
        data: points,
      })
    }
    return out
  }, [series])

  /* ---------- Régression ---------- */
  const regression = useMemo(() => {
    if (!series || !start) return null
    const yRows = windowed(series[yVar], start)
    const xRows = windowed(series[xVar], start)
    if (yRows.length < 20 || xRows.length < 20) return null
    const { ra: ys, rb: xs } = (() => {
      const r = alignedReturns(yRows, xRows)
      return { ra: r.ra, rb: r.rb }
    })()
    if (xs.length < 20) return null
    const fit = olsRegression(xs, ys)
    if (!fit) return null
    const xMin = Math.min(...xs)
    const xMax = Math.max(...xs)
    return {
      points: xs.map((x, i) => ({ x, y: ys[i] })),
      line: [
        { x: xMin, y: fit.alpha + fit.beta * xMin },
        { x: xMax, y: fit.alpha + fit.beta * xMax },
      ],
      beta: fit.beta,
      alphaAnnualizedPct: fit.alpha * 252,
      r2: fit.r2,
      n: fit.n,
    }
  }, [series, start, yVar, xVar])

  const scatterLines = useMemo<XYLine[]>(() => {
    if (!regression) return []
    return [
      {
        key: 'points',
        label: `${yVar === 'CCI30' ? 'CCi30' : yVar} (daily returns)`,
        color: entityColor(yVar),
        points: regression.points,
        scatter: true,
      },
      {
        key: 'ols',
        label: 'OLS fit',
        color: CHART.ink,
        points: regression.line,
        width: 2,
      },
    ]
  }, [regression, yVar])

  /* ---------- Ratio BTC/QQQ ---------- */
  const ratioSeries = useMemo<LineSeriesDef[]>(() => {
    if (!series || !start) return []
    const a = windowed(series.BTC, start)
    const b = windowed(series.QQQ, start)
    if (!a.length || !b.length) return []
    const { dates, values } = alignByDate({ a, b })
    if (dates.length < 10) return []
    return [
      {
        key: 'ratio',
        label: 'BTC / QQQ',
        color: entityColor('BTC'),
        data: dates.map((d, i) => ({ t: toT(d), v: values.a[i] / values.b[i] })),
      },
    ]
  }, [series, start])

  /* ---------- Avis maison ---------- */
  const houseView = useMemo(() => {
    const parts: string[] = []
    const btcItem = signals.data?.data.items.find((i) => i.symbol === 'BTC')
    const breadth = signals.data?.data.breadth.aboveSma50Pct
    if (btcItem?.metrics?.aboveSma200 != null) {
      parts.push(
        `Trend: BTC is ${btcItem.metrics.aboveSma200 ? 'above' : 'below'} its SMA200` +
          (btcItem.metrics.priceVsSma200Pct != null ? ` (${fmtPct(btcItem.metrics.priceVsSma200Pct)})` : '') +
          (breadth != null ? `; ${fmtPctPlain(breadth, 0)} of the universe above SMA50.` : '.'),
      )
    }
    const gauge = cycles.data?.data.gauge
    const phase = cycles.data?.data.phase
    if (gauge && phase) {
      parts.push(`Cycle: ${gauge.label.toLowerCase()} (${gauge.score}/100), ${phase.daysSince}d after the halving.`)
    }
    const corrBtcQqq = corrSeries.find((s) => s.key === 'btc-qqq')?.data.at(-1)?.v ?? null
    if (corrBtcQqq != null && regression) {
      parts.push(
        `Equity link: 90d BTC–QQQ correlation at ${fmtNum(corrBtcQqq, 2)} (${corrLabel(corrBtcQqq)}); over ${range}, beta ${fmtNum(regression.beta, 2)} of ${yVar === 'CCI30' ? 'CCi30' : yVar} vs ${xVar} (R² ${fmtNum(regression.r2, 2)}).`,
      )
    }
    const funding = sentiment.data?.data.funding
    const cme = basis.data?.data.cme.BTC?.current
    const derivBits: string[] = []
    if (funding?.annualizedPct != null) {
      derivBits.push(
        `aggregate funding ${fmtPct(funding.annualizedPct, 1)} ann. (${funding.annualizedPct > 2 ? 'crowded longs' : funding.annualizedPct < -2 ? 'shorts paying' : 'neutral'})`,
      )
    }
    if (cme?.basisAnnualizedPct != null) {
      derivBits.push(`CME basis ${fmtPct(cme.basisAnnualizedPct, 1)} ann. (${cme.regime})`)
    } else {
      derivBits.push('CME basis unavailable (source offline)')
    }
    if (derivBits.length) parts.push(`Derivatives: ${derivBits.join('; ')}.`)

    const fng = sentiment.data?.data.fng?.value
    if (fng != null) parts.push(`Sentiment: Fear & Greed at ${fng}.`)

    let verdict = 'Transition regime — mixed signals.'
    if (btcItem?.metrics?.aboveSma200 != null && gauge) {
      if (gauge.score >= 80) verdict = 'Late-cycle risk zone: cycle indicators are stretched.'
      else if (btcItem.metrics.aboveSma200 && gauge.score < 65)
        verdict = 'Constructive profile: positive trend without cycle excess.'
      else if (!btcItem.metrics.aboveSma200 && gauge.score < 45)
        verdict = 'Corrective phase in an intermediate cycle zone — market rebuilding.'
      else if (!btcItem.metrics.aboveSma200) verdict = 'Deteriorated trend: caution while the SMA200 acts as a ceiling.'
    }
    return { parts, verdict }
  }, [signals.data, cycles.data, sentiment.data, basis.data, corrSeries, regression, range, yVar, xVar])

  const badge = equities.data && (
    <FreshnessBadge source={equities.data.source} asOf={equities.data.asOf} provider={equities.data.provider} />
  )
  const failed = equities.data?.data.failed ?? []
  const simulated = equities.data?.data.simulated ?? false

  return (
    <div className="page-stack">
      <h1 className="page-title">Cross-Asset — crypto vs equities</h1>

      {simulated && (
        <div className="state-warn" role="status">
          Equity series shown here are currently <b>simulated</b> (Stooq/Yahoo sources unavailable at
          capture time) and serve as an illustration — they will be replaced with real data as soon as
          the sources return. Crypto series (BTC, ETH, CCi30) are real.
        </div>
      )}
      {!simulated && failed.length > 0 && (
        <div className="state-warn" role="status">
          Series unavailable for: {failed.join(', ')} (equity source offline) — labeled fallback.
        </div>
      )}

      <Panel title="Asset-class view" meta="auto-generated summary" actions={badge}>
        {houseView.parts.length ? (
          <>
            <p className="house-verdict">{houseView.verdict}</p>
            <ul className="house-list">
              {houseView.parts.map((p) => (
                <li key={p.slice(0, 24)}>{p}</li>
              ))}
            </ul>
            <p className="panel-note">
              Text assembled by rules from the indicators shown on this site — generated
              automatically, <b>not investment advice</b>.
            </p>
          </>
        ) : (
          <LoadingState label="Assembling the summary…" />
        )}
      </Panel>

      <Panel
        title="Relative performance"
        meta="indexed to 100 at window start"
        actions={
          <>
            <div className="seg" role="group" aria-label="Window">
              {RANGES.map((r) => (
                <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
                  {r}
                </button>
              ))}
            </div>
            {badge}
          </>
        }
      >
        {equities.isPending ? (
          <LoadingState label="Loading series…" />
        ) : equities.isError ? (
          <ErrorState message="Series unavailable." onRetry={() => equities.refetch()} />
        ) : base100Series.length >= 2 ? (
          <>
            <LineChart
              series={base100Series}
              height={330}
              ariaLabel={`Relative performance indexed to 100 over ${range}`}
              valueFormat={(v) => fmtNum(v, 1)}
              priceLines={[{ value: 100, label: '100', dashed: false }]}
            />
            <p className="chart-summary">
              Each series is indexed to 100 at the start of the window ({range}). Click the legend to
              hide/show a series. Equal-weight baskets: crypto-equities ({CRYPTO_BASKET.join(', ')}) and
              AI ({AI_BASKET.join(', ')}).
            </p>
          </>
        ) : (
          <ErrorState message="Not enough series available for the comparison." />
        )}
      </Panel>

      <div className="ca-grid">
        <Panel title="Rolling correlations" meta="90-day window · aligned daily returns">
          {corrSeries.length ? (
            <>
              <LineChart
                series={corrSeries}
                height={240}
                ariaLabel="90-day rolling correlations between crypto and equities"
                valueFormat={(v) => fmtNum(v, 2)}
                priceLines={[{ value: 0, label: '0', dashed: false }]}
              />
              <p className="chart-summary">
                Pearson correlation of daily returns (common trading days) over 90 sessions. Near 1:
                crypto behaves like the NASDAQ; near 0: a diversifier.
              </p>
            </>
          ) : (
            <ErrorState message="Correlations unavailable (equity series missing)." />
          )}
        </Panel>

        <Panel
          title="Return regression"
          meta="daily OLS over the window"
          actions={
            <>
              <div className="seg" role="group" aria-label="Dependent variable (Y)">
                {(['BTC', 'CCI30'] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={yVar === v} onClick={() => setYVar(v)}>
                    {v === 'CCI30' ? 'CCi30' : v}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label="Explanatory variable (X)">
                {(['QQQ', 'NVDA'] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={xVar === v} onClick={() => setXVar(v)}>
                    {v}
                  </button>
                ))}
              </div>
            </>
          }
        >
          {regression ? (
            <>
              <XYChart
                lines={scatterLines}
                height={260}
                ariaLabel={`Scatter of ${yVar} daily returns against ${xVar} with regression line`}
                xFormat={(x) => fmtPct(x, 1)}
                yFormat={(y) => fmtPct(y, 1)}
                legend={false}
              />
              <p className="chart-summary mono">
                β = {fmtNum(regression.beta, 2)} · α ≈ {fmtPct(regression.alphaAnnualizedPct, 1)} ann. · R² ={' '}
                {fmtNum(regression.r2, 2)} · n = {regression.n} sessions ({range})
              </p>
              <p className="panel-note">
                Each point is one session: {yVar === 'CCI30' ? 'CCi30' : yVar} return (vertical) against
                {' '}{xVar} (horizontal). β measures the amplification of {xVar} moves.
              </p>
            </>
          ) : (
            <ErrorState message="Regression unavailable (series missing over the window)." />
          )}
        </Panel>
      </div>

      <div className="ca-grid">
        <Panel title="BTC / QQQ ratio" meta="crypto vs NASDAQ relative strength">
          {ratioSeries.length ? (
            <>
              <LineChart
                series={ratioSeries}
                height={220}
                ariaLabel="Ratio of Bitcoin price to QQQ price"
                valueFormat={(v) => fmtNum(v, 1)}
                legend={false}
              />
              <p className="chart-summary">
                Rising ratio: BTC outperforms the NASDAQ-100; falling: it underperforms.
              </p>
            </>
          ) : (
            <ErrorState message="Ratio unavailable." />
          )}
        </Panel>

        <Panel title="How to read" meta="using this page">
          <ul className="house-list">
            <li>
              The <b>indexed chart</b> compares trajectories: crypto (BTC, ETH, CCi30) against the
              NASDAQ-100 (QQQ), NVIDIA and two baskets of related equities.
            </li>
            <li>
              The <b>90d correlation</b> tells whether crypto diversifies an equity portfolio or
              amplifies its moves.
            </li>
            <li>
              The <b>regression</b> quantifies that link: β &gt; 1 = amplification, low R² = unstable
              relationship.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}

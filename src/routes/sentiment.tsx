import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Panel } from '../components/Panel'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { ErrorState, LoadingState } from '../components/ErrorState'
import { Gauge } from '../components/Gauge'
import { LineChart } from '../components/charts/LineChart'
import { qSentiment } from '../lib/queries'
import { fmtNum, fmtPct, fmtPctPlain } from '../lib/format'
import { CHART, SERIES } from '../lib/colors'
import type { GaugeComponent } from '../lib/types'

export const Route = createFileRoute('/sentiment')({ component: SentimentPage })

function sentimentColor(score: number) {
  if (score < 40) return CHART.down
  if (score <= 60) return CHART.text
  return CHART.up
}

function WeightBars({ components }: { components: GaugeComponent[] }) {
  return (
    <ul className="weight-bars">
      {components.map((component) => (
        <li key={component.key}>
          <div className="wb-head">
            <span>
              {component.label} <span className="muted">({Math.round(component.weight * 100)}%)</span>
            </span>
            <span className="mono">{component.value}</span>
          </div>
          <div
            className="fam-bar"
            role="img"
            aria-label={`${component.label}: ${component.value} out of 100`}
          >
            <div className="fam-bar-fill" style={{ width: `${component.value}%` }} />
          </div>
          {component.detail && <span className="muted text-xs">{component.detail}</span>}
        </li>
      ))}
    </ul>
  )
}

function SentimentPage() {
  const sentiment = useQuery(qSentiment())
  const data = sentiment.data?.data

  const fngSeries = useMemo(() => {
    const history = data?.fng?.history ?? []
    return [
      {
        key: 'fng',
        label: 'Fear & Greed',
        color: SERIES.blue,
        area: true,
        data: history.map((p) => ({ t: p.t, v: p.value })),
      },
    ]
  }, [data])

  if (sentiment.isPending) {
    return (
      <div className="page-stack">
        <h1 className="page-title">Sentiment</h1>
        <LoadingState label="Loading market sentiment…" />
      </div>
    )
  }
  if (sentiment.isError || !data) {
    return (
      <div className="page-stack">
        <h1 className="page-title">Sentiment</h1>
        <ErrorState message="Sentiment data unavailable." onRetry={() => sentiment.refetch()} />
      </div>
    )
  }

  const badge = sentiment.data && (
    <FreshnessBadge source={sentiment.data.source} asOf={sentiment.data.asOf} provider={sentiment.data.provider} />
  )
  const fundingRead =
    data.funding?.annualizedPct == null
      ? null
      : data.funding.annualizedPct > 2
        ? 'Longs pay shorts — crowded long positioning.'
        : data.funding.annualizedPct < -2
          ? 'Shorts pay longs — dominant short positioning.'
          : 'Funding near zero — balanced positioning.'

  return (
    <div className="page-stack">
      <h1 className="page-title">Sentiment</h1>

      <div className="senti-grid">
        <Panel
          title="Fear & Greed"
          meta="alternative.me · last 140 days"
          actions={badge}
        >
          {data.fng ? (
            <>
              <div className="senti-fng">
                <Gauge
                  value={data.fng.value}
                  label={data.fng.classification ?? '—'}
                  detail="0 = extreme fear · 100 = extreme greed"
                  color={sentimentColor(data.fng.value)}
                />
                <div className="senti-fng-chart">
                  <LineChart
                    series={fngSeries}
                    height={200}
                    ariaLabel="Fear & Greed index history over 140 days"
                    valueFormat={(v) => fmtNum(v, 0)}
                    priceLines={[
                      { value: 25, label: 'fear', color: '#514049' },
                      { value: 75, label: 'greed', color: '#3e4d41' },
                    ]}
                    legend={false}
                  />
                </div>
              </div>
              <p className="panel-note">
                Current index: {data.fng.value} ({data.fng.classification}). Zones below 25 and above
                75 mark the historically contrarian extremes.
              </p>
            </>
          ) : (
            <ErrorState message="Fear & Greed index unavailable." />
          )}
        </Panel>

        <Panel title="AirCrypto composite gauge" meta="transparent weighting" actions={badge}>
          {data.composite ? (
            <div className="senti-composite">
              <Gauge
                value={data.composite.score}
                label={data.composite.label}
                detail="0 = extreme fear · 100 = euphoria"
                color={sentimentColor(data.composite.score)}
              />
              <WeightBars components={data.composite.components} />
              <p className="panel-note">
                Gauge generated automatically from the components above — not investment
                advice.
              </p>
            </div>
          ) : (
            <ErrorState message="Composite gauge unavailable." />
          )}
        </Panel>
      </div>

      <div className="senti-grid-3">
        <Panel title="Market breadth" meta="share of rising assets">
          <ul className="weight-bars">
            <li>
              <div className="wb-head">
                <span>Above SMA50 <span className="muted">(top-30 universe)</span></span>
                <span className="mono">
                  {data.breadth.aboveSma50Pct != null ? fmtPctPlain(data.breadth.aboveSma50Pct, 0) : '—'}
                </span>
              </div>
              <div className="fam-bar">
                <div className="fam-bar-fill" style={{ width: `${data.breadth.aboveSma50Pct ?? 0}%` }} />
              </div>
            </li>
            <li>
              <div className="wb-head">
                <span>Positive 7d return <span className="muted">(top 50 ex-stables)</span></span>
                <span className="mono">
                  {data.breadth.positive7dPct != null ? fmtPctPlain(data.breadth.positive7dPct, 0) : '—'}
                </span>
              </div>
              <div className="fam-bar">
                <div className="fam-bar-fill" style={{ width: `${data.breadth.positive7dPct ?? 0}%` }} />
              </div>
            </li>
          </ul>
          <p className="panel-note">
            The higher the breadth, the more broad-based the advance — a rally carried by a handful
            of assets is more fragile.
          </p>
        </Panel>

        <Panel title="Dominance" meta="share of total market cap">
          {data.dominance ? (
            <>
              <ul className="weight-bars">
                {[
                  { label: 'Bitcoin', value: data.dominance.btcPct },
                  { label: 'Ethereum', value: data.dominance.ethPct },
                  { label: 'Stablecoins (top 50)', value: data.dominance.stablecoinsPct },
                ].map((row) => (
                  <li key={row.label}>
                    <div className="wb-head">
                      <span>{row.label}</span>
                      <span className="mono">{row.value != null ? fmtPctPlain(row.value) : '—'}</span>
                    </div>
                    <div className="fam-bar">
                      <div className="fam-bar-fill" style={{ width: `${row.value ?? 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="panel-note">
                A growing stablecoin share means cash on the sidelines (risk-off); rising BTC
                dominance marks a retreat into the most liquid asset.
              </p>
            </>
          ) : (
            <ErrorState message="Dominance data unavailable." />
          )}
        </Panel>

        <Panel title="Funding positioning" meta="perps · top-10 average">
          {data.funding ? (
            <>
              <div className="funding-read">
                <span className="funding-big mono">
                  {data.funding.annualizedPct != null ? fmtPct(data.funding.annualizedPct) : '—'}
                </span>
                <span className="muted text-sm">annualized</span>
              </div>
              <p className="mono text-sm muted">
                {data.funding.avg8hPct != null ? `${fmtPct(data.funding.avg8hPct, 4)} / 8h` : ''} · average
                across {data.funding.sample} perps
              </p>
              {fundingRead && <p className="panel-note">{fundingRead}</p>}
            </>
          ) : (
            <ErrorState message="Aggregate funding unavailable." />
          )}
        </Panel>
      </div>
    </div>
  )
}

import { formatCountdown } from '../../shared/analytics/macrotime.mjs'
import { Panel } from '../components/Panel'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { decisionSentence, fmtDay, fmtIsoDate, fmtTime, localOffsetLabel } from './format'
import type { CalendarData, FamilyMeta, PolicyData, PolicyMeeting } from './types'

const FOMC_CALENDAR = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'

const meetingDays = (m: PolicyMeeting) => {
  const start = fmtIsoDate(m.start).replace(/, \d{4}$/, '')
  const endDay = m.end.slice(8, 10).replace(/^0/, '')
  return m.start.slice(0, 7) === m.end.slice(0, 7) ? `${start}–${endDay}` : `${start} – ${fmtIsoDate(m.end).replace(/, \d{4}$/, '')}`
}

interface Props {
  policy: PolicyData | null
  meetings: CalendarData['policy'] | null
  families: Array<FamilyMeta | null>
  now: number
}

export function PolicyCorner({ policy, meetings, families, now }: Props) {
  const next = meetings?.nextFomc ?? null
  const source = families.some((f) => f?.source === 'seed') ? 'seed' : families.some((f) => f?.source === 'cache') ? 'cache' : 'live'
  const fetchedAt = families.map((f) => f?.fetchedAt).filter((d): d is string => Boolean(d)).sort()[0]
  return (
    <Panel
      title="Fed policy"
      meta="target range, effective rate, meetings"
      className="policy"
      actions={<FreshnessBadge source={source} asOf={fetchedAt} provider="NY Fed · Federal Reserve" />}
    >
      <dl className="policy-grid">
        <div>
          <dt>Target range</dt>
          <dd className="mono policy-big">
            {policy?.target ? `${policy.target.lower.toFixed(2)}–${policy.target.upper.toFixed(2)}%` : '—'}
          </dd>
          {policy?.target && (
            <span className="policy-sub">
              {policy.target.source === 'Fed statement' ? 'per today’s statement' : `NY Fed, as of ${fmtIsoDate(policy.target.asOf)}`}
            </span>
          )}
        </div>
        <div>
          <dt>Effective fed funds</dt>
          <dd className="mono policy-big">{policy?.effr ? `${policy.effr.value.toFixed(2)}%` : '—'}</dd>
          {policy?.effr && <span className="policy-sub">{fmtIsoDate(policy.effr.date)}</span>}
        </div>
        <div>
          <dt>Last decision</dt>
          <dd>{policy?.lastDecision ? decisionSentence(policy.lastDecision) : '—'}</dd>
          {policy?.lastDecision && (
            <span className="policy-sub">
              {fmtIsoDate(policy.lastDecision.date)}
              {policy.lastDecision.vote ? ` · vote ${policy.lastDecision.vote.for}–${policy.lastDecision.vote.against}` : ''}
            </span>
          )}
        </div>
        <div>
          <dt>Next FOMC</dt>
          <dd>{next ? meetingDays(next) : '—'}</dd>
          {next && (
            <span className="policy-sub">
              {next.decisionTs > now
                ? `decision ${fmtDay(next.decisionTs)}, ${fmtTime(next.decisionTs)} (${localOffsetLabel(next.decisionTs)}) · in ${formatCountdown(next.decisionTs - now)}`
                : `decision released ${fmtTime(next.decisionTs)}`}
              {next.sep ? ' · with projections' : ''}
            </span>
          )}
        </div>
        {meetings?.followingFomc && (
          <div>
            <dt>Following FOMC</dt>
            <dd>{meetingDays(meetings.followingFomc)}</dd>
            <span className="policy-sub">{meetings.followingFomc.sep ? 'with projections' : 'no projections'}</span>
          </div>
        )}
        {meetings?.nextEcb && (
          <div>
            <dt>Next ECB</dt>
            <dd>{meetingDays(meetings.nextEcb)}</dd>
            <span className="policy-sub">
              decision {fmtDay(meetings.nextEcb.decisionTs)}, {fmtTime(meetings.nextEcb.decisionTs)}
            </span>
          </div>
        )}
      </dl>
      <p className="policy-links">
        {policy?.links.statement && (
          <a className="panel-link" href={policy.links.statement} target="_blank" rel="noopener noreferrer">
            Latest statement{policy.links.statementDate ? ` (${fmtIsoDate(policy.links.statementDate)})` : ''} ↗
          </a>
        )}
        {policy?.links.minutes && (
          <a className="panel-link" href={policy.links.minutes} target="_blank" rel="noopener noreferrer">
            {policy.links.minutesTitle?.replace('Minutes of the Federal Open Market Committee, ', 'Minutes, ') ?? 'Latest minutes'} ↗
          </a>
        )}
        <a className="panel-link" href={FOMC_CALENDAR} target="_blank" rel="noopener noreferrer">
          FOMC calendar ↗
        </a>
      </p>
    </Panel>
  )
}

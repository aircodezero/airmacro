/*
 * Notifications AirMacro — logique pure (testée) :
 *   - rappel 15 min avant chaque événement High (décisions, publications, discours) ;
 *   - à la publication : le chiffre officiel quand AirMacro en a une source
 *     (règles d'« actual » : Fed, BLS, BEA, DOL, ONS, BoE, BCE, BoJ, Eurostat…),
 *     sinon « publié » avec consensus et précédent ;
 *   - chiffre encore absent après 20 min d'attente : avis « publié, chiffres en
 *     attente », puis le chiffre dès qu'il arrive.
 * Messages en anglais (langue de l'interface), heure dans le fuseau du destinataire.
 */
import { formatUtcOffset, tzOffsetMinutes } from '../../../shared/analytics/macrotime.mjs'
import { actualSupport } from '../macro/actuals.mjs'

const MIN = 60_000
const HOUR = 60 * MIN

export const REMINDER_LEAD_MS = 15 * MIN
export const ACTUAL_GRACE_MS = 20 * MIN
export const RELEASE_WINDOW_MS = 3 * HOUR

const RELEASE_CATEGORIES = new Set(['decision', 'data'])

const COUNTRY = { USD: 'US', EUR: 'Euro area', GBP: 'UK', JPY: 'Japan' }

export const notifiable = (e) => e?.impact === 'High' && !e.allDay

/** AirMacro sait-il publier le chiffre officiel de cet événement ? */
export const hasOfficialActual = (e) => RELEASE_CATEGORIES.has(e?.category) && actualSupport(e) != null

/**
 * @param {any[]} events événements du calendrier (avec `actual`/`decision` déjà attachés)
 * @param {number} now
 * @param {Record<string, number>} sent clés déjà envoyées → horodatage
 * @param {number} since n'annonce pas les publications antérieures (pas de rattrapage à l'activation)
 * @returns {Array<{ key: string, type: 'reminder'|'actual'|'pending'|'released', event: any }>}
 */
export function planNotifications(events, now, sent = {}, since = 0) {
  const out = []
  const has = (key) => Object.hasOwn(sent, key)
  for (const e of events ?? []) {
    if (!notifiable(e)) continue
    const lead = e.ts - now
    if (lead > MIN && lead <= REMINDER_LEAD_MS && !has(`reminder:${e.id}`)) {
      out.push({ key: `reminder:${e.id}`, type: 'reminder', event: e })
    }
    if (!RELEASE_CATEGORIES.has(e.category)) continue
    const age = now - e.ts
    if (age < 0 || age > RELEASE_WINDOW_MS || e.ts < since) continue
    if (hasOfficialActual(e)) {
      const known = e.actual != null || e.decision != null
      if (known) {
        if (!has(`actual:${e.id}`)) out.push({ key: `actual:${e.id}`, type: 'actual', event: e })
      } else if (age >= ACTUAL_GRACE_MS && !has(`pending:${e.id}`)) {
        out.push({ key: `pending:${e.id}`, type: 'pending', event: e })
      }
    } else if (!has(`released:${e.id}`)) {
      out.push({ key: `released:${e.id}`, type: 'released', event: e })
    }
  }
  return out.sort((a, b) => a.event.ts - b.event.ts)
}

/* ---------- Rédaction ---------- */

/** Fuseau IANA valide, sinon UTC. */
export function validTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return 'UTC'
  }
}

export function localTime(ts, timeZone) {
  const zone = validTimeZone(timeZone)
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone })
    .format(ts)
    .replace(/\u202f/g, ' ')
  return `${time} (${formatUtcOffset(tzOffsetMinutes(ts, zone))})`
}

const numeric = (m) => m.actual != null || m.forecast != null || m.previous != null
const SURPRISE = { above: 'above forecast', below: 'below forecast', inline: 'in line with forecast' }
const pct = (v) => `${v.toFixed(2)}%`

function decisionTitle(d) {
  const range = `${pct(d.lower)}–${pct(d.upper)}`
  if (d.action === 'hold') return `rates held at ${range}`
  return `rates ${d.action === 'hike' ? 'raised' : 'cut'} by ${Math.round(Math.abs(d.changePts) * 100)} bp to ${range}`
}

const consensusLine = (m) =>
  [m.forecast ? `forecast ${m.forecast}` : null, m.previous ? `previous ${m.previous}` : null].filter(Boolean).join(' · ')

/**
 * @param {{ type: string, event: any }} item
 * @param {{ timeZone?: string, now: number }} opts
 * @returns {{ title: string, body: string, tag: string, path: string, urgency: 'normal'|'high', ttlSec: number, priority: number, tags: string[] }}
 */
export function buildMessage(item, { timeZone = 'UTC', now }) {
  const e = item.event
  const measures = (e.measures ?? []).filter(numeric)
  const head = measures[0] ?? null
  const where = COUNTRY[e.country] ?? e.country
  const path = `/?event=${encodeURIComponent(e.id)}`
  const base = { tag: `airmacro-${e.id}`.slice(0, 64), path }

  if (item.type === 'reminder') {
    const mins = Math.max(1, Math.round((e.ts - now) / MIN))
    const lines = [`${where} · high impact · ${localTime(e.ts, timeZone)}`]
    if (head && (head.forecast || head.previous)) lines.push(`${head.name}: ${consensusLine(head)}`)
    if (e.category === 'decision' && e.meeting?.sep) lines.push('With the Summary of Economic Projections.')
    return { ...base, title: `In ${mins} min: ${e.title}`, body: lines.join('\n'), urgency: 'normal', ttlSec: Math.max(60, Math.round((e.ts - now) / 1000)), priority: 3, tags: ['alarm_clock'] }
  }

  if (item.type === 'actual') {
    if (e.decision) {
      const lines = []
      if (head) lines.push([`Fed funds ${head.actual ?? pct(e.decision.upper)}`, consensusLine(head), head.surprise ? SURPRISE[head.surprise] : null].filter(Boolean).join(' · '))
      if (e.decision.vote) lines.push(`Vote ${e.decision.vote.for}–${e.decision.vote.against}`)
      lines.push('Source: Federal Reserve statement')
      return { ...base, title: `FOMC: ${decisionTitle(e.decision)}`, body: lines.join('\n'), urgency: 'high', ttlSec: 6 * 3600, priority: 5, tags: ['bank'] }
    }
    const published = measures.filter((m) => m.actual != null)
    const lines = published.map((m) =>
      [`${m.name} ${m.actual}`, consensusLine(m) ? `(${consensusLine(m)})` : null, m.surprise ? `— ${SURPRISE[m.surprise]}` : null].filter(Boolean).join(' '),
    )
    const sources = [...new Set(published.map((m) => m.actualSource).filter(Boolean))]
    if (sources.length) lines.push(`Source: ${sources.join(', ')}`)
    const lead = published[0] ?? head
    return {
      ...base,
      title: lead?.actual ? `${e.title}: ${lead.name} ${lead.actual}` : `${e.title} released`,
      body: lines.join('\n'),
      urgency: 'high',
      ttlSec: 6 * 3600,
      priority: 5,
      tags: ['chart_with_upwards_trend'],
    }
  }

  if (item.type === 'pending') {
    const decision = e.category === 'decision'
    const lines = [
      decision
        ? 'AirMacro hasn’t read the official statement yet — you’ll get the decision as soon as it has.'
        : 'The official figures aren’t available yet — you’ll get them as soon as they are.',
    ]
    if (head && (head.forecast || head.previous)) lines.push(`${head.name}: ${consensusLine(head)}`)
    return { ...base, title: `${e.title} ${decision ? 'announced' : 'released'}`, body: lines.join('\n'), urgency: 'high', ttlSec: 3 * 3600, priority: 4, tags: ['hourglass'] }
  }

  // released : pas de source ouverte pour le chiffre
  const lines = measures.slice(0, 3).map((m) => `${m.name}: ${consensusLine(m) || 'no consensus'}`)
  lines.push('The actual figure is not available from AirMacro’s free sources.')
  const verb = e.category === 'decision' ? 'announced' : 'released'
  return { ...base, title: `${e.title} ${verb}`, body: lines.join('\n'), urgency: 'high', ttlSec: 3 * 3600, priority: 4, tags: ['loudspeaker'] }
}

/** Notification de test (réglages). */
export function testMessage(nextEvent, { timeZone = 'UTC' } = {}) {
  const body = nextEvent
    ? `Next high-impact event: ${nextEvent.title} at ${localTime(nextEvent.ts, timeZone)}.`
    : 'No high-impact event in the loaded calendar.'
  return { title: 'AirMacro notifications are on', body, tag: 'airmacro-test', path: '/', urgency: 'normal', ttlSec: 600, priority: 3, tags: ['white_check_mark'] }
}

/*
 * AirMacro — explications IA : ancrage sur les données servies par l'application,
 * invite système, validation des requêtes, réponse statique de repli, chaîne de
 * fournisseurs et limitation de débit. Fonctions pures (testées).
 */
import { eventExplainer, indicatorExplainer } from '../../../shared/macro/explainers.mjs'
import { COUNTRY_LABELS } from './calendar.mjs'

const MIN = 60_000

/* ---------- Formatage des faits ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const signed = (v, digits = 0) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(digits)}`

export function periodText(d, period) {
  if (!d) return 'n/a'
  if (period === 'monthly') return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
  if (period === 'quarterly') return `Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1} ${d.slice(0, 4)}`
  return d.slice(0, 10)
}

export const FACT_LABELS = {
  cpiYoY: 'CPI inflation, y/y',
  coreCpiYoY: 'Core CPI inflation, y/y',
  corePceYoY: 'Core PCE inflation, y/y',
  unrate: 'Unemployment rate',
  nfp: 'Nonfarm payrolls, monthly change',
  gdp: 'Real GDP growth, q/q annualized',
  fedTarget: 'Fed funds target range',
  y10: 'US 10-year Treasury yield',
  spread10y3m: '10Y minus 3M Treasury spread',
  vix: 'VIX volatility index',
  dxy: 'US dollar index',
  wti: 'WTI crude oil',
}

export function tileValueText(t) {
  switch (t.key) {
    case 'fedTarget':
      return t.lower != null ? `${t.lower.toFixed(2)}-${t.upper.toFixed(2)}%` : `${t.value.toFixed(2)}%`
    case 'nfp':
      return `${signed(t.value)}k jobs`
    case 'spread10y3m':
      return `${signed(t.value)} bp`
    case 'wti':
      return `$${t.value.toFixed(2)} per barrel`
    case 'vix':
    case 'dxy':
      return t.value.toFixed(2)
    case 'y10':
      return `${t.value.toFixed(2)}%`
    case 'gdp':
      return `${signed(t.value, 1)}%`
    default:
      return `${t.value.toFixed(1)}%`
  }
}

const deltaText = (t) => {
  if (t.delta == null || !t.deltaBase) return null
  const digits = { pp: t.key === 'fedTarget' ? 2 : 1, k: 0, bp: 0, pts: 2, '%': 2 }[t.deltaUnit] ?? 1
  const unit = t.deltaUnit === 'k' ? 'k' : t.deltaUnit === '%' ? '%' : ` ${t.deltaUnit}`
  return `change ${signed(t.delta, digits)}${unit} vs ${periodText(t.deltaBase, t.key === 'fedTarget' ? 'daily' : t.period)}`
}

/** Fait daté d'une tuile : { label, value, period, source, line }. */
export function tileFact(tile, sources = {}) {
  if (!tile) return null
  const label = FACT_LABELS[tile.key] ?? tile.label
  const value = tileValueText(tile)
  const period = tile.key === 'fedTarget' ? `as of ${tile.date}` : periodText(tile.date, tile.period)
  const source = sources[tile.key] ?? tile.provider ?? 'unknown source'
  const extra = [
    deltaText(tile),
    tile.key === 'fedTarget' && tile.effr ? `effective rate ${tile.effr.value.toFixed(2)}% on ${tile.effr.date}` : null,
    tile.key === 'nfp' && tile.avg3 != null ? `3-month average ${signed(tile.avg3)}k` : null,
    tile.key === 'spread10y3m' && tile.inverted != null ? (tile.inverted ? 'curve inverted' : 'curve not inverted') : null,
  ].filter(Boolean)
  return {
    key: tile.key,
    label,
    value,
    period,
    source,
    line: `${label}: ${value} (${period}${extra.length ? `; ${extra.join('; ')}` : ''}) [${source}]`,
  }
}

const RELATED_BY_KIND = {
  fomc: ['fedTarget', 'cpiYoY', 'corePceYoY', 'unrate', 'y10'],
  cpi: ['cpiYoY', 'coreCpiYoY', 'corePceYoY', 'fedTarget'],
  pce: ['corePceYoY', 'coreCpiYoY', 'cpiYoY', 'fedTarget'],
  nfp: ['nfp', 'unrate', 'fedTarget', 'y10'],
  claims: ['unrate', 'nfp', 'fedTarget'],
  jolts: ['unrate', 'nfp', 'fedTarget'],
  labor: ['unrate', 'nfp', 'fedTarget'],
  gdp: ['gdp', 'unrate', 'cpiYoY'],
  retail: ['gdp', 'unrate', 'cpiYoY'],
  sentiment: ['cpiYoY', 'unrate', 'fedTarget'],
  ism: ['gdp', 'unrate', 'cpiYoY'],
  pmi: ['gdp', 'unrate', 'cpiYoY'],
  ecb: ['dxy', 'fedTarget', 'y10'],
  boe: ['dxy', 'fedTarget', 'y10'],
  boj: ['dxy', 'fedTarget', 'y10'],
  speech: ['fedTarget', 'cpiYoY', 'unrate'],
  other: ['fedTarget', 'cpiYoY', 'unrate'],
}

const RELATED_BY_INDICATOR = {
  cpiYoY: ['coreCpiYoY', 'corePceYoY', 'fedTarget'],
  coreCpiYoY: ['cpiYoY', 'corePceYoY', 'fedTarget'],
  corePceYoY: ['coreCpiYoY', 'cpiYoY', 'fedTarget'],
  unrate: ['nfp', 'fedTarget', 'gdp'],
  nfp: ['unrate', 'fedTarget'],
  fedTarget: ['cpiYoY', 'corePceYoY', 'unrate', 'y10'],
  y10: ['fedTarget', 'spread10y3m', 'cpiYoY'],
  spread10y3m: ['y10', 'fedTarget', 'unrate'],
  vix: ['y10', 'dxy', 'fedTarget'],
  dxy: ['fedTarget', 'y10', 'wti'],
  wti: ['cpiYoY', 'dxy'],
  gdp: ['unrate', 'nfp', 'cpiYoY'],
}

/** Série historique d'une tuile (derniers points datés) pour le contexte. */
function historyFor(key, charts) {
  if (!charts) return []
  const pick = {
    cpiYoY: [charts.inflation?.cpiYoY, 'monthly', 6, (v) => `${v.toFixed(1)}%`],
    coreCpiYoY: [charts.inflation?.coreCpiYoY, 'monthly', 6, (v) => `${v.toFixed(1)}%`],
    corePceYoY: [charts.inflation?.corePceYoY, 'monthly', 6, (v) => `${v.toFixed(1)}%`],
    unrate: [charts.labor?.unrate, 'monthly', 6, (v) => `${v.toFixed(1)}%`],
    nfp: [charts.labor?.nfpMoM, 'monthly', 6, (v) => `${signed(v)}k`],
    gdp: [charts.growthRisk?.gdpQoQ, 'quarterly', 6, (v) => `${signed(v, 1)}%`],
    y10: [charts.rates?.y10, 'daily', 5, (v) => `${v.toFixed(2)}%`],
    spread10y3m: [charts.rates?.spread10y3m, 'daily', 5, (v) => `${signed(Math.round(v * 100))} bp`],
    vix: [charts.growthRisk?.vix, 'daily', 5, (v) => v.toFixed(2)],
    dxy: [charts.growthRisk?.dxy, 'daily', 5, (v) => v.toFixed(2)],
    wti: [charts.growthRisk?.wti, 'daily', 5, (v) => `$${v.toFixed(2)}`],
    fedTarget: [charts.rates?.fedTargetUpper, 'daily', 5, (v) => `upper bound ${v.toFixed(2)}%`],
  }[key]
  if (!pick || !pick[0]?.length) return []
  const [rows, period, n, fmt] = pick
  return rows.slice(-n).map((r) => `${periodText(r.d, period)} ${fmt(r.v)}`)
}

const utcText = (ts) => `${new Date(ts).toISOString().slice(0, 16).replace('T', ' ')} UTC`

const nyTimeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
// ICU récent sépare « PM » par une espace fine insécable : normalisée pour le modèle
const nyTime = (ts) => nyTimeFmt.format(ts).replace(/\u202f/g, ' ')

function relText(ts, now) {
  const mins = Math.round((ts - now) / MIN)
  const abs = Math.abs(mins)
  const span = abs >= 1440 ? `${Math.floor(abs / 1440)} d ${Math.floor((abs % 1440) / 60)} h` : abs >= 60 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`
  return mins > 0 ? `upcoming, in ${span}` : `released ${span} ago`
}

function measureLine(m, released) {
  const actual = m.actual
    ? `actual ${m.actual}${m.actualSource ? ` (${m.actualSource})` : ''}`
    : released
      ? m.actualFrom
        ? `actual not yet read from ${m.actualFrom}`
        : 'actual not available from AirMacro sources'
      : 'actual not yet released'
  return `${m.name}: ${actual}; forecast ${m.forecast ?? 'n/a'}; previous ${m.previous ?? 'n/a'}`
}

const decisionText = (d) => {
  const range = `${d.lower.toFixed(2)}-${d.upper.toFixed(2)}%`
  const move = d.action === 'hold' ? `held at ${range}` : `${d.action === 'hike' ? 'raised' : 'cut'} by ${Math.round(Math.abs(d.changePts) * 100)} bp to ${range}`
  return `${move}${d.vote ? `, vote ${d.vote.for}-${d.vote.against}` : ''}`
}

/**
 * Contexte factuel d'une question.
 * @param {{ type: 'event', event: any } | { type: 'indicator', tile: any }} subject
 * @param {{ calendar?: any, series?: any, now: number }} ctx
 * @returns {{ title: string, key: string, lines: string[], nowLine: string, facts: Array<{label: string, value: string, period: string, source: string, line: string}> }}
 */
export function buildGrounding(subject, { calendar, series, now }) {
  const tiles = series?.tiles ?? {}
  const sources = series?.meta?.sourcesBySerie ?? {}
  const lines = []
  let relatedKeys
  let title
  let key
  let status = null

  if (subject.type === 'event') {
    const e = subject.event
    const released = e.ts <= now
    title = e.title
    key = `event:${e.id}`
    lines.push(`SUBJECT: ${e.title} (${COUNTRY_LABELS[e.country] ?? e.country}; impact ${e.impact})`)
    lines.push(
      e.allDay
        ? `Date: ${e.meeting?.start ?? new Date(e.ts).toISOString().slice(0, 10)} (all day, local time of the central bank).`
        : `Scheduled: ${utcText(e.ts)} (${nyTime(e.ts)} New York time).`,
    )
    status = e.allDay ? `Status: ${released ? 'meeting in progress or past' : 'upcoming'}.` : `Status: ${relText(e.ts, now)}.`
    const numeric = (e.measures ?? []).filter((m) => m.actual != null || m.forecast != null || m.previous != null)
    for (const m of numeric) lines.push(`- ${measureLine(m, released)}`)
    const components = (e.measures ?? []).filter((m) => !numeric.includes(m)).map((m) => m.name)
    if (components.length) lines.push(`Also published at this time: ${components.join(', ')}.`)
    if (e.meeting) {
      lines.push(
        `Meeting: ${e.meeting.bank}, ${e.meeting.start} to ${e.meeting.end}${e.meeting.sep ? ', with the Summary of Economic Projections' : ''}.`,
      )
    }
    if (e.decision) lines.push(`Decision from the official statement: ${decisionText(e.decision)}.`)
    if (e.country !== 'USD') lines.push('Note: AirMacro only tracks US and global market series; no local data for this economy.')
    relatedKeys = RELATED_BY_KIND[e.kind] ?? RELATED_BY_KIND.other
  } else {
    const t = subject.tile
    title = t.label
    key = `indicator:${t.key}`
    const fact = tileFact(t)
    lines.push(`SUBJECT: ${fact.label} (indicator)`)
    lines.push(`Latest: ${fact.line}`)
    const history = historyFor(t.key, series?.charts)
    if (history.length) lines.push(`Recent values: ${history.join(', ')}.`)
    relatedKeys = RELATED_BY_INDICATOR[t.key] ?? []
  }

  const facts = relatedKeys.map((k) => tileFact(tiles[k], sources)).filter(Boolean)
  if (facts.length) {
    lines.push('RELATED DATA (latest official values):')
    for (const k of relatedKeys) {
      const short = tileFact(tiles[k])
      if (short) lines.push(`- ${short.line}`)
    }
  }

  const policy = series?.policy
  const meetings = calendar?.policy
  const policyLines = []
  if (policy?.lastDecision) policyLines.push(`- Last FOMC decision (${policy.lastDecision.date}): ${decisionText(policy.lastDecision)}`)
  const next = meetings?.nextFomc
  if (next && !(subject.type === 'event' && subject.event.id === next.id)) {
    policyLines.push(`- Next FOMC decision: ${utcText(next.decisionTs)}${next.sep ? ' (with projections)' : ''}`)
  }
  if (policyLines.length) lines.push('POLICY CONTEXT:', ...policyLines)
  // information volatile hors de l'invite système : elle accompagne la question
  // (l'invite et l'historique restent identiques d'un échange à l'autre → cache du modèle local)
  const nowLine = `Now: ${utcText(now)}.${status ? ` ${status}` : ''}`

  if (subject.type === 'indicator') facts.unshift(tileFact(subject.tile, sources))
  return { title, key, lines, facts, nowLine }
}

/** Message utilisateur envoyé au modèle : question + horodatage (renvoyé tel quel au client pour l'historique). */
export const userTurn = (question, grounding) => `${question}\n\n[${grounding.nowLine}]`

/* ---------- Invites ---------- */

export const SYSTEM_RULES = [
  'You are the macro analyst assistant of AirMacro, a market-monitoring dashboard.',
  'Rules:',
  '- Answer in plain English for an informed investor, in at most 120 words, as short paragraphs or up to four bullets, without headings.',
  '- For any number, date or statistic, use only the DATA section below and cite it with its date. If a figure is not in DATA, say you do not have it; never guess or recall figures from memory.',
  '- You may use general economic knowledge to explain mechanisms and typical market reactions, framed as general tendencies, not predictions.',
  '- Never give investment advice or trading recommendations.',
  '- If the question is unrelated to macroeconomics, markets or the DATA, say briefly that you can only help with this dashboard.',
  '- Keep responses focused, brief, and concise to avoid overwhelming the person.',
].join('\n')

export function buildSystemPrompt(grounding) {
  return `${SYSTEM_RULES}\n\nDATA (from AirMacro's official sources):\n${grounding.lines.join('\n')}`
}

export function defaultQuestion(subject) {
  return subject.type === 'event'
    ? 'Explain this event in at most four short bullet points: what it is; the forecast versus the previous value; why it matters now given the data; what to watch in the result. Stay under 120 words.'
    : 'Explain this indicator in at most four short bullet points: what it measures; what the latest value and recent trend show; why it matters now; what to watch next. Stay under 120 words.'
}

/* ---------- Validation ---------- */

export const LIMITS = { question: 2000, historyItems: 6, historyContent: 4000, id: 120 }
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const clean = (s) => s.replace(CONTROL, '').trim()

/**
 * @returns {{ ok: true, value: { contextType: 'event'|'indicator', id: string, question: string|null,
 *   history: Array<{role: 'user'|'assistant', content: string}>, stream: boolean } } | { ok: false, error: string }}
 */
export function validateExplainRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' }
  const { contextType, id, question, history, stream } = body
  if (contextType !== 'event' && contextType !== 'indicator') return { ok: false, error: 'contextType must be "event" or "indicator"' }
  if (typeof id !== 'string' || !id || id.length > LIMITS.id || !/^[a-z0-9][a-z0-9.:-]*$/i.test(id)) {
    return { ok: false, error: 'invalid id' }
  }
  let q = null
  if (question != null) {
    if (typeof question !== 'string') return { ok: false, error: 'question must be a string' }
    if (question.length > LIMITS.question) return { ok: false, error: `question longer than ${LIMITS.question} characters` }
    q = clean(question) || null
  }
  const hist = []
  if (history != null) {
    if (!Array.isArray(history)) return { ok: false, error: 'history must be an array' }
    if (history.length > LIMITS.historyItems) return { ok: false, error: `history limited to ${LIMITS.historyItems} messages` }
    for (const [i, item] of history.entries()) {
      const expected = i % 2 === 0 ? 'user' : 'assistant'
      if (!item || item.role !== expected || typeof item.content !== 'string') {
        return { ok: false, error: 'history must alternate user/assistant messages, starting with user' }
      }
      if (item.content.length > LIMITS.historyContent) return { ok: false, error: 'history message too long' }
      const content = clean(item.content)
      if (!content) return { ok: false, error: 'history messages cannot be empty' }
      hist.push({ role: expected, content })
    }
    if (hist.length % 2 !== 0) return { ok: false, error: 'history must end with an assistant message' }
  }
  if (hist.length && !q) return { ok: false, error: 'a follow-up needs a question' }
  if (stream != null && typeof stream !== 'boolean') return { ok: false, error: 'stream must be a boolean' }
  return { ok: true, value: { contextType, id, question: q, history: hist, stream: stream ?? true } }
}

/* ---------- Fournisseurs ---------- */

export const PROVIDER_LABELS = { claude: 'Claude', static: 'Built-in explainer' }

/**
 * Chaîne de fournisseurs : Claude (clé présente) → modèle local → (statique en dernier recours,
 * ajouté par l'appelant). Hors ligne strict : aucun appel de modèle, même local.
 */
export function providerChain({ offline, claude, ollama }) {
  if (offline) return []
  const chain = []
  if (claude) chain.push({ id: 'claude', kind: 'claude', label: PROVIDER_LABELS.claude })
  if (ollama?.reachable && ollama.model) {
    chain.push({ id: `ollama:${ollama.model}`, kind: 'ollama', label: `Local model (${ollama.model})`, model: ollama.model })
  }
  return chain
}

const NOTICES = {
  offline: 'AirMacro is in offline mode, so AI answers are disabled.',
  no_backend: 'No AI backend is configured on this server.',
  rate_limited: 'The AI question limit for this hour has been reached.',
  providers_failed: 'The AI backend did not answer in time.',
}

/** Réponse de repli : explication rédigée + faits datés (jamais de chiffre inventé). */
export function staticAnswer(explainer, facts, { question = null, notice = null } = {}) {
  const parts = []
  if (question || notice) {
    parts.push(`${notice ? `${NOTICES[notice] ?? 'AI answer unavailable.'} ` : ''}Here is the built-in explanation instead.`)
  }
  if (explainer) {
    parts.push(`What it is: ${explainer.what}`, `Why it matters: ${explainer.why}`, `How to read it: ${explainer.read}`)
  }
  const shown = facts.filter(Boolean).slice(0, 5)
  if (shown.length) parts.push(`Latest data:\n${shown.map((f) => `• ${f.label}: ${f.value} (${f.period})`).join('\n')}`)
  return parts.join('\n\n')
}

export const explainerFor = (subject) =>
  subject.type === 'event' ? eventExplainer(subject.event) : indicatorExplainer(subject.tile.key)

/* ---------- Limitation de débit ---------- */

export function createRateLimiter({ limit = 30, windowMs = 3_600_000 } = {}) {
  const hits = new Map()
  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return { ok: false, retryAfterMs: windowMs - (now - recent[0]) }
      }
      recent.push(now)
      hits.set(key, recent)
      if (hits.size > 1000) {
        for (const [k, list] of hits) if (!list.some((t) => now - t < windowMs)) hits.delete(k)
      }
      return { ok: true, remaining: limit - recent.length }
    },
  }
}

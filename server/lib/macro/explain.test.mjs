import { describe, it, expect } from 'vitest'
import {
  buildGrounding,
  buildSystemPrompt,
  createRateLimiter,
  defaultQuestion,
  explainerFor,
  providerChain,
  staticAnswer,
  tileFact,
  userTurn,
  validateExplainRequest,
} from './explain.mjs'
import { createNdjsonParser, pickModel } from '../llm/ollama.mjs'
import { EVENT_EXPLAINERS, INDICATOR_EXPLAINERS } from '../../../shared/macro/explainers.mjs'

const NOW = Date.UTC(2026, 8, 16, 13, 53)

const TILES = {
  fedTarget: {
    key: 'fedTarget', label: 'Fed funds target', unit: '%', period: 'daily', value: 3.75, lower: 3.5, upper: 3.75,
    date: '2026-09-15', delta: -0.75, deltaUnit: 'pp', deltaBase: '2025-09-15', spark: [],
    effr: { value: 3.63, date: '2026-09-15' }, family: 'nyfed', provider: 'NY Fed',
  },
  cpiYoY: { key: 'cpiYoY', label: 'CPI YoY', unit: '%', period: 'monthly', value: 3.4, date: '2026-08-01', delta: 0, deltaUnit: 'pp', deltaBase: '2026-07-01', spark: [], family: 'bls', provider: 'BLS' },
  corePceYoY: { key: 'corePceYoY', label: 'Core PCE YoY', unit: '%', period: 'monthly', value: 3.3, date: '2026-07-01', delta: 0, deltaUnit: 'pp', deltaBase: '2026-06-01', spark: [], family: 'bea', provider: 'BEA' },
  unrate: { key: 'unrate', label: 'Unemployment', unit: '%', period: 'monthly', value: 4.1, date: '2026-08-01', delta: 0, deltaUnit: 'pp', deltaBase: '2026-07-01', spark: [], family: 'bls', provider: 'BLS' },
  y10: { key: 'y10', label: 'US 10Y yield', unit: '%', period: 'daily', value: 5, date: '2026-09-15', delta: 3, deltaUnit: 'bp', deltaBase: '2026-09-14', spark: [], family: 'treasury', provider: 'US Treasury' },
  coreCpiYoY: { key: 'coreCpiYoY', label: 'Core CPI YoY', unit: '%', period: 'monthly', value: 2.4, date: '2026-08-01', delta: -0.1, deltaUnit: 'pp', deltaBase: '2026-07-01', spark: [], family: 'bls', provider: 'BLS' },
}

const SERIES = {
  tiles: TILES,
  charts: {
    inflation: {
      cpiYoY: [
        { d: '2026-07-01', v: 3.4 },
        { d: '2026-08-01', v: 3.4 },
      ],
      coreCpiYoY: [],
      corePceYoY: [],
      target: 2,
    },
    labor: { nfpMoM: [], unrate: [] },
    rates: { y10: [], m3: [], spread10y3m: [], fedTargetUpper: [], fedTargetLower: [], effr: null },
    growthRisk: { gdpQoQ: [], vix: [], dxy: [], wti: [] },
  },
  policy: {
    target: { lower: 3.5, upper: 3.75, asOf: '2026-09-15', source: 'NY Fed' },
    effr: { value: 3.63, date: '2026-09-15' },
    lastDecision: { date: '2026-07-29', url: 'u', action: 'hold', lower: 3.5, upper: 3.75, changePts: 0, vote: { for: 9, against: 3 } },
    links: {},
  },
  meta: { sourcesBySerie: { fedTarget: 'NY Fed · EFFR & target range', cpiYoY: 'BLS · CPI-U, NSA (CUUR0000SA0)' } },
}

const FOMC = {
  id: 'fomc-2026-09-16-decision',
  kind: 'fomc',
  category: 'decision',
  title: 'FOMC rate decision',
  country: 'USD',
  ts: Date.UTC(2026, 8, 16, 18, 0),
  impact: 'High',
  allDay: false,
  measures: [
    { name: 'Federal Funds Rate', forecast: '4.00%', previous: '3.75%', actual: null },
    { name: 'FOMC Statement', forecast: null, previous: null, actual: null },
  ],
  meeting: { bank: 'Fed', start: '2026-09-15', end: '2026-09-16', sep: true },
}

const CALENDAR = {
  events: [FOMC],
  policy: {
    nextFomc: { id: 'fomc-2026-09-16-decision', decisionTs: FOMC.ts, sep: true },
    followingFomc: { id: 'fomc-2026-10-28-decision', decisionTs: Date.UTC(2026, 9, 28, 18), sep: false },
  },
}

describe('validation des requêtes', () => {
  it('requête minimale valide', () => {
    expect(validateExplainRequest({ contextType: 'event', id: 'fomc-2026-09-16-decision' })).toEqual({
      ok: true,
      value: { contextType: 'event', id: 'fomc-2026-09-16-decision', question: null, history: [], stream: true },
    })
  })
  it('suivi avec historique alterné, caractères de contrôle retirés', () => {
    const out = validateExplainRequest({
      contextType: 'indicator',
      id: 'cpiYoY',
      question: 'Why\u0007 now?',
      history: [
        { role: 'user', content: 'Explain' },
        { role: 'assistant', content: 'CPI is…' },
      ],
      stream: false,
    })
    expect(out.ok && out.value.question).toBe('Why now?')
    expect(out.ok && out.value.history).toHaveLength(2)
  })
  it.each([
    [{ contextType: 'chart', id: 'x' }, /contextType/],
    [{ contextType: 'event', id: 'bad id!' }, /invalid id/],
    [{ contextType: 'event', id: 'x', question: 'a'.repeat(2001) }, /2000/],
    [{ contextType: 'event', id: 'x', question: 42 }, /string/],
    [{ contextType: 'event', id: 'x', question: 'q', history: Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' })) }, /limited to 6/],
    [{ contextType: 'event', id: 'x', question: 'q', history: [{ role: 'assistant', content: 'x' }] }, /alternate/],
    [{ contextType: 'event', id: 'x', question: 'q', history: [{ role: 'user', content: 'x' }] }, /end with an assistant/],
    [{ contextType: 'event', id: 'x', history: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] }, /needs a question/],
    [{ contextType: 'event', id: 'x', stream: 'yes' }, /boolean/],
    [[], /JSON object/],
    [null, /JSON object/],
  ])('rejette %j', (body, re) => {
    const out = validateExplainRequest(body)
    expect(out.ok).toBe(false)
    expect(out.ok ? '' : out.error).toMatch(re)
  })
})

describe('chaîne de fournisseurs', () => {
  const ollama = { reachable: true, model: 'llama3.1:8b', models: ['llama3.1:8b'] }
  it('Claude puis modèle local', () => {
    expect(providerChain({ offline: false, claude: true, ollama }).map((p) => p.id)).toEqual(['claude', 'ollama:llama3.1:8b'])
    expect(providerChain({ offline: false, claude: false, ollama })[0]).toMatchObject({ kind: 'ollama', label: 'Local model (llama3.1:8b)' })
  })
  it('hors ligne strict : aucun modèle, même local', () => {
    expect(providerChain({ offline: true, claude: true, ollama })).toEqual([])
  })
  it('Ollama injoignable ou sans modèle', () => {
    expect(providerChain({ offline: false, claude: false, ollama: { reachable: false } })).toEqual([])
    expect(providerChain({ offline: false, claude: false, ollama: { reachable: true, model: null } })).toEqual([])
  })
  it('choix du modèle local', () => {
    expect(pickModel(['mistral:7b', 'llama3.1:8b'])).toBe('llama3.1:8b')
    expect(pickModel(['mistral:7b', 'llama3.1:8b'], 'mistral:7b')).toBe('mistral:7b')
    expect(pickModel(['mistral:7b'], 'absent')).toBe('mistral:7b')
    expect(pickModel([])).toBeNull()
  })
})

describe('ancrage sur les données', () => {
  it('FOMC : horaires, chiffres, réunion, données liées, contexte', () => {
    const g = buildGrounding({ type: 'event', event: FOMC }, { calendar: CALENDAR, series: SERIES, now: NOW })
    expect(g.key).toBe('event:fomc-2026-09-16-decision')
    expect(g.lines).toContain('SUBJECT: FOMC rate decision (US; impact High)')
    expect(g.lines).toContain('Scheduled: 2026-09-16 18:00 UTC (2:00 PM New York time).')
    expect(g.nowLine).toBe('Now: 2026-09-16 13:53 UTC. Status: upcoming, in 4 h 7 min.')
    expect(g.lines.some((l) => l.startsWith('Now:'))).toBe(false)
    expect(g.lines).toContain('- Federal Funds Rate: actual not yet released; forecast 4.00%; previous 3.75%')
    expect(g.lines).toContain('Also published at this time: FOMC Statement.')
    expect(g.lines).toContain('Meeting: Fed, 2026-09-15 to 2026-09-16, with the Summary of Economic Projections.')
    expect(g.lines).toContain(
      '- Fed funds target range: 3.50-3.75% (as of 2026-09-15; change -0.75 pp vs 2025-09-15; effective rate 3.63% on 2026-09-15) [NY Fed]',
    )
    expect(g.lines).toContain('- CPI inflation, y/y: 3.4% (Aug 2026; change 0.0 pp vs Jul 2026) [BLS]')
    // libellés de source détaillés conservés pour l'interface
    expect(g.facts[0].source).toBe('NY Fed · EFFR & target range')
    expect(g.lines).toContain('- Last FOMC decision (2026-07-29): held at 3.50-3.75%, vote 9-3')
    // la réunion en question n'est pas répétée comme « prochaine »
    expect(g.lines.some((l) => l.startsWith('- Next FOMC decision'))).toBe(false)
    expect(g.facts.map((f) => f.key)).toEqual(['fedTarget', 'cpiYoY', 'corePceYoY', 'unrate', 'y10'])
  })

  it('après publication : actual du communiqué et décision', () => {
    const released = {
      ...FOMC,
      measures: [{ name: 'Federal Funds Rate', forecast: '4.00%', previous: '3.75%', actual: '4.00%', actualSource: 'Fed statement' }],
      decision: { action: 'hike', lower: 3.75, upper: 4, changePts: 0.25, vote: { for: 10, against: 2 } },
    }
    const g = buildGrounding({ type: 'event', event: released }, { calendar: CALENDAR, series: SERIES, now: FOMC.ts + 25 * 60_000 })
    expect(g.nowLine).toBe('Now: 2026-09-16 18:25 UTC. Status: released 25 min ago.')
    expect(g.lines).toContain('- Federal Funds Rate: actual 4.00% (Fed statement); forecast 4.00%; previous 3.75%')
    expect(g.lines).toContain('Decision from the official statement: raised by 25 bp to 3.75-4.00%, vote 10-2.')
  })

  it('publication passée sans source officielle : jamais inventée', () => {
    const uk = { ...FOMC, id: 'uk-cpi', kind: 'cpi', category: 'data', title: 'UK CPI', country: 'GBP', meeting: undefined, measures: [{ name: 'CPI y/y', forecast: '3.1%', previous: '2.9%', actual: null }] }
    const g = buildGrounding({ type: 'event', event: uk }, { calendar: CALENDAR, series: SERIES, now: FOMC.ts + 3_600_000 })
    expect(g.lines).toContain('- CPI y/y: actual not available from AirMacro sources; forecast 3.1%; previous 2.9%')
    expect(g.lines.some((l) => l.includes('no local data for this economy'))).toBe(true)
  })

  it('indicateur : valeur, historique et prochaine réunion', () => {
    const g = buildGrounding({ type: 'indicator', tile: TILES.cpiYoY }, { calendar: CALENDAR, series: SERIES, now: NOW })
    expect(g.lines[0]).toBe('SUBJECT: CPI inflation, y/y (indicator)')
    expect(g.lines).toContain('Recent values: Jul 2026 3.4%, Aug 2026 3.4%.')
    expect(g.lines).toContain('- Next FOMC decision: 2026-09-16 18:00 UTC (with projections)')
    expect(g.facts[0].key).toBe('cpiYoY')
  })

  it('invite système : règles puis données datées', () => {
    const g = buildGrounding({ type: 'event', event: FOMC }, { calendar: CALENDAR, series: SERIES, now: NOW })
    const prompt = buildSystemPrompt(g)
    expect(prompt.startsWith('You are the macro analyst assistant of AirMacro')).toBe(true)
    expect(prompt).toContain('Never give investment advice')
    expect(prompt).toContain("DATA (from AirMacro's official sources):\nSUBJECT: FOMC rate decision")
    expect(prompt.indexOf('Rules:')).toBeLessThan(prompt.indexOf('DATA'))
    // l'invite système ne dépend pas de l'heure (cache de préfixe du modèle local) ;
    // l'horodatage accompagne la question
    const laterGrounding = buildGrounding({ type: 'event', event: FOMC }, { calendar: CALENDAR, series: SERIES, now: NOW + 60_000 })
    expect(buildSystemPrompt(laterGrounding)).toBe(prompt)
    expect(userTurn('Why?', laterGrounding)).toBe('Why?\n\n[Now: 2026-09-16 13:54 UTC. Status: upcoming, in 4 h 6 min.]')
    expect(defaultQuestion({ type: 'event' })).toMatch(/^Explain this event in at most four short bullet points: .*forecast versus the previous value/)
  })
})

describe('réponse statique', () => {
  it('explication + faits datés, avec motif', () => {
    const facts = [tileFact(TILES.fedTarget), tileFact(TILES.cpiYoY)]
    const text = staticAnswer(explainerFor({ type: 'event', event: FOMC }), facts, { question: 'Why?', notice: 'offline' })
    expect(text.startsWith('AirMacro is in offline mode, so AI answers are disabled. Here is the built-in explanation instead.')).toBe(true)
    expect(text).toContain(`What it is: ${EVENT_EXPLAINERS.fomc.what}`)
    expect(text).toContain('• Fed funds target range: 3.50-3.75% (as of 2026-09-15)')
    expect(text).toContain('• CPI inflation, y/y: 3.4% (Aug 2026)')
  })
  it('sans question ni motif : pas de préambule', () => {
    const text = staticAnswer(INDICATOR_EXPLAINERS.vix, [])
    expect(text.startsWith('What it is: The Cboe Volatility Index')).toBe(true)
  })
  it('chaque type d’événement et chaque tuile a une explication', () => {
    for (const kind of ['fomc', 'ecb', 'boe', 'boj', 'cpi', 'pce', 'nfp', 'claims', 'jolts', 'gdp', 'ism', 'pmi', 'retail', 'sentiment', 'labor', 'speech', 'other']) {
      expect(explainerFor({ type: 'event', event: { kind, category: 'data' } }).what.length).toBeGreaterThan(40)
    }
    expect(explainerFor({ type: 'event', event: { kind: 'fomc', category: 'meeting' } }).title).toMatch(/in session/)
    expect(explainerFor({ type: 'event', event: { kind: 'unknown', category: 'data' } }).title).toBe('Economic release')
    for (const key of ['cpiYoY', 'coreCpiYoY', 'corePceYoY', 'unrate', 'nfp', 'fedTarget', 'y10', 'spread10y3m', 'vix', 'dxy', 'wti', 'gdp']) {
      expect(explainerFor({ type: 'indicator', tile: { key } }).what.length).toBeGreaterThan(40)
    }
  })
})

describe('limitation de débit', () => {
  it('fenêtre glissante', () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 1000 })
    expect(rl.take('ip', 0).ok).toBe(true)
    expect(rl.take('ip', 100).ok).toBe(true)
    expect(rl.take('ip', 200)).toEqual({ ok: false, retryAfterMs: 800 })
    expect(rl.take('other', 200).ok).toBe(true)
    expect(rl.take('ip', 1001).ok).toBe(true)
  })
})

describe('flux NDJSON Ollama', () => {
  it('objets coupés entre deux paquets', () => {
    const seen = []
    const parser = createNdjsonParser((o) => seen.push(o))
    parser.push('{"message":{"content":"Hel')
    parser.push('lo"},"done":false}\n{"message":{"content":" world"},"done":false}\n{"done":t')
    parser.push('rue,"eval_count":2}')
    parser.end()
    expect(seen.map((o) => o.message?.content ?? (o.done ? 'DONE' : ''))).toEqual(['Hello', ' world', 'DONE'])
  })
})

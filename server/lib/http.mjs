/*
 * Client HTTP sortant : allowlist d'hôtes stricte, timeout, retry unique,
 * User-Agent stable et statistiques par hôte pour /api/health.
 */
import { execFile } from 'node:child_process'

const ALLOWED_HOSTS = new Set([
  'api.coingecko.com',
  'api.binance.com',
  'fapi.binance.com',
  'api.bybit.com',
  'www.okx.com',
  'www.deribit.com',
  'api.alternative.me',
  'stooq.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'community-api.coinmetrics.io',
  'cci30.com',
  'www.cci30.com',
  'api.blockchain.info',
  'cointelegraph.com',
  'www.coindesk.com',
  'decrypt.co',
  'bitcoinmagazine.com',
  'www.theblock.co',
  // AirMacro — calendrier, séries officielles, LLM
  'nfs.faireconomy.media',
  'api.bls.gov',
  'apps.bea.gov',
  'home.treasury.gov',
  'cdn.cboe.com',
  'markets.newyorkfed.org',
  'www.federalreserve.gov',
  'data-api.ecb.europa.eu',
  'api.eia.gov',
  'fred.stlouisfed.org',
  'api.stlouisfed.org',
  'api.anthropic.com',
  // AirMacro — chiffres publiés (« actual ») lus à la source officielle
  'www.bankofengland.co.uk',
  'www.dol.gov',
  'www.ons.gov.uk',
  'www.boj.or.jp',
  'www.ecb.europa.eu',
  'www.sca.isr.umich.edu',
  'www.conference-board.org',
  'www.prnewswire.com',
  'ec.europa.eu',
  // AirMacro — alertes ntfy (serveur auto-hébergé : allowHost via AIRMACRO_NTFY_URL)
  'ntfy.sh',
])

/** Ajoute un hôte configuré par l'opérateur (variable d'environnement), jamais par un client. */
export function allowHost(host) {
  ALLOWED_HOSTS.add(host)
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 AirCrypto-Monitor/0.1'

/** @type {Map<string, {lastSuccessAt: string|null, lastErrorAt: string|null, lastError: string|null, lastMs: number|null, successes: number, failures: number}>} */
const hostStats = new Map()

function statsFor(host) {
  let s = hostStats.get(host)
  if (!s) {
    s = { lastSuccessAt: null, lastErrorAt: null, lastError: null, lastMs: null, successes: 0, failures: 0 }
    hostStats.set(host, s)
  }
  return s
}

/* Disjoncteur : après 3 échecs consécutifs, l'hôte est écarté 90 s (échec immédiat)
 * pour borner la latence quand un fournisseur est injoignable ou rate-limité. */
const BREAKER_THRESHOLD = 3
const BREAKER_COOLDOWN_MS = 90_000
const consecutiveFailures = new Map()
const blockedUntil = new Map()

function breakerCheck(host) {
  const until = blockedUntil.get(host) ?? 0
  if (Date.now() < until) {
    throw new Error(`circuit ouvert pour ${host} (refroidissement)`)
  }
}

function mark(host, ok, ms, err) {
  const s = statsFor(host)
  s.lastMs = ms
  if (ok) {
    s.lastSuccessAt = new Date().toISOString()
    s.successes += 1
    consecutiveFailures.set(host, 0)
    blockedUntil.delete(host)
  } else {
    s.lastErrorAt = new Date().toISOString()
    s.lastError = err ? String(err.message ?? err).slice(0, 200) : 'inconnu'
    s.failures += 1
    const streak = (consecutiveFailures.get(host) ?? 0) + 1
    consecutiveFailures.set(host, streak)
    if (streak >= BREAKER_THRESHOLD) {
      blockedUntil.set(host, Date.now() + BREAKER_COOLDOWN_MS)
    }
    console.warn(`[amont] échec ${host} — ${s.lastError} (${ms}ms)`)
  }
}

export function upstreamStats() {
  return Object.fromEntries(hostStats.entries())
}

function assertAllowed(url) {
  const host = new URL(url).hostname
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`hôte non autorisé: ${host}`)
  }
  return host
}

function httpError(status, suffix = '') {
  const err = new Error(`HTTP ${status}${suffix}`)
  err.status = status
  return err
}

/* Lecture en flux ligne à ligne (gros fichiers plats) : seules les lignes
 * retenues par `lineFilter` sont gardées en mémoire. */
async function readLines(res, lineFilter) {
  const decoder = new TextDecoder()
  const kept = []
  let rest = ''
  for await (const chunk of res.body) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) if (lineFilter(line)) kept.push(line.replace(/\r$/, ''))
  }
  rest += decoder.decode()
  if (rest && lineFilter(rest)) kept.push(rest.replace(/\r$/, ''))
  return kept
}

async function viaFetch(url, { timeoutMs, headers, as, method, body, acceptStatus, lineFilter }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: as === 'json' ? 'application/json' : as === 'buffer' ? 'application/pdf, application/*' : 'text/*, application/*',
        ...headers,
      },
    })
    assertAllowed(res.url || url)
    const meta = {
      status: res.status,
      headers: { lastModified: res.headers.get('last-modified'), etag: res.headers.get('etag') },
    }
    if (acceptStatus.includes(res.status)) {
      await res.body?.cancel().catch(() => {})
      return { ...meta, body: null }
    }
    if (!res.ok) throw httpError(res.status)
    const parsed =
      as === 'lines'
        ? await readLines(res, lineFilter)
        : as === 'json'
          ? await res.json()
          : as === 'buffer'
            ? Buffer.from(await res.arrayBuffer())
            : await res.text()
    return { ...meta, body: parsed }
  } finally {
    clearTimeout(timer)
  }
}

/* Transport de repli : certains hôtes (Yahoo) rejettent l'empreinte TLS de
 * node mais acceptent curl. Arguments passés en tableau (aucun shell),
 * HTTPS uniquement, pas de redirection. */
function viaCurl(url, { timeoutMs, headers, as, method, body }) {
  return new Promise((resolve, reject) => {
    const args = ['-sS', '--proto', '=https', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-X', method]
    args.push('-A', headers['User-Agent'] ?? UA, '-w', '\n%{http_code}')
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== 'user-agent') args.push('-H', `${name}: ${value}`)
    }
    if (body != null) args.push('--data-binary', String(body))
    args.push('--', url)
    execFile('curl', args, { maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs + 2000 }, (err, stdout) => {
      if (err) {
        reject(new Error(`curl: ${String(err.message).split('\n')[0].slice(0, 120)}`))
        return
      }
      const cut = stdout.lastIndexOf('\n')
      const status = Number(stdout.slice(cut + 1))
      const text = stdout.slice(0, cut)
      if (!(status >= 200 && status < 300)) {
        reject(httpError(status, ' (curl)'))
        return
      }
      try {
        resolve({ status, headers: {}, body: as === 'json' ? JSON.parse(text) : text })
      } catch (parseErr) {
        reject(parseErr)
      }
    })
  })
}

/**
 * @param {string} url
 * @param {{
 *   timeoutMs?: number, retries?: number, headers?: Record<string,string>,
 *   as?: 'json'|'text'|'lines'|'buffer', method?: string, body?: string,
 *   acceptStatus?: number[], withMeta?: boolean,
 *   lineFilter?: (line: string) => boolean, curlFallback?: boolean,
 * }} [options]
 *   `acceptStatus` : statuts non-2xx traités comme réponses valides sans corps
 *   (304 conditionnel, 404 « pas encore publié ») — ils ne comptent pas comme échecs.
 *   `withMeta` : renvoie { status, headers: { lastModified, etag }, body }.
 *   `curlFallback` : après un 429, les tentatives suivantes passent par curl.
 * @returns {Promise<any>}
 */
export async function request(url, options = {}) {
  // L'egress local perd des connexions par intermittence : 3 tentatives avec backoff.
  const {
    timeoutMs = 8000,
    retries = 2,
    headers = {},
    as = 'json',
    method = 'GET',
    body,
    acceptStatus = [],
    withMeta = false,
    lineFilter = () => true,
    curlFallback = false,
  } = options
  const host = assertAllowed(url)
  breakerCheck(host)
  let lastError
  let useCurl = false
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 350 * attempt))
    const started = Date.now()
    try {
      const spec = { timeoutMs, headers, as, method, body, acceptStatus, lineFilter }
      const result = useCurl && as !== 'lines' && as !== 'buffer' ? await viaCurl(url, spec) : await viaFetch(url, spec)
      mark(host, true, Date.now() - started)
      return withMeta ? result : result.body
    } catch (err) {
      lastError = err
      mark(host, false, Date.now() - started, err)
      if (curlFallback && err?.status === 429) useCurl = true
    }
  }
  throw lastError
}

export const fetchJson = (url, options = {}) => request(url, { ...options, as: 'json' })
export const fetchText = (url, options = {}) => request(url, { ...options, as: 'text' })
export const fetchBuffer = (url, options = {}) => request(url, { ...options, as: 'buffer' })

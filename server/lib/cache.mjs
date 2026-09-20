/*
 * Résolution de données avec enveloppe { data, source, provider, asOf } :
 *   frais (< TTL)  → 'live'
 *   périmé          → servi en 'cache' + rafraîchissement en arrière-plan (SWR)
 *   échec sans rien → seed embarqué ('seed')
 * AIRCRYPTO_OFFLINE=1 force le seed partout.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

/* Drapeau fichier : permet de basculer le serveur supervisé en mode seeds
 * sans le redémarrer (tests du mode dégradé). */
const OFFLINE_FLAG = new URL('../../.aircrypto-offline', import.meta.url)
let flagCheckedAt = 0
let flagValue = false

export const isOffline = () => {
  if (process.env.AIRCRYPTO_OFFLINE === '1') return true
  const now = Date.now()
  if (now - flagCheckedAt > 1500) {
    flagCheckedAt = now
    flagValue = existsSync(OFFLINE_FLAG)
  }
  return flagValue
}

/** @type {Map<string, {data: any, provider: string, at: number}>} */
const memory = new Map()
/** @type {Map<string, Promise<any>>} */
const inflight = new Map()

const seedCache = new Map()

/* Un seed peut être absent ou illisible (capture jamais faite, fichier retiré
 * d'une distribution) : erreur propre, sans chemin absolu, traitée comme une
 * absence de donnée par `resolveData`. */
export async function loadSeed(name) {
  if (seedCache.has(name)) return seedCache.get(name)
  const url = new URL(`../seed/${name}.json`, import.meta.url)
  let parsed
  try {
    parsed = JSON.parse(await readFile(url, 'utf8'))
  } catch {
    throw new Error(`seed « ${name} » indisponible`)
  }
  seedCache.set(name, parsed)
  return parsed
}

function envelope(entry, source) {
  return {
    data: entry.data,
    source,
    provider: entry.provider,
    asOf: new Date(entry.at).toISOString(),
  }
}

async function seedEnvelope(seedName) {
  const seed = await loadSeed(seedName)
  return {
    data: seed.data,
    source: 'seed',
    provider: 'seed',
    asOf: seed.capturedAt ?? null,
    note: seed.note ?? "données d'exemple embarquées",
  }
}

function fetchDeduped(key, live) {
  let p = inflight.get(key)
  if (!p) {
    p = Promise.resolve()
      .then(live)
      .then((result) => {
        // `fetchedAt` (optionnel) : heure réelle de récupération d'une donnée relue
        // depuis un cache disque — le TTL et asOf partent alors de cette heure.
        const fetchedAt = result.fetchedAt ? Date.parse(result.fetchedAt) : NaN
        const at = Number.isFinite(fetchedAt) ? Math.min(fetchedAt, Date.now()) : Date.now()
        memory.set(key, { data: result.data, provider: result.provider, at })
        return result
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

/**
 * @param {{key: string, ttlMs: number, live: () => Promise<{data: any, provider: string}>, seed?: string, liveBudgetMs?: number}} spec
 *
 * `liveBudgetMs` borne l'attente du premier fetch : au-delà, on sert le seed
 * pendant que le fetch continue en arrière-plan et alimentera le cache.
 * Sans `seed` (données propres à une publication, sans capture d'exemple
 * pertinente), l'absence de donnée est une erreur : l'appelant l'ignore.
 */
export async function resolveData({ key, ttlMs, live, seed, liveBudgetMs = 9000 }) {
  if (!isOffline()) {
    const entry = memory.get(key)
    const now = Date.now()
    if (entry && now - entry.at < ttlMs) {
      return envelope(entry, 'live')
    }
    if (entry) {
      // stale-while-revalidate : rafraîchit en arrière-plan, sert le dernier bon connu
      fetchDeduped(key, live).catch(() => {})
      return envelope(entry, 'cache')
    }
    try {
      let timer
      const pending = fetchDeduped(key, live)
      pending.catch(() => {}) // pas d'unhandled rejection si le budget expire d'abord
      await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`budget live ${liveBudgetMs} ms dépassé`)), liveBudgetMs)
        }),
      ]).finally(() => clearTimeout(timer))
      return envelope(memory.get(key), 'live')
    } catch (err) {
      console.warn(`[cache] ${key}: amont indisponible (${String(err?.message ?? err).slice(0, 120)})${seed ? ' → seed' : ''}`)
    }
  }
  if (!seed) throw new Error(`${key}: aucune donnée disponible`)
  return seedEnvelope(seed)
}

const SOURCE_RANK = { live: 0, cache: 1, seed: 2 }

/** Source « la moins fraîche » d'un ensemble de sous-parties. */
export function worstSource(sources) {
  let worst = 'live'
  for (const s of sources) {
    if (s && SOURCE_RANK[s] > SOURCE_RANK[worst]) worst = s
  }
  return worst
}

export function cacheInfo() {
  return {
    offline: isOffline(),
    keys: [...memory.keys()],
    entries: memory.size,
  }
}

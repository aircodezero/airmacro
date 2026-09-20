/*
 * Aides communes aux endpoints /api/* : sous-parties bornées dans le temps,
 * enveloppes composites et gestion d'erreur uniforme.
 */
import { worstSource } from '../lib/cache.mjs'

export const nowIso = () => new Date().toISOString()

/**
 * Résout une promesse d'enveloppe en enveloppe ou null (échec toléré),
 * bornée à 12 s : une sous-partie lente ne retient jamais tout l'endpoint
 * (le fetch sous-jacent continue et alimentera le cache pour l'appel suivant).
 */
const PART_TIMEOUT_MS = 12_000
export async function part(promise, timeoutMs = PART_TIMEOUT_MS) {
  try {
    let timer
    const result = await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`sous-partie trop lente (> ${Math.round(timeoutMs / 1000)} s)`)), timeoutMs)
      }),
    ]).finally(() => clearTimeout(timer))
    return result
  } catch (err) {
    promise.catch(() => {}) // le fetch continue en arrière-plan sans unhandled rejection
    console.warn(`[api] sous-partie indisponible: ${String(err?.message ?? err).slice(0, 140)}`)
    return null
  }
}

export function composed(data, parts) {
  const sources = Object.values(parts).map((s) => s ?? 'seed')
  return {
    data: { ...data, parts },
    source: worstSource(sources),
    provider: 'composite',
    asOf: nowIso(),
  }
}

export function wrap(handler) {
  return async (req, res) => {
    try {
      const body = await handler(req)
      if (!body) {
        res.status(503).json({ error: 'unavailable' })
        return
      }
      res.json(body)
    } catch (err) {
      // Détail complet dans le journal de l'opérateur ; réponse générique au client :
      // un message d'erreur interne peut porter un chemin de fichier ou un hôte amont.
      console.error(`[api] ${req.path} en échec:`, err)
      res.status(503).json({ error: 'unavailable' })
    }
  }
}

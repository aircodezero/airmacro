/*
 * Flux hebdomadaire FairEconomy (calendrier Forex Factory, JSON public non documenté).
 * Champs observés : title, country (devise), date (ISO + décalage), impact, forecast, previous.
 * Pas de champ « actual » : les résultats viennent des séries officielles.
 * `nextweek` n'est publié qu'en fin de semaine (404 sinon).
 */
import { request } from '../../http.mjs'

const BASE = 'https://nfs.faireconomy.media'

/** @param {'thisweek'|'nextweek'} which @returns {Promise<any[]|null>} null si non publié */
export async function weekFeed(which) {
  const res = await request(`${BASE}/ff_calendar_${which}.json`, {
    timeoutMs: 10_000,
    retries: which === 'thisweek' ? 2 : 0,
    acceptStatus: [404],
    withMeta: true,
  })
  if (res.status === 404) return null
  if (!Array.isArray(res.body)) throw new Error(`faireconomy ${which}: format inattendu`)
  return res.body
}

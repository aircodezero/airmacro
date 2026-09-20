/*
 * Eurostat — IPCH de la zone euro, premières publications (prc_hicp_fpd, ECOICOP v2) :
 * estimation rapide (FLS, fin de mois 11:00 CET) et publication définitive (FIN),
 * glissement annuel de l'indice global et hors énergie, alimentation, alcool et tabac.
 * `updated` date la dernière mise à jour du jeu : l'appelant exige le jour de l'événement.
 */
import { fetchJson } from '../../http.mjs'
import { dayKey } from '../../../../shared/analytics/macrotime.mjs'

const URL_HICP =
  'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_fpd?geo=EA&unit=RCH_A&coicop18=TOTAL&coicop18=TOT_X_NRG_FOOD&lastTimePeriod=4'

/** JSON-stat → { updated (Bruxelles), flash: { total, core }, final: { total, core } } ; séries [{ d, v }]. */
export function parseHicpFirstReleases(json) {
  const dims = json?.id ?? []
  const sizes = json?.size ?? []
  if (!dims.length || dims.length !== sizes.length) throw new Error('eurostat: réponse JSON-stat inattendue')
  const keysOf = (dim) => {
    const index = json.dimension?.[dim]?.category?.index ?? {}
    return Object.fromEntries(Object.entries(index).map(([k, i]) => [i, k]))
  }
  const labels = Object.fromEntries(dims.map((d) => [d, keysOf(d)]))
  const strides = []
  let stride = 1
  for (let i = dims.length - 1; i >= 0; i--) {
    strides[i] = stride
    stride *= sizes[i]
  }
  const out = { flash: { total: [], core: [] }, final: { total: [], core: [] } }
  for (const [pos, value] of Object.entries(json.value ?? {})) {
    let rest = Number(pos)
    const at = {}
    dims.forEach((d, i) => {
      at[d] = labels[d][Math.floor(rest / strides[i])]
      rest %= strides[i]
    })
    const stage = at.release === 'FLS' ? 'flash' : at.release === 'FIN' ? 'final' : null
    const scope = at.coicop18 === 'TOTAL' ? 'total' : at.coicop18 === 'TOT_X_NRG_FOOD' ? 'core' : null
    if (!stage || !scope || !/^\d{4}-\d{2}$/.test(at.time ?? '') || !Number.isFinite(value)) continue
    out[stage][scope].push({ d: `${at.time}-01`, v: value })
  }
  for (const stage of Object.values(out)) for (const rows of Object.values(stage)) rows.sort((a, b) => (a.d < b.d ? -1 : 1))
  const updated = Date.parse(json.updated ?? '')
  if (!Number.isFinite(updated)) throw new Error('eurostat: date de mise à jour absente')
  return { updated: dayKey(updated, 'Europe/Brussels'), ...out }
}

export async function hicpFirstReleases() {
  return parseHicpFirstReleases(await fetchJson(URL_HICP, { timeoutMs: 15_000 }))
}

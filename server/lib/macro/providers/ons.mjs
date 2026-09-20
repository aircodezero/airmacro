/*
 * Office for National Statistics (Royaume-Uni) — séries chronologiques JSON publiques
 * (/…/timeseries/<cdid>/<dataset>/data), mises à jour à 07:00 heure de Londres le
 * jour de publication. `releaseDate` date la dernière mise à jour du jeu de données :
 * l'appelant ne retient une valeur que si elle date du jour de l'événement.
 */
import { fetchJson } from '../../http.mjs'
import { dayKey } from '../../../../shared/analytics/macrotime.mjs'

/** Séries lues pour les publications britanniques suivies par le calendrier. */
export const ONS_SERIES = {
  cpiYoY: '/economy/inflationandpriceindices/timeseries/d7g7/mm23', // IPC, glissement annuel
  coreCpiYoY: '/economy/inflationandpriceindices/timeseries/dko8/mm23', // IPC hors énergie, alimentation, alcool, tabac
  cpiMoM: '/economy/inflationandpriceindices/timeseries/d7oe/mm23',
  claimants: '/employmentandlabourmarket/peoplenotinwork/outofworkbenefits/timeseries/bcjd/unem', // demandeurs, milliers, CVS
  earnings3m: '/employmentandlabourmarket/peopleinwork/earningsandworkinghours/timeseries/kac3/lms', // AWE total, 3 mois, a/a
  unemployment: '/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms',
  gdpMoM: '/economy/grossdomesticproductgdp/timeseries/ecyx/mgdp',
  gdpQoQFirst: '/economy/grossdomesticproductgdp/timeseries/ihyq/pn2', // première estimation trimestrielle
  gdpQoQ: '/economy/grossdomesticproductgdp/timeseries/ihyq/qna', // comptes trimestriels
  retailMoM: '/businessindustryandtrade/retailindustry/timeseries/j5ec/drsi', // volumes, carburant compris
  coreRetailMoM: '/businessindustryandtrade/retailindustry/timeseries/j45w/drsi', // volumes hors carburant
}

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }
const KEEP = 36

/** Période ONS (« 2026 AUG », « 2026 Q2 ») → 'YYYY-MM-01' (premier mois du trimestre). */
export function onsPeriod(label) {
  const m = /^(\d{4})\s+([A-Z]{3}|Q[1-4])$/.exec(String(label ?? '').trim().toUpperCase())
  if (!m) return null
  const month = m[2].startsWith('Q') ? (Number(m[2][1]) - 1) * 3 + 1 : MONTHS[m[2]]
  return month ? `${m[1]}-${String(month).padStart(2, '0')}-01` : null
}

/** JSON d'une série → { title, releaseDate (Londres), rows } ; mensuel si disponible, sinon trimestriel. */
export function parseOnsSeries(json) {
  const pickRows = (list) =>
    (list ?? [])
      // valeur vide (période annoncée, pas encore publiée) : Number('') vaudrait 0
      .filter((o) => String(o?.value ?? '').trim() !== '')
      .map((o) => ({ d: onsPeriod(o.date), v: Number(o.value) }))
      .filter((r) => r.d && Number.isFinite(r.v))
  const monthly = pickRows(json?.months)
  const rows = (monthly.length ? monthly : pickRows(json?.quarters)).sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-KEEP)
  const released = Date.parse(json?.description?.releaseDate ?? '')
  if (!rows.length || !Number.isFinite(released)) throw new Error('ons: série vide ou sans date de publication')
  return {
    title: String(json.description?.title ?? '').slice(0, 160),
    releaseDate: dayKey(released, 'Europe/London'),
    rows,
  }
}

export async function onsSeries(key) {
  const path = ONS_SERIES[key]
  if (!path) throw new Error(`ons: série inconnue ${key}`)
  return parseOnsSeries(await fetchJson(`https://www.ons.gov.uk${path}/data`, { timeoutMs: 15_000 }))
}

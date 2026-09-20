/*
 * Transformations pures des séries macro (AirMacro).
 * Convention : une série est un tableau trié de points { d: 'YYYY-MM-DD', v: number }.
 * Mensuel → d = premier jour du mois ; trimestriel → premier jour du trimestre.
 */

const round = (value, digits) => {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** 'YYYY-MM-DD' décalé de `months` mois (jour conservé à 01 pour les séries mensuelles). */
export function shiftMonth(d, months) {
  const y = Number(d.slice(0, 4))
  const m = Number(d.slice(5, 7)) - 1 + months
  const year = y + Math.floor(m / 12)
  const month = ((m % 12) + 12) % 12
  return `${year}-${String(month + 1).padStart(2, '0')}-${d.slice(8, 10) || '01'}`
}

/** Clé de période mensuelle 'YYYY-MM' pour un point ou une date ISO. */
export const monthKey = (d) => d.slice(0, 7)

/**
 * Variation sur un an (en %) appariée par date : v(t) / v(t − lag mois) − 1.
 * Les trous dans la série ne décalent jamais l'appariement.
 */
export function yoy(rows, lagMonths = 12, digits = 1) {
  const byMonth = new Map(rows.map((r) => [monthKey(r.d), r.v]))
  const out = []
  for (const r of rows) {
    const base = byMonth.get(monthKey(shiftMonth(r.d, -lagMonths)))
    if (Number.isFinite(base) && base !== 0 && Number.isFinite(r.v)) {
      out.push({ d: r.d, v: round((r.v / base - 1) * 100, digits) })
    }
  }
  return out
}

/** Variation mensuelle en % entre mois consécutifs (m/m). */
export function momPct(rows, digits = 1) {
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]
    const cur = rows[i]
    if (shiftMonth(prev.d, 1).slice(0, 7) !== monthKey(cur.d)) continue
    if (!Number.isFinite(prev.v) || prev.v === 0 || !Number.isFinite(cur.v)) continue
    out.push({ d: cur.d, v: round((cur.v / prev.v - 1) * 100, digits) })
  }
  return out
}

/** Différence mensuelle en niveau entre mois consécutifs (ex. créations d'emplois). */
export function momDiff(rows, digits = 0) {
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]
    const cur = rows[i]
    if (shiftMonth(prev.d, 1).slice(0, 7) !== monthKey(cur.d)) continue
    if (!Number.isFinite(prev.v) || !Number.isFinite(cur.v)) continue
    out.push({ d: cur.d, v: round(cur.v - prev.v, digits) })
  }
  return out
}

/** Écart a − b apparié par date exacte (ex. 10Y − 3M). */
export function spread(a, b, digits = 2) {
  const byDate = new Map(b.map((r) => [r.d, r.v]))
  const out = []
  for (const r of a) {
    const other = byDate.get(r.d)
    if (Number.isFinite(other) && Number.isFinite(r.v)) out.push({ d: r.d, v: round(r.v - other, digits) })
  }
  return out
}

/** Points où la valeur change (série en escalier), dernier point toujours conservé. */
export function changePoints(rows) {
  const out = []
  for (let i = 0; i < rows.length; i++) {
    if (i === 0 || rows[i].v !== rows[i - 1].v || i === rows.length - 1) out.push(rows[i])
  }
  return out
}

/** Garde les points depuis `fromDate` inclus. */
export const since = (rows, fromDate) => rows.filter((r) => r.d >= fromDate)

/**
 * Sous-échantillonnage pour sparklines : conserve au plus `max` points
 * régulièrement espacés, le dernier point toujours inclus.
 */
export function decimate(rows, max) {
  if (rows.length <= max) return rows
  const step = (rows.length - 1) / (max - 1)
  const out = []
  for (let i = 0; i < max; i++) out.push(rows[Math.round(i * step)])
  return out
}

/** Dernier point et variation vs le point précédent. */
export function lastWithDelta(rows, digits = 2) {
  if (!rows?.length) return null
  const last = rows[rows.length - 1]
  const prev = rows.length > 1 ? rows[rows.length - 2] : null
  return {
    d: last.d,
    v: last.v,
    prevD: prev?.d ?? null,
    prevV: prev?.v ?? null,
    delta: prev ? round(last.v - prev.v, digits) : null,
  }
}

/** Valeur à la date la plus proche ≤ target (séries quotidiennes). */
export function valueAsOf(rows, target) {
  let found = null
  for (const r of rows) {
    if (r.d <= target) found = r
    else break
  }
  return found
}

/** Variation en % entre le dernier point et celui ≤ (dernière date − jours). */
export function pctChangeOverDays(rows, days, digits = 2) {
  if (!rows?.length) return null
  const last = rows[rows.length - 1]
  const target = new Date(Date.parse(`${last.d}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
  const base = valueAsOf(rows, target)
  if (!base || !Number.isFinite(base.v) || base.v === 0) return null
  return round((last.v / base.v - 1) * 100, digits)
}

/**
 * Réplique du Dollar Index (formule ICE) à partir de cours X/EUR (unités de X
 * pour 1 EUR, ex. taux de référence BCE). Renvoie null si une devise manque.
 */
export function dxyFromEurCrosses({ USD, JPY, GBP, CAD, SEK, CHF }) {
  const vals = [USD, JPY, GBP, CAD, SEK, CHF]
  if (!vals.every((v) => Number.isFinite(v) && v > 0)) return null
  const eurusd = USD
  const usdjpy = JPY / USD
  const gbpusd = USD / GBP
  const usdcad = CAD / USD
  const usdsek = SEK / USD
  const usdchf = CHF / USD
  return (
    50.14348112 *
    eurusd ** -0.576 *
    usdjpy ** 0.136 *
    gbpusd ** -0.119 *
    usdcad ** 0.091 *
    usdsek ** 0.042 *
    usdchf ** 0.036
  )
}

/** Fraction décimale d'une écriture Fed : '3-1/2' → 3.5, '4' → 4, '1/4' → 0.25. */
export function parseFedFraction(text) {
  const t = String(text).trim()
  const m = /^(?:(\d+)(?:-(\d+)\/(\d+))?|(\d+)\/(\d+))$/.exec(t)
  if (!m) return null
  if (m[4] != null) return Number(m[4]) / Number(m[5])
  const whole = Number(m[1])
  return m[2] != null ? whole + Number(m[2]) / Number(m[3]) : whole
}

/**
 * Extrait la décision de taux d'un communiqué FOMC (texte brut).
 * « decided to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent »
 * « decided to raise the target range … by 1/4 percentage point to 3-3/4 to 4 percent »
 */
export function parseFomcDecision(text) {
  const clean = String(text).replace(/\s+/g, ' ')
  const re =
    /decided to (maintain|raise|lower|increase|reduce|decrease) the target range for the federal funds rate(?: by ([\d/-]+) (?:percentage )?points?)? (?:at|to) ([\d/-]+) to ([\d/-]+) percent/i
  const m = re.exec(clean)
  if (!m) return null
  const lower = parseFedFraction(m[3])
  const upper = parseFedFraction(m[4])
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper < lower) return null
  const verb = m[1].toLowerCase()
  const action = verb === 'maintain' ? 'hold' : ['raise', 'increase'].includes(verb) ? 'hike' : 'cut'
  const change = m[2] != null ? parseFedFraction(m[2]) : 0
  const vote = /by an? (\d+)\s*[–-]\s*(\d+) vote/i.exec(clean)
  return {
    action,
    lower,
    upper,
    changePts: action === 'cut' ? -(change ?? 0) : (change ?? 0),
    vote: vote ? { for: Number(vote[1]), against: Number(vote[2]) } : null,
  }
}

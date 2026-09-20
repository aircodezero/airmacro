/*
 * Temps & échéances AirMacro (pur, partagé serveur/client) :
 * conversions de fuseaux via Intl, fenêtre de semaine, prochain événement,
 * compte à rebours.
 */

const dtfCache = new Map()

function partsFormatter(timeZone) {
  let dtf = dtfCache.get(timeZone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    dtfCache.set(timeZone, dtf)
  }
  return dtf
}

/** Composantes calendaires d'un instant dans un fuseau donné. */
export function zonedParts(ts, timeZone) {
  const parts = {}
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ts))) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  }
}

/** Décalage (minutes) du fuseau par rapport à UTC à l'instant `ts` (Paris été → +120). */
export function tzOffsetMinutes(ts, timeZone) {
  const p = zonedParts(ts, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(ts / 1000) * 1000) / 60_000)
}

/** Heure murale d'un fuseau → instant UTC (ms). Gère les changements d'heure. */
export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const first = tzOffsetMinutes(guess, timeZone)
  let ts = guess - first * 60_000
  const second = tzOffsetMinutes(ts, timeZone)
  if (second !== first) ts = guess - second * 60_000
  return ts
}

/** « UTC+2 », « UTC−4 », « UTC+5:30 », « UTC » pour un fuseau à un instant. */
export function formatUtcOffset(offsetMinutes) {
  if (offsetMinutes === 0) return 'UTC'
  const sign = offsetMinutes > 0 ? '+' : '−'
  const abs = Math.abs(offsetMinutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

/** Clé de jour 'YYYY-MM-DD' d'un instant dans un fuseau. */
export function dayKey(ts, timeZone) {
  const p = zonedParts(ts, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/**
 * Début de la semaine de calendrier (dimanche 00:00, heure de New York —
 * convention du flux FairEconomy) contenant `now`.
 */
export function calendarWeekStart(now, timeZone = 'America/New_York') {
  const p = zonedParts(now, timeZone)
  const back = WEEKDAY_INDEX[p.weekday] ?? 0
  const noonUtc = Date.UTC(p.year, p.month - 1, p.day, 12) - back * 86_400_000
  const sunday = new Date(noonUtc)
  return zonedTimeToUtc(
    { year: sunday.getUTCFullYear(), month: sunday.getUTCMonth() + 1, day: sunday.getUTCDate() },
    timeZone,
  )
}

/** Parse défensif d'une date de flux (ISO avec décalage). null si invalide. */
export function parseFeedDate(value) {
  if (typeof value !== 'string' || !value) return null
  const trimmed = value.trim()
  // décalage obligatoire : une heure murale sans fuseau serait ambiguë
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) return null
  const ts = Date.parse(trimmed)
  return Number.isFinite(ts) ? ts : null
}

/** Catégories publiables (un « actual » est possible). */
export const RELEASE_CATEGORIES = new Set(['decision', 'data'])

const isMajor = (e) => e.impact === 'High' && !e.allDay

/** Prochain événement majeur strictement futur (tri par heure). */
export function nextMajorEvent(events, now, predicate = isMajor) {
  let best = null
  for (const e of events) {
    if (e.ts > now && predicate(e) && (!best || e.ts < best.ts)) best = e
  }
  return best
}

/**
 * Sélection du héro : `current` = publication majeure des `holdMs` dernières
 * minutes (pour afficher le résultat), `next` = prochain événement majeur.
 */
export function pickHero(events, now, holdMs = 2 * 3_600_000) {
  let current = null
  for (const e of events) {
    if (!isMajor(e) || !RELEASE_CATEGORIES.has(e.category)) continue
    if (e.ts <= now && now - e.ts <= holdMs && (!current || e.ts > current.ts)) current = e
  }
  return { current, next: nextMajorEvent(events, now) }
}

/** Composantes d'un compte à rebours (arrondi à la minute inférieure). */
export function countdownParts(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
    totalMinutes,
  }
}

/**
 * « 5h 07m », « 42m », « 2d 04h », « <1m », « now ».
 * `withSeconds` : sous l'heure, précision à la seconde (« 9m 05s », « 42s »).
 */
export function formatCountdown(ms, withSeconds = false) {
  if (ms <= 0) return 'now'
  if (withSeconds && ms < 3_600_000) {
    const total = Math.floor(ms / 1000)
    const m = Math.floor(total / 60)
    const s = total % 60
    return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
  }
  if (ms < 60_000) return '<1m'
  const { days, hours, minutes, totalMinutes } = countdownParts(ms)
  if (totalMinutes < 60) return `${minutes}m`
  if (totalMinutes < 48 * 60) return `${hours + days * 24}h ${String(minutes).padStart(2, '0')}m`
  return `${days}d ${String(hours).padStart(2, '0')}h`
}

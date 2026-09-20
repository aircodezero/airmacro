/*
 * Département du Travail US — communiqué hebdomadaire « Unemployment Insurance
 * Weekly Claims » (jeudi 8:30 ET, publié uniquement en PDF) : chiffre « advance »
 * des inscriptions initiales, désaisonnalisé. data.pdf est toujours le dernier
 * communiqué : la date de publication imprimée en tête est vérifiée par l'appelant.
 */
import { fetchBuffer } from '../../http.mjs'
import { compact, pdfText } from '../pdftext.mjs'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthIndex = (name) => MONTHS.findIndex((m) => m.toLowerCase() === String(name).toLowerCase()) + 1
const pad = (n) => String(n).padStart(2, '0')
const toNumber = (text) => Number(String(text).replace(/,/g, ''))

/**
 * Texte du communiqué → { releaseDate, weekEnding, initialClaims, previousLevel } (dates ISO), ou null.
 * Compare un texte compacté : les PDF coupent les mots au gré des lignes.
 */
export function parseClaimsRelease(text) {
  const flat = compact(text)
  const released = /(?:Monday|Tuesday|Wednesday|Thursday|Friday),([A-Za-z]+)(\d{1,2}),(\d{4})/.exec(flat)
  const head =
    /weekending([A-Za-z]+)(\d{1,2}),theadvancefigureforseasonallyadjustedinitialclaimswas([\d,]+),an?(?:increase|decrease)of[\d,]+fromthepreviousweek['’]s(?:revised|unrevised)levelof([\d,]+)/i.exec(flat) ??
    /weekending([A-Za-z]+)(\d{1,2}),theadvancefigureforseasonallyadjustedinitialclaimswas([\d,]+)/i.exec(flat)
  if (!released || !head) return null
  const relMonth = monthIndex(released[1])
  const weekMonth = monthIndex(head[1])
  if (!relMonth || !weekMonth) return null
  const year = Number(released[3])
  // semaine achevée en décembre, communiqué publié en janvier
  const weekYear = weekMonth > relMonth ? year - 1 : year
  const initialClaims = toNumber(head[3])
  if (!Number.isFinite(initialClaims) || initialClaims <= 0) return null
  return {
    releaseDate: `${year}-${pad(relMonth)}-${pad(Number(released[2]))}`,
    weekEnding: `${weekYear}-${pad(weekMonth)}-${pad(Number(head[2]))}`,
    initialClaims,
    previousLevel: head[4] ? toNumber(head[4]) : null,
  }
}

export async function latestClaimsRelease() {
  const pdf = await fetchBuffer('https://www.dol.gov/ui/data.pdf', { timeoutMs: 25_000, retries: 1 })
  const release = parseClaimsRelease(pdfText(pdf, { maxPages: 3 }))
  if (!release) throw new Error('dol: phrase-titre introuvable dans le communiqué')
  return release
}

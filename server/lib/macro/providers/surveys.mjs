/*
 * Enquêtes de confiance publiées par leur producteur (pas de série ouverte en temps réel) :
 *   - Université du Michigan (Surveys of Consumers) : page d'accueil, résultats
 *     préliminaires puis définitifs du mois (10:00 ET) ;
 *   - Conference Board : page « Consumer Confidence », communiqué du mois (10:00 ET).
 * Chaque lecture renvoie le mois de référence : l'appelant vérifie qu'il correspond à l'événement.
 */
import { fetchText } from '../../http.mjs'
import { htmlToText } from './fedpress.mjs'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_RE = MONTHS.join('|')
const monthOf = (name, year) => `${year}-${String(MONTHS.indexOf(name) + 1).padStart(2, '0')}-01`

/**
 * Page d'accueil Michigan → { stage: 'preliminary'|'final', month, sentiment, inflation1y } ou null.
 * « Preliminary Results for September 2026 … Index of Consumer Sentiment 47.8 51.7 55.1 … »
 */
export function parseMichigan(text) {
  const flat = String(text).replace(/\s+/g, ' ')
  const head = new RegExp(`(Preliminary|Final) Results for (${MONTH_RE}) (\\d{4})`, 'i').exec(flat)
  const ics = /Index of Consumer Sentiment (\d+(?:\.\d+)?)\b/.exec(flat)
  if (!head || !ics) return null
  const month = MONTHS.find((m) => m.toLowerCase() === head[2].toLowerCase())
  // Anticipations d'inflation à un an : phrase du commentaire (« …from 4.0% last month to 4.6% this month »)
  const sentence = /Year-ahead inflation expectations([^.]*(?:\.\d[^.]*)*)\./i.exec(flat)?.[1] ?? ''
  const infl =
    /\bto (\d+(?:\.\d+)?)% this month/i.exec(sentence) ??
    /\b(?:unchanged|steady|stable) at (\d+(?:\.\d+)?)%/i.exec(sentence) ??
    /\b(?:to|at) (\d+(?:\.\d+)?)%/i.exec(sentence)
  return {
    stage: head[1].toLowerCase() === 'final' ? 'final' : 'preliminary',
    month: monthOf(month, head[3]),
    sentiment: Number(ics[1]),
    inflation1y: infl ? Number(infl[1]) : null,
  }
}

/**
 * Page Conference Board → { month, index } ou null.
 * « The Conference Board Consumer Confidence Index® decreased by 0.8 points to 89.4 (1985=100) in August »
 */
export function parseConferenceBoard(text, year) {
  const flat = String(text).replace(/\s+/g, ' ')
  const base = flat.indexOf('(1985=100)')
  if (base < 0) return null
  const start = flat.lastIndexOf('Consumer Confidence Index', base)
  if (start < 0 || base - start > 300) return null
  // phrase du chiffre : le mois de référence est le premier cité (« …in August, down from 90.2 in July »)
  const end = flat.slice(base).search(/\.\s+[A-Z“"]/)
  const sentence = flat.slice(start, end < 0 ? base + 200 : base + end)
  const value = /(\d+(?:\.\d+)?)\s?\(1985=100\)/.exec(sentence)
  const month = new RegExp(`\\b(${MONTH_RE})\\b`).exec(sentence)
  if (!value || !month) return null
  return { month: monthOf(month[1], year), index: Number(value[1]) }
}

export async function michiganLatest() {
  const parsed = parseMichigan(htmlToText(await fetchText('https://www.sca.isr.umich.edu/', { timeoutMs: 15_000 })))
  if (!parsed) throw new Error('umich: résultats introuvables sur la page')
  return parsed
}

export async function conferenceBoardLatest(year) {
  const html = await fetchText('https://www.conference-board.org/topics/consumer-confidence', { timeoutMs: 20_000 })
  const parsed = parseConferenceBoard(htmlToText(html), year)
  if (!parsed) throw new Error('conference board: indice introuvable sur la page')
  return parsed
}

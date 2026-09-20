/* Utilitaires CSV minimalistes (guillemets, séparateurs de milliers, dates US). */

/** Découpe une ligne CSV en respectant les champs entre guillemets. */
export function splitCsvLine(line) {
  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out.map((f) => f.trim())
}

/** Nombre depuis un champ CSV (« 22,068 », « . », « » → null). */
export function csvNumber(field) {
  if (field == null) return null
  const cleaned = String(field).replace(/[",\s]/g, '')
  if (cleaned === '' || cleaned === '.' || cleaned === 'NA' || cleaned === 'N/A') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** 'MM/DD/YYYY' → 'YYYY-MM-DD' (null si invalide). */
export function usDateToIso(value) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value).trim())
  if (!m) return null
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/** Parse un CSV avec en-tête → { header: string[], rows: string[][] }. */
export function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lines.length) return { header: [], rows: [] }
  return { header: splitCsvLine(lines[0]), rows: lines.slice(1).map(splitCsvLine) }
}

/** Tri croissant par date et dédoublonnage (dernier gagnant). */
export function sortDedupe(rows) {
  const byDate = new Map()
  for (const r of rows) byDate.set(r.d, r)
  return [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
}

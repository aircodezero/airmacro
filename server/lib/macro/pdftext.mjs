/*
 * Extraction de texte PDF minimale, sans dépendance, pour lire la phrase-titre
 * d'un communiqué officiel publié uniquement en PDF (DOL, Banque du Japon) :
 *   objets directs et flux d'objets (/ObjStm), flux FlateDecode, polices simples
 *   (WinAnsi) et composites (Identity-H) via leur CMap ToUnicode, opérateurs de texte.
 * Ce n'est pas un moteur de rendu : l'ordre suit les flux de contenu et les espaces
 * sont approximatifs — les lecteurs comparent donc un texte compacté (sans blancs).
 */
import { inflateSync, constants as zlibConstants } from 'node:zlib'

/* WinAnsi : 0x80–0x9F diffèrent de Latin-1. */
const WIN_ANSI = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰',
  0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ', 0xa0: ' ',
}

const refOf = (text) => {
  const m = /^\s*(\d+)\s+\d+\s+R/.exec(text ?? '')
  return m ? Number(m[1]) : null
}

/** Valeur brute d'une clé de dictionnaire (référence, nom, nombre, tableau ou dictionnaire). */
export function dictValue(dict, key) {
  const re = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`, 'g')
  const m = re.exec(dict)
  if (!m) return null
  let i = re.lastIndex
  const ch = dict[i]
  const balanced = (open, close) => {
    let depth = 0
    for (let j = i; j < dict.length; j++) {
      if (dict.startsWith(open, j)) {
        depth++
        j += open.length - 1
      } else if (dict.startsWith(close, j)) {
        depth--
        if (depth === 0) return dict.slice(i, j + close.length)
        j += close.length - 1
      }
    }
    return dict.slice(i)
  }
  if (dict.startsWith('<<', i)) return balanced('<<', '>>')
  if (ch === '[') return balanced('[', ']')
  const ref = /^(\d+\s+\d+\s+R)/.exec(dict.slice(i))
  if (ref) return ref[1]
  const token = /^(\/?[^\s/<>[\]()]+)/.exec(dict.slice(i))
  return token ? token[1] : null
}

function decodeStream(dict, raw) {
  if (!raw) return null
  const filter = dictValue(dict, 'Filter') ?? ''
  if (!filter) return raw
  if (!/^\[?\s*\/FlateDecode\s*\]?$/.test(filter)) return null // autres filtres (images) : ignorés
  try {
    return inflateSync(raw)
  } catch {
    try {
      return inflateSync(raw, { finishFlush: zlibConstants.Z_SYNC_FLUSH })
    } catch {
      return null
    }
  }
}

/** Objets du fichier : numéro → { dict, stream }. Les flux d'objets sont dépliés. */
export function parsePdfObjects(buffer) {
  const text = buffer.toString('latin1')
  const objects = new Map()
  const header = /(\d+)\s+(\d+)\s+obj\b/g
  let m
  while ((m = header.exec(text))) {
    const num = Number(m[1])
    const start = header.lastIndex
    const end = text.indexOf('endobj', start)
    if (end < 0) break
    const body = text.slice(start, end)
    const streamAt = /\bstream\r?\n/.exec(body)
    if (streamAt) {
      const dict = body.slice(0, streamAt.index)
      const dataStart = start + streamAt.index + streamAt[0].length
      const declared = dictValue(dict, 'Length')
      let dataEnd = /^\d+$/.test(declared ?? '') ? dataStart + Number(declared) : -1
      // /Length indirecte ou erronée : repli sur le mot-clé « endstream »
      if (dataEnd < 0 || !/^\s*endstream/.test(text.slice(dataEnd, dataEnd + 24))) {
        dataEnd = text.indexOf('endstream', dataStart)
        while (dataEnd > dataStart && (text[dataEnd - 1] === '\n' || text[dataEnd - 1] === '\r')) dataEnd--
      }
      objects.set(num, { dict, stream: buffer.subarray(dataStart, dataEnd) })
    } else {
      objects.set(num, { dict: body, stream: null })
    }
    header.lastIndex = end + 6
  }
  // Flux d'objets : les objets compressés n'écrasent pas un objet direct plus récent
  for (const obj of [...objects.values()]) {
    if (!obj.stream || !/\/Type\s*\/ObjStm/.test(obj.dict)) continue
    const data = decodeStream(obj.dict, obj.stream)
    const n = Number(dictValue(obj.dict, 'N'))
    const first = Number(dictValue(obj.dict, 'First'))
    if (!data || !Number.isFinite(n) || !Number.isFinite(first)) continue
    const content = data.toString('latin1')
    const pairs = content.slice(0, first).trim().split(/\s+/).map(Number)
    for (let k = 0; k < n; k++) {
      const num = pairs[2 * k]
      const from = first + pairs[2 * k + 1]
      const to = k + 1 < n ? first + pairs[2 * k + 3] : content.length
      if (!Number.isFinite(num) || objects.has(num)) continue
      objects.set(num, { dict: content.slice(from, to), stream: null })
    }
  }
  return objects
}

/* ---------- CMap ToUnicode ---------- */

const utf16Hex = (hex) => {
  let out = ''
  for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
  if (hex.length === 2) out = String.fromCharCode(parseInt(hex, 16))
  return out
}

/** CMap → { bytes: longueur de code, map: code → texte }. */
export function parseToUnicode(cmap) {
  const map = new Map()
  let bytes = 1
  const text = String(cmap)
  const codespace = /begincodespacerange\s*<([0-9a-f]+)>/i.exec(text)
  if (codespace) bytes = Math.max(1, codespace[1].length / 2)
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, src, dst] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) {
      map.set(parseInt(src, 16), utf16Hex(dst))
      bytes = Math.max(bytes, src.length / 2)
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, dst, list] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(?:<([0-9a-f]*)>|\[([^\]]*)\])/gi)) {
      const from = parseInt(lo, 16)
      const to = parseInt(hi, 16)
      bytes = Math.max(bytes, lo.length / 2)
      if (to - from > 65535) continue
      if (list != null) {
        const items = [...list.matchAll(/<([0-9a-f]*)>/gi)].map((x) => utf16Hex(x[1]))
        items.forEach((s, k) => map.set(from + k, s))
      } else {
        const base = utf16Hex(dst)
        const last = base.charCodeAt(base.length - 1)
        for (let c = from; c <= to; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - from)))
      }
    }
  }
  return { bytes, map }
}

/* ---------- Polices ---------- */

function fontDecoder(objects, fontDict) {
  const toUnicodeRef = refOf(dictValue(fontDict, 'ToUnicode'))
  const composite = /\/Subtype\s*\/Type0/.test(fontDict)
  let cmap = null
  if (toUnicodeRef != null) {
    const obj = objects.get(toUnicodeRef)
    const data = obj?.stream ? decodeStream(obj.dict, obj.stream) : null
    if (data) cmap = parseToUnicode(data.toString('latin1'))
  }
  const bytes = composite ? 2 : (cmap?.bytes ?? 1)
  return (raw) => {
    let out = ''
    for (let i = 0; i + bytes <= raw.length; i += bytes) {
      const code = bytes === 2 ? (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1) : raw.charCodeAt(i)
      const mapped = cmap?.map.get(code)
      if (mapped != null) out += mapped
      else if (!composite) out += WIN_ANSI[code] ?? String.fromCharCode(code)
    }
    return out
  }
}

function resolveDict(objects, value) {
  if (value == null) return null
  const ref = refOf(value)
  return ref != null ? (objects.get(ref)?.dict ?? null) : value
}

/** Polices d'une page (ressources héritées de l'arbre des pages). */
function pageFonts(objects, pageDict) {
  let dict = pageDict
  let resources = null
  for (let depth = 0; depth < 12 && dict && !resources; depth++) {
    resources = resolveDict(objects, dictValue(dict, 'Resources'))
    if (!resources) dict = objects.get(refOf(dictValue(dict, 'Parent')))?.dict ?? null
  }
  const fonts = new Map()
  const fontDict = resolveDict(objects, resources ? dictValue(resources, 'Font') : null)
  if (!fontDict) return fonts
  for (const [, name, num] of fontDict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const font = objects.get(Number(num))?.dict
    if (font) fonts.set(name, fontDecoder(objects, font))
  }
  return fonts
}

/* ---------- Flux de contenu ---------- */

const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'])
const isSpace = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0'

function readLiteral(s, i) {
  let depth = 1
  let out = ''
  for (i++; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      const n = s[++i]
      if (n === 'n') out += '\n'
      else if (n === 'r') out += '\r'
      else if (n === 't') out += '\t'
      else if (n === 'b') out += '\b'
      else if (n === 'f') out += '\f'
      else if (n === '\r' || n === '\n') {
        if (n === '\r' && s[i + 1] === '\n') i++
      } else if (/[0-7]/.test(n)) {
        let oct = n
        while (oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i]
        out += String.fromCharCode(parseInt(oct, 8) & 0xff)
      } else out += n
    } else if (c === '(') {
      depth++
      out += c
    } else if (c === ')') {
      if (--depth === 0) return [out, i + 1]
      out += c
    } else out += c
  }
  return [out, i]
}

/** Texte d'un flux de contenu avec les décodeurs de polices de la page. */
export function contentText(content, fonts) {
  const s = content
  const stack = []
  let decode = (raw) => raw
  let out = ''
  let arrayDepth = 0
  let array = null
  const show = (raw) => {
    out += decode(raw)
  }
  const newline = () => {
    if (!out.endsWith('\n')) out += '\n'
  }
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (isSpace(c)) {
      i++
      continue
    }
    if (c === '%') {
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++
      continue
    }
    let token
    if (c === '(') {
      const [str, next] = readLiteral(s, i)
      token = { str }
      i = next
    } else if (c === '<' && s[i + 1] !== '<') {
      const end = s.indexOf('>', i)
      const hex = s.slice(i + 1, end < 0 ? s.length : end).replace(/\s+/g, '')
      let str = ''
      for (let k = 0; k < hex.length; k += 2) str += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16))
      token = { str }
      i = end < 0 ? s.length : end + 1
    } else if (c === '<' || c === '>') {
      i += s[i + 1] === c ? 2 : 1
      continue
    } else if (c === '[') {
      arrayDepth++
      if (arrayDepth === 1) array = []
      i++
      continue
    } else if (c === ']') {
      arrayDepth = Math.max(0, arrayDepth - 1)
      if (arrayDepth === 0 && array) {
        stack.push({ array })
        array = null
      }
      i++
      continue
    } else if (c === '/') {
      let j = i + 1
      while (j < s.length && !isSpace(s[j]) && !DELIM.has(s[j])) j++
      token = { name: s.slice(i + 1, j) }
      i = j
    } else {
      let j = i
      while (j < s.length && !isSpace(s[j]) && !DELIM.has(s[j])) j++
      if (j === i) j++
      const word = s.slice(i, j)
      i = j
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) token = { num: Number(word) }
      else token = { op: word }
    }

    if (arrayDepth > 0 && array && !token.op) {
      array.push(token)
      continue
    }
    if (!token.op) {
      stack.push(token)
      continue
    }
    const op = token.op
    const args = stack.splice(0)
    if (op === 'BI') {
      // image en ligne : données binaires jusqu'à « EI »
      const end = s.slice(i).search(/\sEI(?=\s|$)/)
      i = end < 0 ? s.length : i + end + 3
    } else if (op === 'Tf') {
      const name = args.find((a) => a.name)?.name
      decode = (name && fonts.get(name)) || ((raw) => raw)
    } else if (op === 'Tj') {
      if (args.at(-1)?.str != null) show(args.at(-1).str)
    } else if (op === "'" || op === '"') {
      newline()
      if (args.at(-1)?.str != null) show(args.at(-1).str)
    } else if (op === 'TJ') {
      for (const item of args.at(-1)?.array ?? []) {
        if (item.str != null) show(item.str)
        else if (item.num != null && item.num < -180) out += ' '
      }
    } else if (op === 'Td' || op === 'TD') {
      const ty = args[1]?.num ?? 0
      if (Math.abs(ty) > 0.01) newline()
      else if ((args[0]?.num ?? 0) > 1) out += ' '
    } else if (op === 'Tm' || op === 'T*' || op === 'ET') {
      newline()
    }
  }
  return out
}

/** Ordre des pages : arbre /Pages depuis le catalogue, sinon ordre des objets. */
function pageOrder(objects) {
  const catalog = [...objects.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict))
  const out = []
  const walk = (num, depth) => {
    const obj = objects.get(num)
    if (!obj || depth > 20) return
    if (/\/Type\s*\/Pages/.test(obj.dict)) {
      for (const [, kid] of (dictValue(obj.dict, 'Kids') ?? '').matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(kid), depth + 1)
    } else if (/\/Type\s*\/Page\b/.test(obj.dict)) out.push(num)
  }
  const root = catalog ? refOf(dictValue(catalog.dict, 'Pages')) : null
  if (root != null) walk(root, 0)
  if (out.length) return out
  return [...objects.entries()].filter(([, o]) => /\/Type\s*\/Page\b/.test(o.dict)).map(([n]) => n)
}

/**
 * Texte d'un PDF (pages dans l'ordre, séparées par un saut de page).
 * @param {Buffer} buffer
 * @param {{ maxPages?: number }} [options]
 */
export function pdfText(buffer, { maxPages = 40 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('pdf: signature absente')
  const objects = parsePdfObjects(buffer)
  const pages = []
  for (const num of pageOrder(objects).slice(0, maxPages)) {
    const page = objects.get(num)
    const fonts = pageFonts(objects, page.dict)
    const contents = dictValue(page.dict, 'Contents') ?? ''
    const refs = [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map((r) => Number(r[1]))
    // /Contents peut désigner un tableau indirect de flux
    const streams = refs.flatMap((ref) => {
      const obj = objects.get(ref)
      if (obj && !obj.stream && /^\s*\[/.test(obj.dict)) return [...obj.dict.matchAll(/(\d+)\s+\d+\s+R/g)].map((r) => objects.get(Number(r[1])))
      return [obj]
    })
    let text = ''
    for (const obj of streams) {
      const data = obj?.stream ? decodeStream(obj.dict, obj.stream) : null
      if (data) text += contentText(data.toString('latin1'), fonts) + '\n'
    }
    pages.push(text)
  }
  return pages.join('\f\n')
}

/** Texte compacté (sans aucun blanc) : robuste aux coupures de mots des PDF. */
export const compact = (text) => String(text).replace(/\s+/g, '')

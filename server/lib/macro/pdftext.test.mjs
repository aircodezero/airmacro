import { describe, it, expect } from 'vitest'
import { deflateSync } from 'node:zlib'
import { compact, contentText, parsePdfObjects, parseToUnicode, pdfText } from './pdftext.mjs'

/*
 * PDF minimal construit en mémoire, fidèle aux communiqués réels (Word → PDF) :
 * police simple WinAnsi, police composite Identity-H + ToUnicode, flux compressés,
 * dictionnaires de polices rangés dans un flux d'objets (/ObjStm).
 */
function buildPdf() {
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '2 beginbfchar <0003> <0020> <0011> <002E> endbfchar',
    '2 beginbfrange <0013> <001C> <0030> <0024> <003D> [<0041> <0042> <0043> <0044> <0045> <0046> <0047> <0048> <0049> <004A>] endbfrange',
    'endcmap end end',
  ].join('\n')
  // « ABC 12.5 » en codes CID : A=0024, B=0025, C=0026, espace=0003, 1=0014, 2=0015, .=0011, 5=0018
  const page = [
    'BT /F1 11 Tf 72 700 Td (In the week ending September 12, the advance figure) Tj',
    '0 -14 Td [(for seasonally adjusted initial claims was 196,0)-20(00, a decrease)] TJ',
    '0 -14 Td (of 10,000 from the previous week\\222s unrevised level of 206,000.) Tj ET',
    'BT /F2 11 Tf 72 600 Td <0024002500260003001400150011001800030003> Tj ET',
  ].join('\n')
  const deflated = (text) => deflateSync(Buffer.from(text, 'latin1'))
  const fontObjs = [
    [5, '<< /Type /Font /Subtype /TrueType /BaseFont /TimesNewRomanPSMT /Encoding /WinAnsiEncoding >>'],
    [6, '<< /Type /Font /Subtype /Type0 /BaseFont /Arial /Encoding /Identity-H /ToUnicode 7 0 R >>'],
  ]
  let header = ''
  let body = ''
  for (const [num, dict] of fontObjs) {
    header += `${num} ${body.length} `
    body += `${dict}\n`
  }
  const objStm = Buffer.from(header + body, 'latin1')
  const parts = []
  const add = (text) => parts.push(Buffer.isBuffer(text) ? text : Buffer.from(text, 'latin1'))
  add('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  add('3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>\nendobj\n')
  const content = deflated(page)
  add(`4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`)
  add(content)
  add('\nendstream\nendobj\n')
  const tu = deflated(cmap)
  add(`7 0 obj\n<< /Length 8 0 R /Filter /FlateDecode >>\nstream\n`) // longueur indirecte : repli sur « endstream »
  add(tu)
  add('\nendstream\nendobj\n')
  add(`8 0 obj\n${tu.length}\nendobj\n`)
  const stm = deflateSync(objStm)
  add(`9 0 obj\n<< /Type /ObjStm /N 2 /First ${header.length} /Length ${stm.length} /Filter /FlateDecode >>\nstream\n`)
  add(stm)
  add('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
  return Buffer.concat(parts)
}

describe('extraction de texte PDF', () => {
  const pdf = buildPdf()

  it('objets directs et objets d’un flux /ObjStm', () => {
    const objects = parsePdfObjects(pdf)
    expect(objects.get(5).dict).toMatch(/WinAnsiEncoding/)
    expect(objects.get(6).dict).toMatch(/Identity-H/)
    expect(objects.get(4).stream.length).toBeGreaterThan(20)
  })

  it('police simple (WinAnsi, TJ, échappements octaux) et police composite via ToUnicode', () => {
    const text = pdfText(pdf)
    const flat = text.replace(/\s+/g, ' ')
    expect(flat).toContain('In the week ending September 12, the advance figure')
    expect(flat).toContain('initial claims was 196,000, a decrease')
    expect(flat).toContain('previous week’s unrevised level of 206,000.')
    expect(flat).toContain('ABC 12.5')
    expect(compact(text)).toContain('theadvancefigureforseasonallyadjustedinitialclaimswas196,000')
  })

  it('CMap : bfchar, bfrange incrémental et tableau', () => {
    const { bytes, map } = parseToUnicode('1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0010> <0012> <0041> endbfrange 1 beginbfrange <0020> <0021> [<0078> <0079>] endbfrange')
    expect(bytes).toBe(2)
    expect([map.get(0x10), map.get(0x12), map.get(0x20), map.get(0x21)]).toEqual(['A', 'C', 'x', 'y'])
  })

  it('opérateurs de texte : guillemet simple, image en ligne ignorée', () => {
    const fonts = new Map()
    expect(contentText("BT (first) Tj (second) ' ET", fonts).split('\n').filter(Boolean)).toEqual(['first', 'second'])
    expect(contentText('BI /W 1 /H 1 ID \x00\xff(fake) EI BT (after) Tj ET', fonts)).toContain('after')
    expect(contentText('BI /W 1 /H 1 ID \x00\xff(fake) EI BT (after) Tj ET', fonts)).not.toContain('fake')
  })

  it('refuse un fichier qui n’est pas un PDF', () => {
    expect(() => pdfText(Buffer.from('<html>Access Denied</html>'))).toThrow(/signature/)
  })
})

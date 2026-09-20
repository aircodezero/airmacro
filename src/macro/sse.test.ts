import { describe, it, expect } from 'vitest'
import { parseSseChunk, readSse } from './sse'

describe('parseSseChunk', () => {
  it('messages complets, commentaires et reste incomplet', () => {
    const { messages, rest } = parseSseChunk(
      ': keep-alive\n\nevent: meta\ndata: {"provider":"static"}\n\nevent: delta\ndata: {"text":"Hel',
    )
    expect(messages).toEqual([{ event: 'meta', data: { provider: 'static' } }])
    expect(rest).toBe('event: delta\ndata: {"text":"Hel')
  })
  it('CRLF et message sans type', () => {
    const { messages } = parseSseChunk('data: {"a":1}\r\n\r\n')
    expect(messages).toEqual([{ event: 'message', data: { a: 1 } }])
  })
})

describe('readSse', () => {
  it('réassemble des paquets coupés au milieu d’un message', async () => {
    const parts = ['event: delta\ndata: {"text":"Hel', 'lo"}\n\nevent: done\n', 'data: {"text":"Hello"}\n\n']
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        for (const p of parts) controller.enqueue(enc.encode(p))
        controller.close()
      },
    })
    const seen = []
    for await (const m of readSse(new Response(body))) seen.push(m)
    expect(seen).toEqual([
      { event: 'delta', data: { text: 'Hello' } },
      { event: 'done', data: { text: 'Hello' } },
    ])
  })
})

/*
 * Lecture d'un flux Server-Sent Events issu d'un POST (EventSource ne gère que GET).
 */

export interface SseMessage {
  event: string
  data: unknown
}

/** Découpe un texte SSE en messages ; renvoie aussi le reste incomplet. */
export function parseSseChunk(buffer: string): { messages: SseMessage[]; rest: string } {
  const messages: SseMessage[] = []
  const normalized = buffer.replace(/\r\n/g, '\n')
  const blocks = normalized.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (!data.length) continue
    try {
      messages.push({ event, data: JSON.parse(data.join('\n')) })
    } catch {
      /* message malformé ignoré */
    }
  }
  return { messages, rest }
}

export async function* readSse(response: Response): AsyncGenerator<SseMessage> {
  if (!response.body) return
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      const { messages, rest } = parseSseChunk(buffer)
      buffer = rest
      for (const message of messages) yield message
    }
    const { messages } = parseSseChunk(`${buffer}\n\n`)
    for (const message of messages) yield message
  } finally {
    reader.releaseLock()
  }
}

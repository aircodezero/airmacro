/*
 * Ollama local (http://127.0.0.1:11434) — unique exception à l'allowlist HTTPS :
 * l'hôte est figé sur la boucle locale. Streaming NDJSON (/api/chat).
 * Sur CPU partagé, la lecture du prompt peut prendre plus d'une minute :
 * délais adaptés (premier fragment, silence, total) et une génération à la fois.
 */

const BASE = 'http://127.0.0.1:11434'
const PREFERRED = /^llama3\.1/i

export const OLLAMA_OPTIONS = { temperature: 0.2, num_ctx: 4096, num_predict: 360 }
const KEEP_ALIVE = '30m'

let statusCache = { at: 0, value: null }

/** État d'Ollama (joignable, modèles, modèle choisi) — mis en cache 30 s. */
export async function ollamaStatus({ force = false } = {}) {
  if (!force && statusCache.value && Date.now() - statusCache.at < 30_000) return statusCache.value
  let value
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const models = (json.models ?? []).map((m) => m.name).filter(Boolean)
    value = { reachable: true, models, model: pickModel(models) }
  } catch (err) {
    value = { reachable: false, models: [], model: null, error: String(err?.message ?? err).slice(0, 80) }
  }
  statusCache = { at: Date.now(), value }
  return value
}

/** Modèle retenu : AIRMACRO_OLLAMA_MODEL s'il est installé, sinon llama3.1*, sinon le premier. */
export function pickModel(models, preferred = process.env.AIRMACRO_OLLAMA_MODEL) {
  if (!models?.length) return null
  if (preferred && models.includes(preferred)) return preferred
  return models.find((m) => PREFERRED.test(m)) ?? models[0]
}

/** Découpe un flux NDJSON en objets (tolère les fragments coupés entre deux paquets). */
export function createNdjsonParser(onObject) {
  let rest = ''
  return {
    push(text) {
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) onObject(JSON.parse(trimmed))
      }
    },
    end() {
      if (rest.trim()) onObject(JSON.parse(rest.trim()))
      rest = ''
    },
  }
}

/* Une seule génération locale à la fois : les demandes suivantes attendent leur tour. */
let queue = Promise.resolve()
let waiting = 0
export const ollamaQueueDepth = () => waiting

function exclusive(task) {
  waiting++
  const run = queue.then(task, task)
  queue = run.then(
    () => {},
    () => {},
  )
  return run.finally(() => {
    waiting--
  })
}

/** Charge le modèle en mémoire (sans génération) pour raccourcir la première réponse. */
export async function ollamaWarm(model) {
  try {
    await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [], keep_alive: KEEP_ALIVE, options: OLLAMA_OPTIONS }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    /* préchargement opportuniste */
  }
}

/**
 * Génère une réponse en flux.
 * @param {{ model: string, system: string, messages: Array<{role: 'user'|'assistant', content: string}>,
 *   onDelta: (text: string) => void, signal?: AbortSignal,
 *   firstTokenMs?: number, idleMs?: number, totalMs?: number }} args
 * @returns {Promise<{ text: string, model: string, promptTokens: number|null, outputTokens: number|null }>}
 */
export function ollamaChat(args) {
  return exclusive(() => runChat(args))
}

async function runChat({ model, system, messages, onDelta, signal, firstTokenMs = 150_000, idleMs = 30_000, totalMs = 300_000 }) {
  const controller = new AbortController()
  const abort = (reason) => controller.abort(new Error(reason))
  if (signal?.aborted) throw new Error('client disconnected')
  signal?.addEventListener('abort', () => abort('client disconnected'), { once: true })
  const total = setTimeout(() => abort(`ollama: total timeout ${Math.round(totalMs / 1000)} s`), totalMs)
  let idle = setTimeout(() => abort(`ollama: no first token after ${Math.round(firstTokenMs / 1000)} s`), firstTokenMs)
  const bump = () => {
    clearTimeout(idle)
    idle = setTimeout(() => abort(`ollama: stalled for ${Math.round(idleMs / 1000)} s`), idleMs)
  }

  let text = ''
  let final = null
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        keep_alive: KEEP_ALIVE,
        options: OLLAMA_OPTIONS,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`ollama: HTTP ${res.status}`)
    const decoder = new TextDecoder()
    const parser = createNdjsonParser((obj) => {
      if (obj.error) throw new Error(`ollama: ${String(obj.error).slice(0, 120)}`)
      const piece = obj.message?.content
      if (piece) {
        bump()
        text += piece
        onDelta(piece)
      }
      if (obj.done) final = obj
    })
    for await (const chunk of res.body) parser.push(decoder.decode(chunk, { stream: true }))
    parser.push(decoder.decode())
    parser.end()
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason
    throw err
  } finally {
    clearTimeout(total)
    clearTimeout(idle)
  }
  if (!text.trim()) throw new Error('ollama: empty answer')
  return {
    text,
    model,
    promptTokens: final?.prompt_eval_count ?? null,
    outputTokens: final?.eval_count ?? null,
  }
}

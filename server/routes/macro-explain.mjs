/*
 * POST /api/macro/explain — explication IA d'un événement ou d'un indicateur,
 * ancrée sur les données servies par AirMacro. Flux SSE (par défaut) ou JSON.
 * Chaîne : Claude (clé en env) → modèle local Ollama → explication statique.
 * GET /api/macro/ai-status — disponibilité des fournisseurs (+ préchargement local).
 * Aucun contenu de question ou de réponse n'est journalisé.
 */
import express from 'express'
import { isOffline } from '../lib/cache.mjs'
import {
  buildGrounding,
  buildSystemPrompt,
  createRateLimiter,
  defaultQuestion,
  explainerFor,
  PROVIDER_LABELS,
  providerChain,
  staticAnswer,
  userTurn,
  validateExplainRequest,
} from '../lib/macro/explain.mjs'
import { anthropicConfigured, claudeChat, CLAUDE_MODEL, describeAnthropicError } from '../lib/llm/anthropic.mjs'
import { ollamaChat, ollamaQueueDepth, ollamaStatus, ollamaWarm } from '../lib/llm/ollama.mjs'

const limiter = createRateLimiter({ limit: 30, windowMs: 3_600_000 })
const CLAUDE_TIMEOUT_MS = 60_000

function resolveSubject(contextType, id, calendar, series) {
  if (contextType === 'event') {
    const event = calendar?.events?.find((e) => e.id === id)
    return event ? { type: 'event', event } : null
  }
  // Object.hasOwn : « constructor », « toString »… ne sont pas des tuiles
  const tiles = series?.tiles
  const tile = tiles && Object.hasOwn(tiles, id) ? tiles[id] : null
  return tile ? { type: 'indicator', tile } : null
}

function openSse(res) {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  return (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}

async function currentStatus() {
  const offline = isOffline()
  const ollama = offline ? null : await ollamaStatus()
  const chain = providerChain({ offline, claude: anthropicConfigured(), ollama })
  return { offline, ollama, chain }
}

export function registerExplainApi(api, { calendarHandler, seriesHandler }) {
  let lastWarm = 0

  api.get('/macro/ai-status', async (req, res) => {
    const { offline, chain } = await currentStatus()
    const primary = chain[0] ?? null
    if (req.query.warm === '1' && primary?.kind === 'ollama' && Date.now() - lastWarm > 5 * 60_000) {
      lastWarm = Date.now()
      ollamaWarm(primary.model) // opportuniste, sans attendre
    }
    res.json({
      available: chain.length > 0,
      offline,
      reason: offline ? 'offline' : chain.length ? null : 'no_backend',
      providers: chain.map(({ id, label, kind }) => ({ id, label, kind })),
      primary: primary ? { id: primary.id, label: primary.label, kind: primary.kind } : null,
      localQueue: ollamaQueueDepth(),
    })
  })

  api.post('/macro/explain', express.json({ limit: '32kb' }), async (req, res) => {
    try {
      await explainHandler(req, res)
    } catch (err) {
      console.error('[explain] failure:', String(err?.message ?? err).slice(0, 160))
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' })
      else if (!res.writableEnded) res.end()
    }
  })

  async function explainHandler(req, res) {
    const started = Date.now()
    // annulation posée avant toute attente : une fiche fermée pendant le chargement
    // des données ne lance jamais de génération
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) controller.abort()
    })
    const parsed = validateExplainRequest(req.body)
    if (!parsed.ok) {
      res.status(400).json({ error: 'invalid_request', detail: parsed.error })
      return
    }
    const { contextType, id, question, history, stream } = parsed.value
    const [cal, ser] = await Promise.all([calendarHandler().catch(() => null), seriesHandler().catch(() => null)])
    const subject = resolveSubject(contextType, id, cal?.data, ser?.data)
    if (!subject) {
      res.status(404).json({ error: 'unknown_subject' })
      return
    }

    const now = Date.now()
    const grounding = buildGrounding(subject, { calendar: cal?.data, series: ser?.data, now })
    const explainer = explainerFor(subject)
    const groundingSummary = { title: grounding.title, facts: grounding.facts.map(({ label, value, period, source }) => ({ label, value, period, source })) }
    const { offline, chain } = await currentStatus()
    let notice = offline ? 'offline' : chain.length ? null : 'no_backend'
    const providers = chain

    if (providers.length) {
      const verdict = limiter.take(req.ip ?? req.socket.remoteAddress ?? 'unknown', now)
      if (!verdict.ok) {
        const retryAfterSec = Math.ceil(verdict.retryAfterMs / 1000)
        res.setHeader('Retry-After', String(retryAfterSec))
        res.status(429).json({
          error: 'rate_limited',
          retryAfterSec,
          provider: 'static',
          label: PROVIDER_LABELS.static,
          text: staticAnswer(explainer, grounding.facts, { question, notice: 'rate_limited' }),
          notice: 'rate_limited',
          grounding: groundingSummary,
        })
        return
      }
    }

    if (controller.signal.aborted) return
    const wantsStream = stream && req.get('accept')?.includes('text/event-stream')
    const send = wantsStream ? openSse(res) : () => {}

    const system = buildSystemPrompt(grounding)
    const asked = userTurn(question ?? defaultQuestion(subject), grounding)
    const messages = [...history, { role: 'user', content: asked }]
    const errors = []
    let phase = 'waiting'
    let current = null
    const heartbeat = wantsStream
      ? setInterval(() => send('status', { phase, provider: current?.id ?? null, elapsedMs: Date.now() - started, queue: ollamaQueueDepth() }), 5000)
      : null

    try {
      for (const provider of providers) {
        current = provider
        phase = 'waiting'
        let streamed = false
        send('status', { phase, provider: provider.id, label: provider.label, elapsedMs: Date.now() - started, queue: ollamaQueueDepth() })
        const onDelta = (text) => {
          if (!streamed) {
            streamed = true
            phase = 'streaming'
            send('meta', { provider: provider.id, label: provider.label })
          }
          send('delta', { text })
        }
        const attemptStarted = Date.now()
        try {
          let result
          if (provider.kind === 'claude') {
            const timeout = AbortSignal.timeout(CLAUDE_TIMEOUT_MS)
            result = await claudeChat({
              system,
              messages,
              onDelta,
              onFallback: (model) => send('status', { phase, provider: provider.id, fallbackModel: model, elapsedMs: Date.now() - started }),
              signal: AbortSignal.any([controller.signal, timeout]),
            })
          } else {
            result = await ollamaChat({ model: provider.model, system, messages, onDelta, signal: controller.signal })
          }
          const payload = {
            provider: provider.kind === 'claude' ? 'claude' : provider.id,
            label: provider.kind === 'claude' && result.model !== CLAUDE_MODEL ? `Claude (${result.model})` : provider.label,
            model: result.model,
            question: asked,
            text: result.text,
            grounding: groundingSummary,
            durationMs: Date.now() - started,
          }
          console.log(
            `[explain] ${grounding.key} provider=${payload.provider} ok ${Date.now() - attemptStarted}ms in=${result.promptTokens ?? '?'} out=${result.outputTokens ?? '?'}`,
          )
          if (wantsStream) send('done', payload)
          else res.json(payload)
          return
        } catch (err) {
          if (controller.signal.aborted) {
            console.log(`[explain] ${grounding.key} provider=${provider.id} aborted by client after ${Date.now() - attemptStarted}ms`)
            return
          }
          const reason = provider.kind === 'claude' ? describeAnthropicError(err) : String(err?.message ?? err).slice(0, 120)
          errors.push(reason)
          console.warn(`[explain] ${grounding.key} provider=${provider.id} failed after ${Date.now() - attemptStarted}ms: ${reason}`)
          if (streamed) send('reset', { provider: provider.id, reason: 'The answer was interrupted; switching to the next source.' })
        }
      }

      if (errors.length) notice = 'providers_failed'
      const text = staticAnswer(explainer, grounding.facts, { question, notice })
      const payload = {
        provider: 'static',
        label: PROVIDER_LABELS.static,
        model: null,
        question: asked,
        text,
        notice,
        grounding: groundingSummary,
        durationMs: Date.now() - started,
      }
      console.log(`[explain] ${grounding.key} provider=static notice=${notice ?? 'none'}`)
      if (wantsStream) {
        send('meta', { provider: 'static', label: PROVIDER_LABELS.static })
        send('delta', { text })
        send('done', payload)
      } else {
        res.json(payload)
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      if (wantsStream && !res.writableEnded) res.end()
    }
  }

  // corps JSON invalide ou trop gros : réponse JSON (pas de page d'erreur HTML)
  api.use('/macro/explain', (err, _req, res, next) => {
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      res.status(err.status ?? 400).json({ error: 'invalid_request', detail: err.type === 'entity.too.large' ? 'body too large' : 'invalid JSON' })
      return
    }
    next(err)
  })
}

/** État IA pour /api/health (présence de clé uniquement, jamais sa valeur). */
export async function llmHealth() {
  const offline = isOffline()
  const ollama = await ollamaStatus()
  return {
    offlineStaticOnly: offline,
    ollama: { reachable: ollama.reachable, model: ollama.model, models: ollama.models, error: ollama.error ?? null },
    anthropic: { keyPresent: anthropicConfigured(), model: CLAUDE_MODEL },
    chain: providerChain({ offline, claude: anthropicConfigured(), ollama }).map((p) => p.id).concat('static'),
  }
}

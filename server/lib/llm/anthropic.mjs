/*
 * Claude (API Anthropic) via le SDK officiel — activé seulement si une clé est
 * présente dans l'environnement du serveur (jamais exposée au client, jamais
 * journalisée). Modèle claude-opus-5, streaming, effort bas (réponse courte),
 * replis serveur `fallbacks: "default"` en cas de refus des classifieurs.
 */
import Anthropic from '@anthropic-ai/sdk'

export const CLAUDE_MODEL = 'claude-opus-5'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export const anthropicConfigured = () =>
  Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim())

let client = null
const getClient = () => {
  // le SDK lit ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN lui-même
  client ??= new Anthropic({ timeout: 60_000, maxRetries: 1 })
  return client
}

export class ClaudeRefusal extends Error {
  constructor(category) {
    super(`claude: request declined${category ? ` (${category})` : ''}`)
    this.name = 'ClaudeRefusal'
  }
}

/** Message d'erreur sûr (jamais la clé, jamais le corps de la requête). */
export function describeAnthropicError(err) {
  if (err instanceof ClaudeRefusal) return err.message
  if (err instanceof Anthropic.AuthenticationError) return 'claude: authentication failed'
  if (err instanceof Anthropic.PermissionDeniedError) return 'claude: permission denied'
  if (err instanceof Anthropic.NotFoundError) return 'claude: model not available'
  if (err instanceof Anthropic.RateLimitError) return 'claude: rate limited'
  if (err instanceof Anthropic.APIUserAbortError) return 'claude: aborted (timeout)'
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'claude: timeout'
  if (err instanceof Anthropic.APIConnectionError) return 'claude: connection failed'
  if (err instanceof Anthropic.APIError) return `claude: API error ${err.status ?? ''}`.trim()
  return `claude: ${String(err?.message ?? err).slice(0, 80)}`
}

/**
 * @param {{ system: string, messages: Array<{role: 'user'|'assistant', content: string}>,
 *   onDelta: (text: string) => void, onFallback?: (model: string) => void, signal?: AbortSignal }} args
 * @returns {Promise<{ text: string, model: string, promptTokens: number|null, outputTokens: number|null }>}
 */
export async function claudeChat({ system, messages, onDelta, onFallback, signal }) {
  const stream = getClient().beta.messages.stream(
    {
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system,
      messages,
    },
    { signal },
  )
  let text = ''
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
      onDelta(event.delta.text)
    } else if (event.type === 'content_block_start' && event.content_block.type === 'fallback') {
      // un autre modèle reprend la réponse (le texte déjà reçu reste valide)
      onFallback?.(event.content_block.to?.model ?? 'fallback model')
    }
  }
  const final = await stream.finalMessage()
  if (final.stop_reason === 'refusal') throw new ClaudeRefusal(final.stop_details?.category ?? null)
  if (!text.trim()) throw new Error('claude: empty answer')
  return {
    text,
    model: final.model ?? CLAUDE_MODEL,
    promptTokens: final.usage?.input_tokens ?? null,
    outputTokens: final.usage?.output_tokens ?? null,
  }
}

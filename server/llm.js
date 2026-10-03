// Thin wrapper around the Anthropic SDK. Cat Track runs fully offline (rule engine) when no
// ANTHROPIC_API_KEY is configured; with a key, Claude does extraction, reasoning and Q&A.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.CAT_TRACK_MODEL || 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client = null;
export function llmEnabled() {
  if (process.env.CAT_TRACK_DISABLE_LLM === '1') return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  if (!client) client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return client;
}

/**
 * Create a message with server-side refusal fallbacks enabled. If the beta request itself is
 * rejected (e.g. the beta isn't enabled for this org), retry once on the plain endpoint.
 */
export async function createMessage(params, options = undefined) {
  const c = getClient();
  try {
    return await c.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' }, options);
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      console.warn('[llm] beta request rejected, retrying without fallbacks:', err.message);
      return await c.messages.create(params, options);
    }
    throw err;
  }
}

export function textOf(message) {
  return (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

/** Ask Claude for JSON conforming to `schema` (structured outputs). Returns parsed object. */
export async function structured({ system, content, schema, effort = 'low', maxTokens = 8000 }) {
  const message = await createMessage({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  }, { timeout: 30_000, maxRetries: 0 }); // the offline rule engine is an instant fallback, so fail fast
  if (message.stop_reason === 'refusal') throw new Error('Claude declined this request');
  if (message.stop_reason === 'max_tokens') throw new Error('Claude response truncated');
  return JSON.parse(textOf(message));
}

export function describeLlmError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'invalid API key';
  if (err instanceof Anthropic.RateLimitError) return 'rate limited';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timed out';
  if (err instanceof Anthropic.APIConnectionError) return 'network error';
  if (err instanceof Anthropic.APIError) return `API error ${err.status}`;
  return err?.message || String(err);
}

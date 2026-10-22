// The AI assistant of the tickets (beta), the part that runs in the bot: the Groq client and the rules of when to answer in a ticket.
// The prompt is built by ticketAiPrompt.js (the same rules the dashboard's test chat uses). The key is GROQ_API_KEY (never logged or sent
// anywhere but Groq); the model is GROQ_MODEL, or the first preferred one that Groq lists.
const logger = require('./logger');

const CFG = {
  base: 'https://api.groq.com/openai/v1',
  modelPreference: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
  modelsCacheMs: 6 * 60 * 60 * 1000,
  modelsRetryMs: 10 * 60 * 1000,
  timeoutMs: 20_000,
  modelsTimeoutMs: 4_000,
  temperature: 0.3,
  maxTokens: 700,
  /** The opener may write several messages in a row: the assistant waits this long and answers the last one. */
  debounceMs: 2_500,
  /** Replies per server per hour, so a flood of tickets cannot empty the quota. */
  guildPerHour: 120,
  /** Recent messages read from the ticket channel to know what was said and who answered. */
  scanMessages: 40,
};

/** The line that ends every reply of the assistant: it says it is an AI and lets the bot recognize its own replies later (after a restart). */
const MARK = '-# 🤖 ';

const isConfigured = () => Boolean(String(process.env.GROQ_API_KEY ?? '').trim());

let modelCache = null;
async function resolveModel(key) {
  const forced = String(process.env.GROQ_MODEL ?? '').trim();
  if (forced) return forced;
  if (modelCache && modelCache.until > Date.now()) return modelCache.model;
  const fallback = CFG.modelPreference[0];
  try {
    const res = await fetch(`${CFG.base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(CFG.modelsTimeoutMs) });
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    const listed = new Set((Array.isArray(body?.data) ? body.data : []).filter((m) => m?.active !== false).map((m) => String(m?.id ?? '')));
    const model = CFG.modelPreference.find((id) => listed.has(id)) ?? fallback;
    modelCache = { model, until: Date.now() + CFG.modelsCacheMs };
    return model;
  } catch (error) {
    logger.warn(`[ticket-ai] Groq models list unavailable: ${error?.name === 'TimeoutError' ? 'timeout' : String(error?.message ?? '').slice(0, 12)}`);
    modelCache = { model: fallback, until: Date.now() + CFG.modelsRetryMs };
    return fallback;
  }
}

/**
 * One chat request. Returns `{ ok: true, content }` or `{ ok: false, code }` (timeout, busy, model, upstream, empty). Only the status of an
 * error is logged, never its body.
 */
async function chat(messages, maxTokens = CFG.maxTokens) {
  const key = String(process.env.GROQ_API_KEY ?? '').trim();
  if (!key) return { ok: false, code: 'not_configured' };
  const model = await resolveModel(key);
  // The GPT-OSS models think before answering: a little thinking, kept out of the answer.
  const reasoning = model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {};
  try {
    const res = await fetch(`${CFG.base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(CFG.timeoutMs),
      body: JSON.stringify({ model, messages, temperature: CFG.temperature, max_completion_tokens: maxTokens, stream: false, ...reasoning }),
    });
    if (!res.ok) {
      logger.warn(`[ticket-ai] Groq answered ${res.status} (model ${model})`);
      if (res.status === 429 || res.status === 503) return { ok: false, code: 'busy' };
      if ((res.status === 404 || res.status === 400) && !process.env.GROQ_MODEL) modelCache = null;
      return { ok: false, code: res.status === 404 ? 'model' : 'upstream' };
    }
    const body = await res.json().catch(() => null);
    const content = body?.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? { ok: true, content } : { ok: false, code: 'empty' };
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    logger.warn(`[ticket-ai] Groq ${timeout ? 'timed out' : 'could not be reached'} (model ${model})`);
    return { ok: false, code: timeout ? 'timeout' : 'upstream' };
  }
}

// ---- limit per server per hour (in this process)
const hourly = new Map();
function takeGuildSlot(guildId, now = Date.now()) {
  const recent = (hourly.get(guildId) ?? []).filter((at) => now - at < 60 * 60 * 1000);
  if (recent.length >= CFG.guildPerHour) { hourly.set(guildId, recent); return false; }
  recent.push(now);
  hourly.set(guildId, recent);
  if (hourly.size > 5000) hourly.delete(hourly.keys().next().value);
  return true;
}

/** Whether a message is one of the assistant's own replies (it ends with the AI line). */
const isAssistantReply = (message, botId) => message.author?.id === botId && String(message.content ?? '').includes(`\n${MARK}`);

/** The text of an assistant reply without its AI line. */
const stripMark = (content) => String(content ?? '').split(`\n${MARK}`)[0].trim();

module.exports = { CFG, MARK, isConfigured, chat, takeGuildSlot, isAssistantReply, stripMark };

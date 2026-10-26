// What the commands that look something up on another service (Minecraft, GitHub, Last.fm, Roblox, Steam, Twitch, YouTube) share:
// a fetch that turns every failure into one of a few kinds, a small cache, a cooldown per person, and the reply (defer, build, edit).
const { MessageFlags } = require('discord.js');
const { noticePayload } = require('./infoCard');
const { COLORS } = require('./colors');
const { EMOJI } = require('./emojis');
const logger = require('./logger');
const { t } = require('../i18n');

const USER_AGENT = 'Petto-Discord-Bot/1.0 (+https://petto.sbs)'; // i18n-ignore: sent to the services, never shown
const TIMEOUT_MS = 8000;

/** A lookup that did not work. `kind` is `notFound`, `unavailable`, `rateLimited`, `notConfigured`, `private` or `badInput`. */
class IntegrationError extends Error {
  constructor(kind, detail = '', body = null) {
    super(`${kind}${detail ? `: ${detail}` : ''}`); // i18n-ignore: internal error, the command answers with its own message
    this.kind = kind;
    this.body = body; // what the service answered, when it was JSON (a command can read the reason in it)
  }
}

/**
 * GET (or POST) a JSON answer; a 204 (nothing there) is null. 404 is `notFound`, 429 (or GitHub's exhausted limit) is `rateLimited`, any other failure, a
 * timeout or an answer that is not JSON is `unavailable`. `ok404` returns null for a 404 instead of throwing.
 */
async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = TIMEOUT_MS, ok404 = false } = {}) {
  let response;
  try {
    response = await globalThis.fetch(url, {
      method,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new IntegrationError('unavailable');
  }
  if (response.status === 204) return null;
  if (response.status === 404) {
    if (ok404) return null;
    throw new IntegrationError('notFound');
  }
  if (response.status === 429 || (response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') === '0')) throw new IntegrationError('rateLimited');
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new IntegrationError('unavailable', String(response.status), body);
  }
  try {
    return await response.json();
  } catch {
    throw new IntegrationError('unavailable');
  }
}

const CACHE_LIMIT = 500;
const cache = new Map();

/** `loader()` once per `ttlMs` for the same key (a failure is not kept). */
async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await loader();
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

const lastUse = new Map();

/** 0 when `userId` may use `name` now (and the time starts), or the milliseconds left to wait. */
function cooldownLeft(userId, name, ms) {
  const key = `${name}:${userId}`;
  const now = Date.now();
  const until = lastUse.get(key) ?? 0;
  if (until > now) return until - now;
  if (lastUse.size > 5000) for (const [k, v] of lastUse) if (v <= now) lastUse.delete(k);
  lastUse.set(key, now + ms);
  return 0;
}

/** The card for a lookup that failed. */
function failurePayload(error, lang, service) {
  const kind = error instanceof IntegrationError ? error.kind : 'unavailable';
  return noticePayload(t(lang, `integrations.error.${kind}`, { service }), COLORS.RED);
}

/**
 * Defers, builds the card (`build` returns a message payload) and edits the reply; a failure becomes a red card. A cooldown
 * (`cooldown: { name, ms }`) refuses a person who asks again too soon.
 */
async function lookup(interaction, lang, service, build, cooldown = null) {
  if (cooldown) {
    const left = cooldownLeft(interaction.user.id, cooldown.name, cooldown.ms);
    if (left > 0) {
      await interaction.reply({ ...noticePayload(t(lang, 'integrations.error.cooldown', { seconds: Math.ceil(left / 1000) }), COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }
  }
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  try {
    await interaction.editReply(await build());
  } catch (error) {
    // A missing argument is the member's to fix: it goes back to the command handler, which shows how to write the command.
    if (error?.userFacing || error?.missingOption) throw error;
    if (!(error instanceof IntegrationError)) logger.error(`Lookup on ${service} failed: ${error?.message ?? error}`);
    await interaction.editReply(failurePayload(error, lang, service)).catch(() => {});
  }
}

/** One line of a card: the dot, the label in bold and the value. */
const row = (label, value) => `${EMOJI.FIELD_DOT} **${label}** ${value}`;

/** Cuts a text to `max` characters, one line. */
function short(text, max = 200) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** Drops anything that would make a link or a mention out of text written by a stranger. */
function plain(text, max = 200) {
  return short(text, max).replace(/[<>@`*_~|\\[\]]/g, (char) => `\\${char}`).replace(/https?:\/\//gi, '');
}

/** `1:02:03` or `4:05` for a number of seconds. */
function clock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(total % 60)}` : `${m}:${two(total % 60)}`;
}

/** `<t:…:D>` for an ISO date or a timestamp in ms, or null when it is not a date. */
function dateTag(value, style = 'D') {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : null;
}

/** Forgets everything cached and every cooldown (the checks start each case clean). */
const clearCache = () => { cache.clear(); lastUse.clear(); };

module.exports = { USER_AGENT, IntegrationError, fetchJson, cached, clearCache, cooldownLeft, failurePayload, lookup, row, short, plain, clock, dateTag };

// The last resort when Discord refuses an answer for what it is made of (a body that is too long, too many components...): the member
// gets one short text that says what happened, instead of nothing. It is tried once and never for a permission or an unknown channel
// (those are not about the answer), and it never loops: if the short text fails too, the error goes up as it was.
const { MessageFlags, TextDisplayBuilder } = require('discord.js');
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');

const PLAIN_LIMIT = 1900;
// 50035: invalid form body (a text too long, too many components, a field that is not allowed).
const PAYLOAD_CODES = new Set([50035]);

/** True when Discord refused the answer because of its content, not because of who asked or where. */
function isPayloadError(error) {
  return Boolean(error) && PAYLOAD_CODES.has(error.code);
}

/** The short text that replaces an answer Discord refused, in the language of the server. */
function plainText(lang) {
  return t(lang ?? currentLanguage(), 'core.replyTooLong').slice(0, PLAIN_LIMIT);
}

/**
 * What to send in place of `options`: `content` only, no components, no embeds, no files and no mentions. Two things are kept because
 * Discord decides them: a private answer stays private, and an answer that was in Components V2 (or that Discord says is) is a text
 * display, since that flag cannot be taken off a message and `content` is not allowed with it.
 */
function plainPayload(options, lang, error) {
  const flags = Number.isFinite(Number(options?.flags)) ? Number(options.flags) : 0;
  const private_ = flags & MessageFlags.Ephemeral;
  // A short text of its own (an error card) is kept as it is; anything else says that the answer was too long.
  const own = typeof options === 'string' ? options : options?.content;
  const text = typeof own === 'string' && own.trim() && own.length <= PLAIN_LIMIT ? own : plainText(lang);
  const v2 = Boolean(flags & MessageFlags.IsComponentsV2) || /COMPONENTS_V2/.test(JSON.stringify(error?.rawError ?? ''));
  if (v2) return { components: [new TextDisplayBuilder().setContent(text)], flags: MessageFlags.IsComponentsV2 | private_, allowedMentions: { parse: [] } };
  return { content: text, components: [], embeds: [], files: [], flags: private_ || undefined, allowedMentions: { parse: [] } };
}

/** What Discord said about the answer, in a few words, for the log. */
function describe(error) {
  return String(error?.message ?? error).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * `send(options)` once; when Discord refuses it for its content, the short text through the same `send`, and one line in the log.
 * `lang` is a language or a function that gives it (the language of a command is found after the answer is built).
 */
async function sendWithPlainFallback(send, options, { lang, context = 'reply' } = {}) {
  try {
    return await send(options);
  } catch (error) {
    if (!isPayloadError(error)) throw error;
    logger.error(`${context}: Discord refused the answer (code ${error.code}), a short text was sent instead: ${describe(error)}`);
    return send(plainPayload(options, typeof lang === 'function' ? lang() : lang, error));
  }
}

module.exports = { PLAIN_LIMIT, isPayloadError, plainText, plainPayload, sendWithPlainFallback };

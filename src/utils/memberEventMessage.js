const { getTemplate } = require('../db/embedTemplates');
const { build } = require('./embedBuilder');
const { plainMessage } = require('./cardService');
const { looksLikeScript, parseEmbedScript } = require('./embedScript');
const { payloadFromCode } = require('./embedCodeMessage');
const { resolve } = require('./embedVariables');
const { extractReactReplies, applyReactReplies } = require('./messageFlags');
const logger = require('./logger');
const { sendAs } = require('./senderIdentity');
const { sendDm } = require('./dmOrigin');
const { plainCard } = require('./plainCard');
const { t, currentLanguage } = require('../i18n');

// Which look a kind of announcement takes (see db/senderIdentities.js). Other kinds are sent the normal way.
const IDENTITY_FEATURE = { welcome: 'welcome', leave: 'leave', boost: 'boost', boost_level: 'boost', birthday: 'birthdays' };
const deliver = (channel, kind, payload) => (IDENTITY_FEATURE[kind] ? sendAs(channel, IDENTITY_FEATURE[kind], payload) : channel.send(payload));

// Admin-authored announcement text (staff decided what it says, e.g. "{user} welcome!") —
// unlike auto-generated content, it's fine (expected, even) for this to actually ping.
const ANNOUNCEMENT_MENTIONS = { parse: ['users', 'roles'] };

/**
 * The welcome text `!setup` saves when the server wrote none is stored in English; it is sent (and shown) in the server's
 * language. Any other text is the server's own and stays as it is.
 */
function localizeDefaultText(kind, text, lang = currentLanguage()) {
  if (kind === 'welcome' && text === t('en', 'welcome.default.welcome')) return t(lang, 'welcome.default.welcome');
  return text;
}

/**
 * Sends a welcome/leave/boost/boost_level announcement: a saved /embed template
 * (resolved with variables) if configured, otherwise plain text (also variable-
 * resolved), sent as an ordinary message with no embed/card wrapper. No-ops
 * silently if neither is set — matches the source bots, where "channel +
 * message both required" is how a trigger gets turned off without a separate
 * enabled flag.
 */
async function sendMemberEvent({ guild, channel, kind, messageText: storedText, embedTemplateName, ctx, asCard = false, lang = currentLanguage(), dmOrigin = null }) {
  if (!storedText && !embedTemplateName) return;
  // A direct message (the channel is the chat with the member) says who it is from and has the buttons; no server look applies to it.
  const post = (payload) => (dmOrigin ? sendDm(channel, payload, dmOrigin) : deliver(channel, kind, payload));
  const messageText = localizeDefaultText(kind, storedText, lang);

  // {reactreply:emoji} can appear in the message text regardless of whether it ends up sent
  // as plain text or an embed template takes over — strip it out before either path runs.
  const { text: cleanedText, emojis } = messageText ? extractReactReplies(messageText) : { text: '', emojis: [] };

  try {
    if (embedTemplateName) {
      const doc = await getTemplate(guild.id, embedTemplateName);
      if (doc) {
        const payload = await build(doc.data, ctx);
        const sent = await post({ content: payload.content, embeds: payload.embeds, components: payload.components, files: payload.files, allowedMentions: ANNOUNCEMENT_MENTIONS });
        if (emojis.length) await applyReactReplies(sent, emojis);
        return;
      }
      logger.warn(`Member event "${kind}" in guild ${guild.id}: embed template "${embedTemplateName}" not found, falling back to plain text.`);
    }

    // The message can be an embed code (`{embed}$v{description: ...}$v{button: ...}`): the embed and its buttons are built from it.
    if (cleanedText && looksLikeScript(cleanedText)) {
      const { payload, error } = await payloadFromCode(cleanedText, { ...ctx, lang });
      if (payload) {
        const sent = await post({ content: payload.content, embeds: payload.embeds, components: payload.components, files: payload.files, allowedMentions: ANNOUNCEMENT_MENTIONS });
        if (emojis.length) await applyReactReplies(sent, emojis);
        return;
      }
      logger.warn(`Member event "${kind}" in guild ${guild.id}: the embed code could not be built${error ? `: ${error}` : ''}.`);
      return;
    }

    if (cleanedText) {
      const plain = await plainMessage(cleanedText, ctx);
      // The usual look of a message the server did not write itself: a card (`asCard` can be its color), with the same text and the same files.
      const body = asCard ? { ...plainCard(plain.content, Number.isInteger(asCard) ? asCard : null), ...(plain.files ? { files: plain.files } : {}) } : plain;
      const sent = await post({ ...body, allowedMentions: ANNOUNCEMENT_MENTIONS });
      if (emojis.length) await applyReactReplies(sent, emojis);
    } else if (emojis.length) {
      // Reactions were the only thing configured (no other text) — nothing to react to without
      // a message, so this is a no-op by design rather than sending an empty message just to react to it.
      logger.warn(`Member event "${kind}" in guild ${guild.id}: {reactreply} with no other text has nothing to react to.`);
    }
  } catch (err) {
    logger.error(`Failed to send member event "${kind}" in guild ${guild.id}:`, err);
  }
}

/** A long message cut short, to show it in a status. */
function shortMessage(text, max = 300) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** What a setup answers about the message it saved: the text, or how many embeds and buttons an embed code has and what in it was not understood. */
function describeMessage(message, lang = currentLanguage()) {
  if (!looksLikeScript(message)) return t(lang, 'welcome.common.message', { message: shortMessage(message) });
  const parsed = parseEmbedScript(message, lang);
  return [t(lang, 'welcome.common.code', { embeds: parsed.embeds.length, buttons: parsed.buttons.length }), ...parsed.warnings.map((line) => `- ${line}`)].join('\n');
}

module.exports = { sendMemberEvent, localizeDefaultText, shortMessage, describeMessage };

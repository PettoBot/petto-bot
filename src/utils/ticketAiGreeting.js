// The first message of the AI assistant in a new ticket (beta): a short hello that says what the assistant is. It needs no model call.
// It is sent only where the assistant would answer (switched on, in the ticket type's scope, GROQ_API_KEY set), in the language the server chose
// for the assistant; with "the ticket user's language" it uses the language of the server, since the person has not written yet.
const aiDb = require('../db/ticketAi');
const ai = require('./ticketAi');
const flow = require('./ticketAiFlow');
const { guildLanguage } = require('../i18n');
const logger = require('./logger');

const LOCALES = new Set(['en', 'es', 'pt-BR']);

/** Sends the greeting; never throws (a ticket opens the same without it). */
async function greet({ guild, client, channel, category, opener }) {
  try {
    if (!ai.isConfigured()) return;
    const settings = await aiDb.getSettings(guild.id);
    if (!settings.enabled) return;
    if (settings.categoryIds.length && !settings.categoryIds.includes(String(category.id))) return;
    const lang = LOCALES.has(settings.language_mode) ? settings.language_mode : await guildLanguage(guild.id);
    const card = flow.greetingCard({ lang, user: opener, typeLabel: category.label, avatarUrl: client.user.displayAvatarURL({ extension: 'png', size: 256 }) });
    await channel.send(flow.cardMessage(card, [], { allowedMentions: { parse: [] } }));
  } catch (error) {
    logger.warn(`[ticket-ai] greeting failed: ${error.message}`);
  }
}

module.exports = { greet };

// The AI assistant of the tickets (beta): the settings of a server (written by the dashboard) and the monthly count of AI replies.
// Tables: ticket_ai_settings and ticket_ai_usage (schema.sql). Without them everything is off, nothing breaks.
const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');
const { normalizeSettings } = require('../utils/ticketAiPrompt');
const logger = require('../utils/logger');

const cache = createExpiringCache(30_000, { name: 'ticket-ai' });
const OFF = Object.freeze({ enabled: false, categoryIds: [], instructions: '', knowledge: '', handoff: '', reply_style: '', messageLinks: [], channelGuide: true, tone: 'friendly', language_mode: 'auto', max_replies: 3 });

const missingTable = (error) => ['PGRST205', '42P01'].includes(String(error?.code ?? '')) || /does not exist|schema cache/i.test(String(error?.message ?? ''));

/** The settings of a server, or an "off" copy (also when the table does not exist yet or the read fails). */
async function getSettings(guildId) {
  return cache.get(guildId, async () => {
    const { data, error } = await database.from('ticket_ai_settings').select('*').eq('guild_id', guildId).maybeSingle();
    if (error) {
      if (!missingTable(error)) logger.warn(`[ticket-ai] could not read the settings of ${guildId}: ${error.message}`);
      return OFF;
    }
    if (!data) return OFF;
    const s = normalizeSettings({ instructions: data.instructions, knowledge: data.knowledge, handoff: data.handoff, reply_style: data.reply_style, tone: data.tone, language_mode: data.language_mode, max_replies: data.max_replies });
    return {
      enabled: data.enabled === true,
      categoryIds: Array.isArray(data.category_ids) ? data.category_ids.map(String) : [],
      instructions: s.instructions, knowledge: s.knowledge, handoff: s.handoff, reply_style: s.reply_style, messageLinks: Array.isArray(data.message_links) ? data.message_links.map(String).slice(0, 10) : [], channelGuide: data.channel_guide !== false,
      tone: s.tone, language_mode: s.language_mode, max_replies: s.max_replies,
    };
  }, { staleIfError: true });
}

/** Adds one AI reply to this month's count of a server (atomic, through the function of schema.sql). Never throws. */
async function countReply(guildId) {
  try {
    const { error } = await database.rpc('ticket_ai_count_reply', { p_guild_id: guildId });
    if (error && !missingTable(error)) logger.warn(`[ticket-ai] could not count a reply for ${guildId}: ${error.message}`);
  } catch (error) {
    logger.warn(`[ticket-ai] could not count a reply for ${guildId}: ${error.message}`);
  }
}

/** The replies sent this month by a server (0 when unknown). */
async function monthlyReplies(guildId) {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const { data, error } = await database.from('ticket_ai_usage').select('replies').eq('guild_id', guildId).eq('month', month).maybeSingle();
    return error ? 0 : Number(data?.replies ?? 0) || 0;
  } catch {
    return 0;
  }
}

module.exports = { getSettings, countReply, monthlyReplies, OFF };

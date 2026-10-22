// The AI assistant of the tickets (beta): answers the person who opened a ticket, from the instructions the server owner wrote in the dashboard,
// until a staff member arrives, the reply limit is reached or a hand-over topic comes up. It has no powers: it only writes messages.
// Off unless GROQ_API_KEY is set and the server switched it on (ticket_ai_settings.enabled).
const { Events } = require('discord.js');
const ticketsDb = require('../db/tickets');
const aiDb = require('../db/ticketAi');
const actions = require('../utils/ticketActions');
const ai = require('../utils/ticketAi');
const prompt = require('../utils/ticketAiPrompt');
const { t, guildLanguage } = require('../i18n');
const logger = require('../utils/logger');

// What the assistant knows of a ticket channel while it is open (memory only; rebuilt from the channel after a restart).
const states = new Map(); // channelId -> { stopped, replies, latest, busy, loaded }

const stop = (channelId) => { const state = states.get(channelId); if (state) state.stopped = true; };

/** Reads the last messages of the channel once: how many replies the assistant sent and whether staff already answered. */
async function loadState(message, ticket, category) {
  const known = states.get(message.channel.id);
  if (known?.loaded) return known;
  const state = { stopped: Boolean(ticket.claimed_by), replies: 0, latest: null, busy: false, loaded: true };
  const recent = await message.channel.messages.fetch({ limit: ai.CFG.scanMessages }).catch(() => null);
  const botId = message.client.user.id;
  for (const item of recent?.values() ?? []) {
    if (item.id === message.id) continue;
    if (ai.isAssistantReply(item, botId)) { state.replies += 1; continue; }
    if (item.author.bot || item.author.id === ticket.opener_id) continue;
    const member = item.member ?? message.guild.members.cache.get(item.author.id) ?? await message.guild.members.fetch(item.author.id).catch(() => null);
    if (member && actions.isStaffForCategory(member, category)) state.stopped = true;
  }
  states.set(message.channel.id, state);
  // Small cap: a closed ticket's state is simply the oldest one to go.
  if (states.size > 2000) states.delete(states.keys().next().value);
  return state;
}

/** The conversation for the model: what the opener said and what the assistant answered, oldest first (staff and other bots are left out). */
async function conversation(message, ticket) {
  const recent = await message.channel.messages.fetch({ limit: ai.CFG.scanMessages, before: message.id }).catch(() => null);
  const botId = message.client.user.id;
  const turns = [];
  for (const item of [...(recent?.values() ?? [])].reverse()) {
    if (ai.isAssistantReply(item, botId)) turns.push({ role: 'assistant', content: ai.stripMark(item.content) });
    else if (!item.author.bot && item.author.id === ticket.opener_id && item.content) turns.push({ role: 'user', content: item.content });
  }
  return turns;
}

async function handOver(message, category, state, reason) {
  const lang = await guildLanguage(message.guild.id);
  state.stopped = true;
  const roles = (category.ping_role_ids ?? []).filter((id) => message.guild.roles.cache.has(id)).slice(0, 5);
  const text = [t(lang, reason === 'secret' ? 'tickets.ai.handoffSecret' : 'tickets.ai.handoff'), roles.length ? roles.map((id) => `<@&${id}>`).join(' ') : ''].filter(Boolean).join('\n');
  await message.channel.send({ content: text, allowedMentions: { roles } }).catch((error) => logger.warn(`[ticket-ai] hand-over message failed: ${error.message}`));
}

async function answer(message, ticket, category, settings, state) {
  const lang = await guildLanguage(message.guild.id);
  const history = await conversation(message, ticket);
  const turn = prompt.buildTicketTurn({ settings: { instructions: settings.instructions, knowledge: settings.knowledge, handoff: settings.handoff, tone: settings.tone, language_mode: settings.language_mode, max_replies: settings.max_replies }, history, message: message.content });
  if (turn.kind === 'handoff') {
    // A token or a card number is never kept in the channel.
    if (turn.reason === 'secret') await message.delete().catch(() => {});
    await handOver(message, category, state, turn.reason);
    return;
  }
  if (!ai.takeGuildSlot(message.guild.id)) return;
  await message.channel.sendTyping().catch(() => {});
  const result = await ai.chat(turn.messages);
  if (!result.ok) return; // staff will answer; nothing is said about the failure
  const reply = prompt.detectHandoff(result.content);
  const text = prompt.defuseMentions(reply.text);
  if (text) {
    await message.channel.send({
      content: `${text}\n${ai.MARK}${t(lang, 'tickets.ai.label')}`,
      reply: { messageReference: message.id, failIfNotExists: false },
      allowedMentions: { parse: [], repliedUser: false },
    }).catch((error) => logger.warn(`[ticket-ai] reply failed: ${error.message}`));
    state.replies += 1;
    aiDb.countReply(message.guild.id);
  }
  if (reply.handoff) await handOver(message, category, state, 'model');
  else if (state.replies >= settings.max_replies) state.stopped = true;
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.bot || message.system || !ai.isConfigured()) return;
    try {
      const settings = await aiDb.getSettings(message.guild.id);
      if (!settings.enabled) return;
      const ticket = await ticketsDb.getTicketByChannel(message.channel.id);
      if (!ticket || ticket.status !== 'open') return;
      const category = await ticketsDb.getCategoryById(ticket.category_id);
      if (!category) return;
      if (settings.categoryIds.length && !settings.categoryIds.includes(String(category.id))) return;

      // Staff speaking ends the assistant's part in that ticket.
      if (message.author.id !== ticket.opener_id) {
        const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        if (member && actions.isStaffForCategory(member, category)) stop(message.channel.id);
        return;
      }
      if (!message.content?.trim()) return;

      const state = await loadState(message, ticket, category);
      if (state.stopped || state.busy) return;
      if (state.replies >= settings.max_replies) { await handOver(message, category, state, 'limit'); return; }

      // The opener may send several messages in a row: only the last one is answered.
      state.latest = message.id;
      await new Promise((resolve) => setTimeout(resolve, ai.CFG.debounceMs));
      if (state.latest !== message.id || state.stopped) return;
      state.busy = true;
      try {
        await answer(message, ticket, category, settings, state);
      } finally {
        state.busy = false;
      }
    } catch (error) {
      logger.error('Ticket AI assistant failed:', error);
    }
  },
};

// The AI assistant of the tickets (beta): answers the person who opened a ticket, from the instructions the server owner wrote in the dashboard,
// until a staff member arrives, the reply limit is reached or a hand-over topic comes up. It has no powers: it only writes messages (cards).
// Off unless GROQ_API_KEY is set and the server switched it on (ticket_ai_settings.enabled).
const { Events } = require('discord.js');
const ticketsDb = require('../db/tickets');
const aiDb = require('../db/ticketAi');
const actions = require('../utils/ticketActions');
const ai = require('../utils/ticketAi');
const flow = require('../utils/ticketAiFlow');
const prompt = require('../utils/ticketAiPrompt');
const { t, guildLanguage } = require('../i18n');
const logger = require('../utils/logger');

/** Reads the last messages of the channel once: how many replies the assistant sent and whether staff already answered. */
async function loadState(message, ticket, category) {
  const known = flow.stateOf(message.channel.id);
  if (known?.loaded) return known;
  const state = { stopped: Boolean(ticket.claimed_by), replies: 0, latest: null, busy: false, loaded: true };
  const recent = await message.channel.messages.fetch({ limit: ai.CFG.scanMessages }).catch(() => null);
  const botId = message.client.user.id;
  for (const item of recent?.values() ?? []) {
    if (item.id === message.id) continue;
    if (flow.isAssistantReply(item, botId)) { state.replies += 1; continue; }
    if (item.author.bot || item.author.id === ticket.opener_id) continue;
    const member = item.member ?? message.guild.members.cache.get(item.author.id) ?? await message.guild.members.fetch(item.author.id).catch(() => null);
    if (member && actions.isStaffForCategory(member, category)) state.stopped = true;
  }
  return flow.remember(message.channel.id, state);
}

/** The conversation for the model: what the opener said and what the assistant answered, oldest first (staff and other bots are left out). */
async function conversation(message, ticket) {
  const recent = await message.channel.messages.fetch({ limit: ai.CFG.scanMessages, before: message.id }).catch(() => null);
  const botId = message.client.user.id;
  const turns = [];
  for (const item of [...(recent?.values() ?? [])].reverse()) {
    if (flow.isAssistantReply(item, botId)) turns.push({ role: 'assistant', content: flow.replyText(item) });
    else if (!item.author.bot && item.author.id === ticket.opener_id && item.content) turns.push({ role: 'user', content: item.content });
  }
  return turns;
}

/** Tells the person the team was told and pings the ticket type's roles. */
async function handOver(message, category, state, reason) {
  const lang = await guildLanguage(message.guild.id);
  state.stopped = true;
  const roles = flow.pingRoles(message.guild, category);
  const card = flow.handoffCard({ lang, handoffText: t(lang, reason === 'secret' ? 'tickets.ai.handoffSecret' : 'tickets.ai.handoff'), roleIds: roles });
  await message.channel.send(flow.cardMessage(card, roles)).catch((error) => logger.warn(`[ticket-ai] hand-over message failed: ${error.message}`));
}

async function answer(message, ticket, category, settings, state) {
  const lang = await guildLanguage(message.guild.id);
  const history = await conversation(message, ticket);
  const turn = prompt.buildTicketTurn({ settings: { instructions: settings.instructions, knowledge: settings.knowledge, handoff: settings.handoff, tone: settings.tone, language_mode: settings.language_mode, max_replies: settings.max_replies }, history, message: message.content, ticketType: { label: category.label, description: category.description } });
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
  if (!text) { if (reply.handoff) await handOver(message, category, state, 'model'); return; }

  const roles = reply.handoff ? flow.pingRoles(message.guild, category) : [];
  const card = flow.replyCard({ lang, user: message.author, text, roleIds: roles, handoffText: reply.handoff ? t(lang, 'tickets.ai.handoff') : null });
  const sent = await message.channel.send(flow.cardMessage(card, roles, { reply: { messageReference: message.id, failIfNotExists: false } }))
    .catch((error) => { logger.warn(`[ticket-ai] reply failed: ${error.message}`); return null; });
  if (!sent) return;
  state.replies += 1;
  aiDb.countReply(message.guild.id);
  if (reply.handoff) state.stopped = true;
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
        if (member && actions.isStaffForCategory(member, category)) flow.stop(message.channel.id);
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

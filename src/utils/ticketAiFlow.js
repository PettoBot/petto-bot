// The AI assistant of the tickets (beta): what it remembers of a ticket channel while it is open, and the cards it sends (Components V2).
// The event (events/messageCreateTicketAi.js) and the "Talk to a person" button (interactions/ticketAi.js) share this state.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { t } = require('../i18n');
const ai = require('./ticketAi');

const ACCENT = 0xf0a88f;
/** customId of the "Talk to a person" button of a reply. */
const HUMAN_BUTTON = 'ticketai:human';

// What the assistant knows of a ticket channel (memory only; rebuilt from the channel after a restart).
const states = new Map(); // channelId -> { stopped, replies, latest, busy, loaded }
const stateOf = (channelId) => states.get(channelId) ?? null;
function remember(channelId, state) {
  states.set(channelId, state);
  // Small cap: a closed ticket's state is simply the oldest one to go.
  if (states.size > 2000) states.delete(states.keys().next().value);
  return state;
}
const stop = (channelId) => { const state = states.get(channelId); if (state) state.stopped = true; };

// ---- reading the assistant's own messages back (a card has no `content`: its text sits in text displays)

/** Every text of a message, in order: its content, then the text displays of its components (containers, sections, rows). */
function textsOf(message) {
  const out = [];
  if (message.content) out.push(String(message.content));
  const walk = (list) => {
    for (const item of list ?? []) {
      if (typeof item?.content === 'string' && item.content) out.push(item.content);
      else if (item?.data?.content) out.push(String(item.data.content));
      walk(item?.components);
      if (item?.accessory) walk([item.accessory]);
    }
  };
  walk(message.components);
  return out;
}

/** Whether a message is one of the assistant's own replies (a card whose last text is the AI line, or an older plain reply). */
function isAssistantReply(message, botId) {
  if (message.author?.id !== botId) return false;
  return textsOf(message).some((text) => text.startsWith(ai.MARK) || text.includes(`\n${ai.MARK}`));
}

/** What the assistant said in one of its replies: the answer, without the header line, the AI line and the hand-over notice. */
function replyText(message) {
  const texts = textsOf(message).filter((text) => !text.startsWith('-# '));
  if (texts.length) return texts[0].trim();
  // An older plain reply: the text before its AI line.
  return ai.stripMark(message.content);
}

// ---- the cards

/** `**[`name`](https://discord.com/users/ID)**`: the name of the person the reply is for, linked to their profile. */
function personLink(user) {
  const name = String(user?.username ?? user?.globalName ?? user?.id ?? '?').replace(/[`\\]/g, '');
  return `**[\`${name}\`](https://discord.com/users/${user.id})**`;
}

function rolePing(ids) {
  return ids.map((id) => `<@&${id}>`).join(' ');
}

/**
 * The reply card: a small header ("Reply to <name>"), the answer, the AI line, and either the button to talk to a person or, when the
 * conversation goes to the team, the hand-over notice with the roles to ping.
 * @param {{ lang: string, user: object, text: string, roleIds?: string[], handoffText?: string | null }} input
 */
function replyCard({ lang, user, text, roleIds = [], handoffText = null }) {
  const container = new ContainerBuilder().setAccentColor(ACCENT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🤖 ${t(lang, 'tickets.ai.replyTo', { user: personLink(user) })}`))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(String(text).slice(0, 1900)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${ai.MARK}${t(lang, 'tickets.ai.label')}`));
  if (handoffText) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`🙋 ${handoffText}${roleIds.length ? `\n${rolePing(roleIds)}` : ''}`));
  } else {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(HUMAN_BUTTON).setStyle(ButtonStyle.Secondary).setLabel(t(lang, 'tickets.ai.human')).setEmoji('🙋'),
    ));
  }
  return container;
}

/** The card for a hand-over with no answer of its own (a keyword, the limit, a secret, or the person asked for a human). */
function handoffCard({ lang, handoffText, roleIds = [] }) {
  return new ContainerBuilder().setAccentColor(ACCENT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`🙋 ${handoffText}${roleIds.length ? `\n${rolePing(roleIds)}` : ''}`))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${ai.MARK}${t(lang, 'tickets.ai.label')}`));
}

/** What `channel.send` needs for a card: Components V2, nobody mentioned except the support roles named in it. */
function cardMessage(card, roleIds = [], extra = {}) {
  return { components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], roles: roleIds, repliedUser: false }, ...extra };
}

/** The support roles to ping for a ticket type (the ping roles it has, that still exist, at most 5). */
function pingRoles(guild, category) {
  return (category?.ping_role_ids ?? []).filter((id) => guild.roles.cache.has(id)).slice(0, 5);
}

module.exports = { ACCENT, HUMAN_BUTTON, states, stateOf, remember, stop, textsOf, isAssistantReply, replyText, personLink, replyCard, handoffCard, cardMessage, pingRoles };

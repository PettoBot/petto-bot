// What the bot says about the roles it manages: the thank-you message when a member starts matching a rule, and the log of
// every role it added or removed. Both can use a saved embed from Embeds; without one they use a plain Petto card.
const { MessageFlags } = require('discord.js');
const db = require('../../db/identity');
const { templatePayload } = require('../templatedMessage');
const { textCard } = require('../caseCard');
const { EMOJI } = require('../emojis');
const { COLORS } = require('../colors');
const logger = require('../logger');

const LOG_EVENTS = ['vanity_add', 'vanity_remove', 'tag_add', 'tag_remove', 'error'];
const EVENT_LABELS = {
  vanity_add: 'Vanity role added', vanity_remove: 'Vanity role removed', tag_add: 'Server Tag role added', tag_remove: 'Server Tag role removed', error: 'Role change failed',
};
const THANKS_COLOR = 0xf0a9c4;
const DEDUPE_MS = 5000;
const seen = new Map();

/** `vanity_add`, `tag_remove`... the key of a log event. A failed change is always `error`. */
function eventKey(action) {
  if (action.result === 'error' || action.error) return 'error';
  const prefix = action.source === 'guildtag' ? 'tag' : 'vanity';
  return `${prefix}_${action.action === 'remove_role' ? 'remove' : 'add'}`;
}

/** The same action twice within a few seconds (two events for one change) is logged once. */
function isRepeat(action) {
  const key = [action.guildId, action.userId, action.roleId, action.source, action.ruleId, action.action, action.result, action.error?.message ?? ''].join(':');
  const now = Date.now();
  const last = seen.get(key);
  seen.set(key, now);
  if (seen.size > 2048) for (const [entry, at] of seen) if (now - at > DEDUPE_MS) seen.delete(entry);
  return last != null && now - last < DEDUPE_MS;
}

/** What the variables of a message about this action are worth. Exposed so the dashboard can show samples. */
function identityContext(action) {
  const rule = action.ruleName || action.ruleId || '';
  const value = action.matchedValue || action.value || '';
  const text = action.action === 'remove_role' ? 'remove' : 'add';
  const tag = action.source === 'guildtag';
  return {
    rule: {
      name: rule, source: action.source ?? '', value: action.value ?? '', condition: action.ruleCondition ?? '', reason: action.reason ?? '',
      role: action.roleId ? `<@&${action.roleId}>` : '', roleId: action.roleId ?? '', action: action.action ?? '', actionText: text,
      result: action.result || 'completed', error: action.error?.message ?? '', matchedValue: value,
      event: `${action.source ?? 'vanity'}_${text}`, eventTitle: EVENT_LABELS[eventKey(action)] ?? '',
    },
    vanity: tag ? null : { rule, word: action.value ?? '', source: action.matchField ?? '', value, role: action.roleId ? `<@&${action.roleId}>` : '' },
    tag: tag ? { rule, condition: action.ruleCondition ?? '', text: action.tag || value, ruleValue: action.value ?? '', guildId: action.tagGuildId ?? '', enabled: action.tagEnabled ?? '', badge: action.tagBadge ?? '', role: action.roleId ? `<@&${action.roleId}>` : '' } : null,
  };
}

async function channelOf(guild, channelId) {
  const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

function defaultThanks(action) {
  return action.source === 'guildtag'
    ? `gracias por usar el tag **${action.tag || action.matchedValue || action.value}**, <@${action.userId}> ♡`
    : `gracias por usar el vanity **${action.value}**, <@${action.userId}> ♡`;
}

/** The thank-you message of the source, when the server set one. */
async function emitNotification(guild, member, action) {
  if (action.action !== 'add_role' || action.error) return;
  const config = await db.getNotification(guild.id, action.source);
  if (!config?.channelId) return;
  const channel = await channelOf(guild, config.channelId);
  if (!channel) return;
  const allowedMentions = config.ping === 'none' ? { parse: [] } : { users: [action.userId] };
  const payload = config.embedName
    ? await templatePayload(guild.id, config.embedName, { guild, user: member.user, member, channel, identity: identityContext(action) })
    : null;
  if (payload) {
    const { reactions, ...message } = payload;
    await channel.send({ ...message, allowedMentions });
    return;
  }
  await channel.send({ components: [textCard(defaultThanks(action), THANKS_COLOR)], flags: MessageFlags.IsComponentsV2, allowedMentions });
}

/** One line of the log of role changes. */
async function emitAction(guild, action) {
  if (isRepeat(action)) return;
  const config = await db.getLogConfig(guild.id);
  const key = eventKey(action);
  if (!config?.channelId || !config.events?.[key]) return;
  const channel = await channelOf(guild, config.channelId);
  if (!channel) return;
  const member = guild.members.cache.get(action.userId) ?? await guild.members.fetch(action.userId).catch(() => null);
  const user = member?.user ?? { id: action.userId, username: action.userName };
  const embedName = config.embeds?.[key];
  const payload = embedName ? await templatePayload(guild.id, embedName, { guild, user, member: member ?? undefined, channel, identity: identityContext(action) }) : null;
  if (payload) {
    const { reactions, ...message } = payload;
    await channel.send({ ...message, allowedMentions: { parse: [] } });
    return;
  }
  const ok = key !== 'error';
  const lines = [
    `### ${ok ? EMOJI.APPROVE : EMOJI.DENY}  ${EVENT_LABELS[key]}`,
    `**Member:** <@${action.userId}> (\`${action.userId}\`)`,
    `**Role:** ${action.roleId ? `<@&${action.roleId}>` : 'unknown'}`,
  ];
  if (action.ruleName) lines.push(`**Rule:** ${action.ruleName}`);
  if (action.reason) lines.push(`**Why:** ${action.reason}`);
  if (action.error) lines.push(`**Error:** ${action.error.message ?? action.error}`);
  await channel.send({ components: [textCard(lines.join('\n'), ok ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

module.exports = { emitAction, emitNotification, identityContext, eventKey, LOG_EVENTS, EVENT_LABELS };

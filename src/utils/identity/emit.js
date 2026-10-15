// What the bot says about the roles it manages: the thank-you message when a member starts matching a rule, and the log of
// every role it added or removed. Both can use a saved embed from Embeds; without one they use a plain Petto card.
const { MessageFlags, EmbedBuilder } = require('discord.js');
const { buildInfoCard } = require('../infoCard');
const { build } = require('../embedBuilder');
const { thanksDesign } = require('./v2Designs');
const db = require('../../db/identity');
const { templatePayload } = require('../templatedMessage');
const { EMOJI } = require('../emojis');
// Loaded when a message goes out: it reaches for the database, which the checks do without.
const sendAs = (...args) => require('../senderIdentity').sendAs(...args);
const logger = require('../logger');
const { t, currentLanguage } = require('../../i18n');

const LOG_EVENTS = ['vanity_add', 'vanity_remove', 'tag_add', 'tag_remove', 'error'];
const EVENT_KEYS = { vanity_add: 'vanityAdd', vanity_remove: 'vanityRemove', tag_add: 'tagAdd', tag_remove: 'tagRemove', error: 'error' };
/** The name of a kind of log entry in `lang`. */
const eventLabel = (event, lang = currentLanguage()) => (EVENT_KEYS[event] ? t(lang, `identity.event.${EVENT_KEYS[event]}`) : undefined);
// In English: the choices of the slash command builders are named with them.
const EVENT_LABELS = Object.fromEntries(LOG_EVENTS.map((event) => [event, eventLabel(event, 'en')]));
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
function identityContext(action, lang = currentLanguage()) {
  const rule = action.ruleName || action.ruleId || '';
  const value = action.matchedValue || action.value || '';
  const text = action.action === 'remove_role' ? 'remove' : 'add';
  const tag = action.source === 'guildtag';
  return {
    rule: {
      name: rule, source: action.source ?? '', value: action.value ?? '', condition: action.ruleCondition ?? '', reason: action.reason ?? '',
      role: action.roleId ? `<@&${action.roleId}>` : '', roleId: action.roleId ?? '', action: action.action ?? '', actionText: t(lang, `identity.actionText.${text}`),
      result: action.result || 'completed', error: action.error?.message ?? '', matchedValue: value,
      event: `${action.source ?? 'vanity'}_${text}`, eventTitle: eventLabel(eventKey(action), lang) ?? '',
    },
    vanity: tag ? null : { rule, word: action.value ?? '', source: action.matchField ?? '', value, role: action.roleId ? `<@&${action.roleId}>` : '' },
    tag: tag ? { rule, condition: action.ruleCondition ?? '', text: action.tag || value, ruleValue: action.value ?? '', guildId: action.tagGuildId ?? '', enabled: action.tagEnabled ?? '', badge: action.tagBadge ?? '', role: action.roleId ? `<@&${action.roleId}>` : '' } : null,
  };
}

async function channelOf(guild, channelId) {
  const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

/** The thank-you card when the server did not choose a saved embed: the member's picture, what they now have and why. */
function thanksCard(action, member, lang = currentLanguage()) {
  const tag = action.source === 'guildtag';
  const what = tag ? (action.tag || action.matchedValue || action.value) : action.value;
  const user = `<@${action.userId}>`;
  return buildInfoCard({
    accent: THANKS_COLOR,
    title: t(lang, tag ? 'identity.thanks.title.guildtag' : 'identity.thanks.title.vanity'),
    subtitle: [action.roleId ? t(lang, 'identity.thanks.subtitle', { user, role: `<@&${action.roleId}>` }) : user],
    thumbnail: member?.displayAvatarURL?.({ extension: 'png', size: 256 }) || action.userAvatar || null,
    // i18n-ignore: product names (Server Tag, Vanity) and the member's value
    sections: [{ lines: [`**${tag ? 'Server Tag' : 'Vanity'}** \`${String(what || '').slice(0, 100)}\``] }],
    footer: action.ruleName ? t(lang, 'identity.thanks.footer', { rule: action.ruleName }) : null,
  });
}

/** The thank-you message of the source, when the server set one. */
async function emitNotification(guild, member, action, lang = currentLanguage()) {
  if (action.action !== 'add_role' || action.error) return;
  const config = await db.getNotification(guild.id, action.source);
  if (!config?.channelId) return;
  const channel = await channelOf(guild, config.channelId);
  if (!channel) return;
  const allowedMentions = config.ping === 'none' ? { parse: [] } : { users: [action.userId] };
  const payload = config.embedName
    ? await templatePayload(guild.id, config.embedName, { guild, user: member.user, member, channel, identity: identityContext(action, lang) })
    : null;
  if (payload) {
    const { reactions, ...message } = payload;
    await sendAs(channel, 'vanity', { ...message, allowedMentions });
    return;
  }
  // Without a saved embed the thank-you is the same V2 design the import gives to the old default message.
  const designed = await build({ v2: thanksDesign(action.source, lang) }, { guild, user: member.user, member, channel, identity: identityContext(action, lang), allowV2: true }).catch(() => null);
  if (designed?.components?.length) {
    await sendAs(channel, 'vanity', { components: designed.components, flags: designed.flags, allowedMentions });
    return;
  }
  await sendAs(channel, 'vanity', { components: [thanksCard(action, member, lang)], flags: MessageFlags.IsComponentsV2, allowedMentions });
}

/** One line of the log of role changes. */
async function emitAction(guild, action, lang = currentLanguage()) {
  if (isRepeat(action)) return;
  const config = await db.getLogConfig(guild.id);
  const key = eventKey(action);
  if (!config?.channelId || !config.events?.[key]) return;
  const channel = await channelOf(guild, config.channelId);
  if (!channel) return;
  const member = guild.members.cache.get(action.userId) ?? await guild.members.fetch(action.userId).catch(() => null);
  const user = member?.user ?? { id: action.userId, username: action.userName };
  const embedName = config.embeds?.[key];
  const payload = embedName ? await templatePayload(guild.id, embedName, { guild, user, member: member ?? undefined, channel, identity: identityContext(action, lang) }) : null;
  if (payload) {
    const { reactions, ...message } = payload;
    await channel.send({ ...message, allowedMentions: { parse: [] } });
    return;
  }
  await channel.send({ embeds: [legacyLogEmbed(action, lang)], allowedMentions: { parse: [] } });
}

/**
 * The log entry the Vanity bot always sent, with the same look: a green or red embed with the title, the Petto approve or
 * deny emoji, the role and the member, and the word (Vanity) or the reason (Server Tag).
 */
function legacyLogEmbed(action, lang = currentLanguage()) {
  const remove = action.action === 'remove_role';
  const failed = Boolean(action.error) || action.result === 'error';
  const bad = remove || failed;
  const icon = bad ? EMOJI.DENY : EMOJI.APPROVE;
  const title = t(lang, action.source === 'guildtag' ? 'identity.log.title.guildtag' : 'identity.log.title.vanity');
  const vars = { icon, role: `<@&${action.roleId}>`, user: `<@${action.userId}>` };
  let description = `### ${title}\n${t(lang, remove ? 'identity.log.removed' : 'identity.log.added', vars)}`;
  if (failed) {
    const error = action.error?.message ?? action.error ?? t(lang, 'identity.log.unknownError');
    description = `### ${title}\n${t(lang, remove ? 'identity.log.failedRemove' : 'identity.log.failedAdd', { ...vars, error })}`;
  } else if (action.source === 'guildtag') {
    description += `\n${t(lang, 'identity.log.reasonTag', { condition: action.ruleCondition || 'tag', value: action.value || action.matchedValue })}`;
  } else {
    description += `\n${t(lang, 'identity.log.word', { value: action.value || action.matchedValue })}`;
  }
  return new EmbedBuilder().setDescription(description.slice(0, 4000)).setColor(bad ? 0xfe6465 : 0xa5ea7a);
}

module.exports = { emitAction, emitNotification, identityContext, eventKey, eventLabel, legacyLogEmbed, thanksCard, LOG_EVENTS, EVENT_LABELS };

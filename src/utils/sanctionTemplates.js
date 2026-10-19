// The messages of a sanction, with the server's own design when it chose one: the DM the member receives, what is posted
// where the command was used, and the entry of the sanctions log. Each one falls back to the usual message when the
// server has no template for it, or the template cannot be built.
const { EMOJI, TYPE_EMOJI } = require('./emojis');
const { buildSanctionDM } = require('./sanctionMessage');
const { buildCaseCard } = require('./caseCard');
const { templatePayload } = require('./templatedMessage');
const { sendAs } = require('./senderIdentity');
const senderIdentities = require('../db/senderIdentities');
const { templateFor } = require('../db/sanctionTemplates');
const { parseDuration } = require('./duration');
const { MessageFlags } = require('discord.js');
const logger = require('./logger');
const { t, currentLanguage, guildLanguage, languageOf } = require('../i18n');
const { displayReason } = require('./caseFormat');

// What `{case.action}` says for each sanction and `{case.source}` for who applied it, in the server's language.
const ACTION_TYPES = ['ban', 'hardban', 'tempban', 'softban', 'unban', 'kick', 'mute', 'tempmute', 'unmute', 'warn', 'jail', 'unjail'];
const SOURCE_TYPES = ['moderator', 'automod', 'honeypot', 'escalation', 'expiry', 'antinuke'];

/** `{case.action}` of a sanction type, like `temporarily muted`. */
function actionText(type, lang = currentLanguage()) {
  return t(lang, `moderation.template.action.${ACTION_TYPES.includes(type) ? type : 'unknown'}`);
}

/** `{case.source}`: who or what applied a sanction. Sources Petto does not name are shown as they are. */
function sourceText(source, lang = currentLanguage()) {
  return SOURCE_TYPES.includes(source) ? t(lang, `moderation.template.source.${source}`) : source;
}

/** The appeal link of a sanction for `{case.appeal}`, or null when there is none (appeals off, or a sanction that cannot be appealed). */
async function appealUrlOf(guildId, type) {
  try { return await require('./appeals').appealLinkFor(guildId, type); } catch { return null; }
}

function person(value) {
  if (!value) return null;
  const id = value.id ?? String(value);
  return {
    id,
    name: value.displayName ?? value.globalName ?? value.username ?? value.name ?? String(id),
    avatar: value.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? value.avatar ?? '',
  };
}

/**
 * The context a sanction template is built with. `user` is the sanctioned member, `moderator` who applied it (the bot
 * itself for the automatic ones). `durationText` is something like `2 hours`; `expiresAt` overrides what it gives.
 */
function sanctionContext({ type, guild, user, member = null, moderator, reason, durationText = null, expiresAt = null, caseNumber = null, source = 'moderator', channel = null, appealUrl = null, lang = currentLanguage() }) {
  const durationMs = durationText ? parseDuration(durationText) : null;
  const end = expiresAt ? new Date(expiresAt) : durationMs ? new Date(Date.now() + durationMs) : null;
  return {
    guild,
    member: member ?? undefined,
    user,
    channel: channel ?? undefined,
    sanction: {
      type,
      action: actionText(type, lang),
      emoji: TYPE_EMOJI[type] ?? EMOJI.ALERT ?? '',
      caseNumber,
      reason: displayReason(reason, lang) ?? '',
      durationText,
      expiresUnix: end && Number.isFinite(end.getTime()) ? Math.floor(end.getTime() / 1000) : null,
      source: sourceText(source, lang),
      moderator: person(moderator),
      target: person(user),
      appealUrl: appealUrl ?? '',
    },
  };
}

/**
 * What the sanctioned member is sent: the server's DM template when it has one, the usual text otherwise. Meant to go
 * straight into `.send(...)`, which takes either. Petto's own text is in the server's language.
 */
async function sanctionDM({ type, guild, client, reason, duration, user = null, member = null, moderator = null, source = 'moderator' }) {
  const lang = await guildLanguage(guild.id);
  let appealUrl = null;
  let appealNote = null;
  // The one place every sanction DM learns about appeals (the server chooses if and for which sanctions the link goes, and its own line).
  try { ({ url: appealUrl, note: appealNote } = await require('./appeals').appealDmFor(guild.id, type)); } catch { /* No appeal link: the sanction DM still goes out. */ }
  const fallback = () => buildSanctionDM({ type, guild, client, reason, duration, appealUrl, appealNote, lang });
  try {
    const name = await templateFor(guild.id, type, 'dm');
    if (!name) return fallback();
    const target = user ?? member?.user ?? null;
    const ctx = sanctionContext({ type, guild, user: target, member, moderator: moderator ?? client.user, reason, durationText: duration, source, appealUrl, lang });
    return (await templatePayload(guild.id, name, ctx)) ?? fallback();
  } catch (error) {
    logger.warn({ guildId: guild?.id, action: 'sanction-dm' }, `The sanction DM template failed: ${error.message}`);
    return fallback();
  }
}

/**
 * Answers the command that applied a sanction: the case card, or the server's own message. The reply was deferred as a
 * Components V2 message, which cannot hold an embed, so a custom message replaces it: the deferred reply is removed and
 * the message is sent as a follow-up (or posted in the channel when that fails).
 */
async function sanctionReply(interaction, { type, modCase, target, moderator, reason, duration }) {
  const lang = await languageOf(interaction);
  const card = () => buildCaseCard({ caseNumber: modCase.case_number, type, target, moderator, reason, duration, lang });
  const showCard = () => interaction.editReply({ components: [card()], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  let payload = null;
  try {
    const name = await templateFor(interaction.guild.id, type, 'reply');
    if (name) {
      const member = interaction.guild.members.cache.get(target.id) ?? null;
      const ctx = sanctionContext({ type, guild: interaction.guild, user: target, member, moderator, reason, durationText: duration, expiresAt: modCase.expires_at, caseNumber: modCase.case_number, channel: interaction.channel, appealUrl: await appealUrlOf(interaction.guild.id, type), lang });
      payload = await templatePayload(interaction.guild.id, name, ctx);
    }
  } catch (error) {
    logger.warn({ guildId: interaction.guild?.id, action: 'sanction-reply' }, `The sanction reply template failed: ${error.message}`);
  }
  if (!payload) return showCard();

  if (typeof interaction.deleteReply === 'function') {
    try {
      await interaction.deleteReply();
      // A server that gave its sanction messages their own name and picture gets them through its webhook instead of as a reply.
      const identity = interaction.channel && interaction.guild ? await senderIdentities.get(interaction.guild.id, 'sanctions').catch(() => null) : null;
      if (identity?.name || identity?.avatar_url) await sendAs(interaction.channel, 'sanctions', payload);
      else await interaction.followUp(payload);
      return undefined;
    } catch (error) {
      logger.warn({ guildId: interaction.guild?.id, action: 'sanction-reply' }, `The custom sanction reply could not be sent as a follow-up: ${error.message}`);
      try { if (interaction.channel) await sendAs(interaction.channel, 'sanctions', payload); return undefined; } catch { /* Fall through to nothing: the sanction itself is already done. */ }
      return undefined;
    }
  }
  return interaction.editReply(payload);
}

/** The embed of a sanctions log entry from the server's template, or null to keep the usual one. */
async function sanctionLogEmbed({ modCase, guild, target, moderator, reason, duration, source = 'moderator', lang = currentLanguage() }) {
  try {
    const name = await templateFor(guild.id, modCase.type, 'log');
    if (!name) return null;
    const member = guild.members.cache.get(target.id) ?? null;
    const ctx = sanctionContext({ type: modCase.type, guild, user: target, member, moderator, reason, durationText: duration, expiresAt: modCase.expires_at, caseNumber: modCase.case_number, source, appealUrl: await appealUrlOf(guild.id, modCase.type), lang });
    const payload = await templatePayload(guild.id, name, ctx);
    const embed = payload?.embeds?.[0];
    if (!embed) return null;
    const json = embed.toJSON();
    if (payload.content) json.description = json.description ? `${payload.content}\n${json.description}` : payload.content;
    return json;
  } catch (error) {
    logger.warn({ guildId: guild?.id, action: 'sanction-log' }, `The sanction log template failed: ${error.message}`);
    return null;
  }
}

module.exports = { actionText, sourceText, sanctionContext, sanctionDM, sanctionReply, sanctionLogEmbed };

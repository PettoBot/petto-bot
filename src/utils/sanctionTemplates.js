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

const ACTION = {
  ban: 'banned',
  hardban: 'hard banned',
  tempban: 'temporarily banned',
  softban: 'softbanned',
  unban: 'unbanned',
  kick: 'kicked',
  mute: 'muted',
  tempmute: 'temporarily muted',
  unmute: 'unmuted',
  warn: 'warned',
  jail: 'jailed',
  unjail: 'released from jail',
};

/** Who or what applied a sanction, for `{case.source}`. */
const SOURCES = { moderator: 'A moderator', automod: 'Automod', honeypot: 'The honeypot', escalation: 'Warn escalation', expiry: 'Automatic expiry', antinuke: 'Anti-nuke' };

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
function sanctionContext({ type, guild, user, member = null, moderator, reason, durationText = null, expiresAt = null, caseNumber = null, source = 'moderator', channel = null }) {
  const durationMs = durationText ? parseDuration(durationText) : null;
  const end = expiresAt ? new Date(expiresAt) : durationMs ? new Date(Date.now() + durationMs) : null;
  return {
    guild,
    member: member ?? undefined,
    user,
    channel: channel ?? undefined,
    sanction: {
      type,
      action: ACTION[type] ?? 'sanctioned',
      emoji: TYPE_EMOJI[type] ?? EMOJI.ALERT ?? '',
      caseNumber,
      reason: reason ?? '',
      durationText,
      expiresUnix: end && Number.isFinite(end.getTime()) ? Math.floor(end.getTime() / 1000) : null,
      source: SOURCES[source] ?? source,
      moderator: person(moderator),
      target: person(user),
    },
  };
}

/** How many sanctions the user had before this case, or null when that cannot be read. */
async function previousSanctions(guildId, userId, caseNumber) {
  try {
    const { getUserHistory } = require('../db/modActions');
    const rows = await getUserHistory(guildId, userId, { limit: 100 });
    return rows.filter((row) => row.case_number !== caseNumber && !['unban', 'unmute', 'unjail'].includes(row.type)).length;
  } catch {
    return null;
  }
}

/**
 * What the sanctioned member is sent: the server's DM template when it has one, the usual text otherwise. Meant to go
 * straight into `.send(...)`, which takes either.
 */
async function sanctionDM({ type, guild, client, reason, duration, user = null, member = null, moderator = null, source = 'moderator', caseNumber = null, expiresAt = null }) {
  const fallback = () => buildSanctionDM({ type, guild, reason, duration, moderator: moderator ?? client?.user, caseNumber, expiresAt });
  try {
    const name = await templateFor(guild.id, type, 'dm');
    if (!name) return fallback();
    const target = user ?? member?.user ?? null;
    const ctx = sanctionContext({ type, guild, user: target, member, moderator: moderator ?? client.user, reason, durationText: duration, source });
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
  const card = async () => buildCaseCard({
    caseNumber: modCase.case_number, type, target, moderator, reason, duration, guild: interaction.guild,
    expiresAt: modCase.expires_at, previous: await previousSanctions(interaction.guild.id, target.id, modCase.case_number),
  });
  const showCard = async () => interaction.editReply({ components: [await card()], flags: MessageFlags.IsComponentsV2 });
  let payload = null;
  try {
    const name = await templateFor(interaction.guild.id, type, 'reply');
    if (name) {
      const member = interaction.guild.members.cache.get(target.id) ?? null;
      const ctx = sanctionContext({ type, guild: interaction.guild, user: target, member, moderator, reason, durationText: duration, expiresAt: modCase.expires_at, caseNumber: modCase.case_number, channel: interaction.channel });
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
async function sanctionLogEmbed({ modCase, guild, target, moderator, reason, duration, source = 'moderator' }) {
  try {
    const name = await templateFor(guild.id, modCase.type, 'log');
    if (!name) return null;
    const member = guild.members.cache.get(target.id) ?? null;
    const ctx = sanctionContext({ type: modCase.type, guild, user: target, member, moderator, reason, durationText: duration, expiresAt: modCase.expires_at, caseNumber: modCase.case_number, source });
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

module.exports = { ACTION, sanctionContext, sanctionDM, sanctionReply, sanctionLogEmbed, previousSanctions };

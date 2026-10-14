const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const scamDb = require('../db/scamConfig');
const checks = require('./antiScamChecks');
const { ensureGuild } = require('../db/guilds');
const { createCase } = require('../db/modActions');
const { logSanction } = require('./caseLog');
const { textCard } = require('./caseCard');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const logger = require('./logger');

const PREFIX = 'scam';
const handled = new Map(); // `${guildId}:${userId}` -> until
const HANDLED_MS = 90_000;

const SIGNAL_TEXT = {
  'multi-channel': 'sent the same message in several channels in seconds',
  wording: 'sent a message with the usual scam wording',
  'new-account': 'is a new account that sent a picture or link with scam wording',
};

/** Is this message one more of a scam? Answers { signal, detail, channels, entries } or null. */
function detect(message, config, now = Date.now()) {
  const fps = checks.fingerprints(message);
  const hasAttachment = (message.attachments?.size ?? 0) > 0;
  const entry = { ts: now, channelId: message.channel.id, messageId: message.id, fps };
  const list = fps.length || hasAttachment || checks.hasLink(message.content) ? checks.remember(message.guild.id, message.author.id, entry) : [entry];

  const repeated = fps.length ? checks.repeatedAcrossChannels(list, entry, { threshold: config.channels_threshold, windowMs: config.window_seconds * 1000 }) : null;
  if (repeated) return { signal: 'multi-channel', detail: `the same message in ${repeated.channels} channels`, channels: repeated.channels, entries: repeated.entries };

  if (config.scan_text) {
    const verdict = checks.wordingVerdict(message.content, { hasAttachment });
    if (verdict.scam) return { signal: 'wording', detail: verdict.kinds.join(', '), channels: 1, entries: [entry] };
  }

  if (config.scan_new_accounts && (hasAttachment || checks.hasLink(message.content))) {
    const kinds = checks.wordingKinds(message.content);
    const ageHours = (now - message.author.createdTimestamp) / 3_600_000;
    const everyone = Boolean(message.mentions?.everyone);
    if (ageHours < config.new_account_hours && kinds.length + (everyone ? 1 : 0) >= 2) {
      return { signal: 'new-account', detail: `account ${Math.floor(ageHours)}h old${everyone ? ', pings everyone' : ''}`, channels: 1, entries: [entry] };
    }
  }
  return null;
}

function isExempt(message, config) {
  if (message.author.id === message.guild.ownerId) return true;
  if (config.exempt_channel_ids?.includes(message.channel.id) || config.exempt_channel_ids?.includes(message.channel.parentId)) return true;
  return Boolean(config.exempt_role_ids?.some((id) => message.member?.roles?.cache?.has(id)));
}

/** Takes down what the account sent in the last minutes, in every channel. Answers how many messages went. */
async function deleteRecent(guild, userId, entries, currentMessage) {
  const byChannel = new Map();
  for (const entry of entries) {
    if (!byChannel.has(entry.channelId)) byChannel.set(entry.channelId, new Set());
    byChannel.get(entry.channelId).add(entry.messageId);
  }
  if (currentMessage) {
    if (!byChannel.has(currentMessage.channel.id)) byChannel.set(currentMessage.channel.id, new Set());
    byChannel.get(currentMessage.channel.id).add(currentMessage.id);
  }
  let deleted = 0;
  for (const [channelId, ids] of byChannel) {
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel?.messages) continue;
    const list = [...ids];
    try {
      if (list.length === 1) await channel.messages.delete(list[0]);
      else await channel.bulkDelete(list, true);
      deleted += list.length;
    } catch (err) {
      logger.warn(`Anti scam: could not delete in ${channelId} of ${guild.id}: ${err.message}`);
    }
  }
  return deleted;
}

function dmCard(guild, action) {
  const outcome = action === 'ban' ? 'banned' : action === 'kick' ? 'removed' : action === 'timeout' ? 'muted for a while' : 'flagged';
  return textCard([
    `### ${EMOJI.ALERT} Your account may be hacked`,
    `You were ${outcome} in **${guild.name}** because your account sent messages that look like the MrBeast giveaway scam (a fake prize, a fake withdrawal or a casino promo). Scam accounts are usually real accounts that someone took over.`,
    '**What to do now:**',
    '1. Do not click the links you were sent.',
    '2. Change your password from a device you trust and turn on two-factor authentication.',
    '3. In Settings > Authorized Apps, remove what you do not know, and log out of all devices.',
    '4. Scan your computer for malware before you log in again.',
    '-# If this was a mistake, tell the server staff.',
  ].join('\n'), 0xffd563);
}

async function applyAction(message, config, detection) {
  const { guild, author, client } = message;
  const member = message.member;
  const reason = `Anti scam: ${SIGNAL_TEXT[detection.signal]}`;
  let outcome = 'Only alerted the staff.';
  let appliedAction = 'alert';

  if (config.action !== 'alert' && member) {
    if (config.dm_user) {
      await author.send({ components: [dmCard(guild, config.action)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
    try {
      await ensureGuild(guild.id);
      if (config.action === 'timeout') {
        if (!member.moderatable) throw new Error('not moderatable');
        await member.timeout(config.timeout_minutes * 60_000, reason);
        const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'tempmute', reason, expiresAt: new Date(Date.now() + config.timeout_minutes * 60_000).toISOString(), source: 'antiscam' });
        await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason, duration: `${config.timeout_minutes}m`, source: 'antiscam' });
        outcome = `Muted for ${config.timeout_minutes} minutes (case #${modCase.case_number}).`;
      } else if (config.action === 'kick') {
        if (!member.kickable) throw new Error('not kickable');
        await member.kick(reason);
        const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'kick', reason, source: 'antiscam' });
        await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason, source: 'antiscam' });
        outcome = `Kicked (case #${modCase.case_number}).`;
      } else if (config.action === 'ban') {
        if (!member.bannable) throw new Error('not bannable');
        await guild.members.ban(author.id, { reason, deleteMessageSeconds: Math.min(Math.max(config.delete_minutes, 1) * 60, 604_800) });
        const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'ban', reason, source: 'antiscam' });
        await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason, source: 'antiscam' });
        outcome = `Banned (case #${modCase.case_number}).`;
      }
      appliedAction = config.action;
    } catch (err) {
      logger.warn(`Anti scam: could not ${config.action} ${author.id} in ${guild.id}: ${err.message}`);
      outcome = `Could not ${config.action} the account (${err.message}). Check my permissions and my role position.`;
    }
  }
  return { outcome, appliedAction };
}

async function sendAlert(client, guild, config, { message, detection, outcome, deleted, appliedAction }) {
  const author = message.author;
  const text = [
    `### ${EMOJI.ALERT} Scam caught`,
    `<@${author.id}> (**${author.username}**, \`${author.id}\`) ${SIGNAL_TEXT[detection.signal]}.`,
    `**Why:** ${detection.detail}`,
    `**Messages taken down:** ${deleted}`,
    `**Action:** ${outcome}`,
    '-# Use the buttons if this was a mistake or it needs more.',
  ].join('\n');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}::undo::${author.id}::${appliedAction}`).setLabel('Undo').setStyle(ButtonStyle.Secondary).setDisabled(appliedAction === 'alert' || appliedAction === 'kick'),
    new ButtonBuilder().setCustomId(`${PREFIX}::ban::${author.id}::${appliedAction}`).setLabel('Ban').setStyle(ButtonStyle.Danger).setDisabled(appliedAction === 'ban'),
    new ButtonBuilder().setCustomId(`${PREFIX}::safe::${author.id}::${appliedAction}`).setLabel('Not a scam').setStyle(ButtonStyle.Success),
  );
  const ping = config.ping_role_id && guild.roles.cache.has(config.ping_role_id) ? `<@&${config.ping_role_id}>` : '';
  if (config.alert_channel_id) {
    const channel = await guild.channels.fetch(config.alert_channel_id).catch(() => null);
    if (channel?.isTextBased?.()) {
      const ok = await channel
        .send({ content: ping || undefined, components: [textCard(text, 0xff6b6b), row], flags: MessageFlags.IsComponentsV2, allowedMentions: { roles: ping ? [config.ping_role_id] : [] } })
        .then(() => true)
        .catch((err) => { logger.warn(`Anti scam: alert to ${config.alert_channel_id} failed: ${err.message}`); return false; });
      if (ok) return;
    }
  }
  await sendLog(client, guild.id, 'automod', { description: text, color: 0xff6b6b, timestamp: new Date().toISOString() }, { components: [row] }).catch((err) => logger.error('Anti scam: log failed:', err));
}

/** The message event of the anti scam. */
async function handleMessage(message) {
  if (!message.guild || message.author.bot || !message.member) return;
  const config = await scamDb.getConfig(message.guild.id);
  if (!config.enabled) return;
  if (isExempt(message, config)) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if ((handled.get(key) ?? 0) > now) {
    // Already answered: what the account keeps sending is only taken down, with no new alert.
    if (config.delete_messages) message.delete().catch(() => {});
    return;
  }

  const detection = detect(message, config);
  if (!detection) return;
  handled.set(key, now + HANDLED_MS);
  for (const [k, until] of handled) if (until <= now) handled.delete(k);

  const deleted = config.delete_messages ? await deleteRecent(message.guild, message.author.id, checks.recentEntries(message.guild.id, message.author.id, config.delete_minutes, now), message) : 0;
  checks.forget(message.guild.id, message.author.id);
  const { outcome, appliedAction } = await applyAction(message, config, detection);

  await scamDb.addEvent({
    guild_id: message.guild.id,
    user_id: message.author.id,
    user_name: message.author.username,
    signal: detection.signal,
    detail: detection.detail,
    channels: detection.channels,
    action: appliedAction,
    deleted,
  }).catch((err) => logger.error('Anti scam: could not save the event:', err));
  scamDb.countCaught(message.guild.id, config.caught);
  logger.warn(`Anti scam: ${detection.signal} by ${message.author.id} in ${message.guild.id} (${detection.detail}) -> ${appliedAction}`);
  await sendAlert(message.client, message.guild, config, { message, detection, outcome, deleted, appliedAction });
}

/** The buttons of the alert: `scam::undo|ban|safe::<user id>::<action taken>`. */
async function handleButton(interaction) {
  const [, kind, userId, taken] = interaction.customId.split('::');
  const guild = interaction.guild;
  if (!guild || !/^\d{15,25}$/.test(userId)) return;
  const needs = kind === 'ban' ? PermissionFlagsBits.BanMembers : taken === 'ban' ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.ModerateMembers;
  if (!interaction.member.permissions.has(needs)) {
    await interaction.reply({ content: 'You need the moderation permission for this button.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  let line;
  try {
    if (kind === 'ban') {
      await guild.members.ban(userId, { reason: `Anti scam: confirmed by ${interaction.user.username}`, deleteMessageSeconds: 3600 });
      line = `Banned by <@${interaction.user.id}>.`;
    } else {
      if (taken === 'timeout') {
        const member = await guild.members.fetch(userId).catch(() => null);
        await member?.timeout(null, `Anti scam: undone by ${interaction.user.username}`);
      } else if (taken === 'ban') {
        await guild.members.unban(userId, `Anti scam: undone by ${interaction.user.username}`);
      }
      line = kind === 'safe' ? `Marked as not a scam by <@${interaction.user.id}>.` : `Undone by <@${interaction.user.id}>.`;
    }
  } catch (err) {
    logger.warn(`Anti scam button ${kind} failed in ${guild.id}: ${err.message}`);
    line = `Could not do it (${err.message}).`;
  }
  // The alert stays, without its buttons, and says what was done.
  const cards = interaction.message.components.map((c) => c.toJSON()).filter((c) => c.type === 17);
  await interaction.editReply({ components: [...cards, textCard(line, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 }).catch((err) => logger.warn(`Anti scam: could not update the alert: ${err.message}`));
}

module.exports = { PREFIX, detect, handleMessage, handleButton, isExempt };

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
const { t, currentLanguage, languageOf } = require('../i18n');

const PREFIX = 'scam';
const handled = new Map(); // `${guildId}:${userId}` -> until
const HANDLED_MS = 90_000;

// What each signal says the account did (catalog key).
const SIGNAL_KEYS = { 'multi-channel': 'multiChannel', wording: 'wording', 'new-account': 'newAccount' };
const signalText = (signal, lang) => t(lang, `security.antiscam.signal.${SIGNAL_KEYS[signal]}`);

/** Is this message one more of a scam? Answers { signal, detail, channels, entries } or null. */
function detect(message, config, now = Date.now(), lang = currentLanguage()) {
  const fps = checks.fingerprints(message);
  const hasAttachment = (message.attachments?.size ?? 0) > 0;
  const entry = { ts: now, channelId: message.channel.id, messageId: message.id, fps };
  const list = fps.length || hasAttachment || checks.hasLink(message.content) ? checks.remember(message.guild.id, message.author.id, entry) : [entry];

  const repeated = fps.length ? checks.repeatedAcrossChannels(list, entry, { threshold: config.channels_threshold, windowMs: config.window_seconds * 1000 }) : null;
  if (repeated) return { signal: 'multi-channel', detail: t(lang, 'security.antiscam.detail.multiChannel', { count: repeated.channels }), channels: repeated.channels, entries: repeated.entries };

  if (config.scan_text) {
    const verdict = checks.wordingVerdict(message.content, { hasAttachment });
    if (verdict.scam) return { signal: 'wording', detail: verdict.kinds.map((kind) => t(lang, `security.antiscam.kind.${kind}`)).join(', '), channels: 1, entries: [entry] };
  }

  if (config.scan_new_accounts && (hasAttachment || checks.hasLink(message.content))) {
    const kinds = checks.wordingKinds(message.content);
    const ageHours = (now - message.author.createdTimestamp) / 3_600_000;
    const everyone = Boolean(message.mentions?.everyone);
    if (ageHours < config.new_account_hours && kinds.length + (everyone ? 1 : 0) >= 2) {
      const detail = t(lang, everyone ? 'security.antiscam.detail.newAccountEveryone' : 'security.antiscam.detail.newAccount', { hours: Math.floor(ageHours) });
      return { signal: 'new-account', detail, channels: 1, entries: [entry] };
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

// The DM says what happened to the account; `flagged` is for an action the server has not chosen.
const DM_OUTCOMES = { ban: 'banned', kick: 'kicked', timeout: 'muted' };

function dmCard(guild, action, lang = currentLanguage()) {
  return textCard([
    t(lang, 'security.antiscam.dm.title', { emoji: EMOJI.ALERT }),
    t(lang, `security.antiscam.dm.outcome.${DM_OUTCOMES[action] ?? 'flagged'}`, { server: guild.name }),
    t(lang, 'security.antiscam.dm.steps'),
  ].join('\n'), 0xffd563);
}

// The reasons Petto gives itself when it cannot act on the account (the staff reads them in the alert). i18n-ignore: matched
const BLOCKED_KEYS = { 'not moderatable': 'notModeratable', 'not kickable': 'notKickable', 'not bannable': 'notBannable' };

async function applyAction(message, config, detection, lang = currentLanguage()) {
  const { guild, author, client } = message;
  const member = message.member;
  const reason = t(lang, 'security.antiscam.reason', { signal: signalText(detection.signal, lang) });
  let outcome = t(lang, 'security.antiscam.outcome.alert');
  let appliedAction = 'alert';

  if (config.action !== 'alert' && member) {
    if (config.dm_user) {
      await author.send({ components: [dmCard(guild, config.action, lang)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
    try {
      await ensureGuild(guild.id);
      if (config.action === 'timeout') {
        if (!member.moderatable) throw new Error('not moderatable'); // i18n-ignore: matched in BLOCKED_KEYS
        await member.timeout(config.timeout_minutes * 60_000, reason);
        const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'tempmute', reason, expiresAt: new Date(Date.now() + config.timeout_minutes * 60_000).toISOString(), source: 'antiscam' });
        await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason, duration: `${config.timeout_minutes}m`, source: 'antiscam' });
        outcome = t(lang, 'security.antiscam.outcome.timeout', { minutes: config.timeout_minutes, case: modCase.case_number });
      } else if (config.action === 'kick') {
        if (!member.kickable) throw new Error('not kickable'); // i18n-ignore: matched in BLOCKED_KEYS
        await member.kick(reason);
        const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'kick', reason, source: 'antiscam' });
        await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason, source: 'antiscam' });
        outcome = t(lang, 'security.antiscam.outcome.kick', { case: modCase.case_number });
      } else if (config.action === 'ban') {
        if (!member.bannable) throw new Error('not bannable'); // i18n-ignore: matched in BLOCKED_KEYS
        await guild.members.ban(author.id, { reason, deleteMessageSeconds: Math.min(Math.max(config.delete_minutes, 1) * 60, 604_800) });
        const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'ban', reason, source: 'antiscam' });
        await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason, source: 'antiscam' });
        outcome = t(lang, 'security.antiscam.outcome.ban', { case: modCase.case_number });
      }
      appliedAction = config.action;
    } catch (err) {
      logger.warn(`Anti scam: could not ${config.action} ${author.id} in ${guild.id}: ${err.message}`);
      const why = BLOCKED_KEYS[err.message] ? t(lang, `security.antiscam.blocked.${BLOCKED_KEYS[err.message]}`) : err.message;
      outcome = t(lang, `security.antiscam.outcome.failed.${config.action}`, { error: why });
    }
  }
  return { outcome, appliedAction };
}

async function sendAlert(client, guild, config, { message, detection, outcome, deleted, appliedAction }, lang = currentLanguage()) {
  const author = message.author;
  const text = t(lang, 'security.antiscam.alert.text', {
    emoji: EMOJI.ALERT,
    user: `<@${author.id}>`,
    username: author.username,
    userId: author.id,
    signal: signalText(detection.signal, lang),
    detail: detection.detail,
    deleted,
    outcome,
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}::undo::${author.id}::${appliedAction}`).setLabel(t(lang, 'security.antiscam.alert.undo.button')).setStyle(ButtonStyle.Secondary).setDisabled(appliedAction === 'alert' || appliedAction === 'kick'),
    new ButtonBuilder().setCustomId(`${PREFIX}::ban::${author.id}::${appliedAction}`).setLabel(t(lang, 'security.antiscam.alert.ban.button')).setStyle(ButtonStyle.Danger).setDisabled(appliedAction === 'ban'),
    new ButtonBuilder().setCustomId(`${PREFIX}::safe::${author.id}::${appliedAction}`).setLabel(t(lang, 'security.antiscam.alert.safe.button')).setStyle(ButtonStyle.Success),
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
  const lang = currentLanguage();
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

  const detection = detect(message, config, Date.now(), lang);
  if (!detection) return;
  handled.set(key, now + HANDLED_MS);
  for (const [k, until] of handled) if (until <= now) handled.delete(k);

  const deleted = config.delete_messages ? await deleteRecent(message.guild, message.author.id, checks.recentEntries(message.guild.id, message.author.id, config.delete_minutes, now), message) : 0;
  checks.forget(message.guild.id, message.author.id);
  const { outcome, appliedAction } = await applyAction(message, config, detection, lang);

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
  await sendAlert(message.client, message.guild, config, { message, detection, outcome, deleted, appliedAction }, lang);
}

/** The buttons of the alert: `scam::undo|ban|safe::<user id>::<action taken>`. */
async function handleButton(interaction) {
  const [, kind, userId, taken] = interaction.customId.split('::');
  const guild = interaction.guild;
  if (!guild || !/^\d{15,25}$/.test(userId)) return;
  const lang = await languageOf(interaction);
  const needs = kind === 'ban' ? PermissionFlagsBits.BanMembers : taken === 'ban' ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.ModerateMembers;
  if (!interaction.member.permissions.has(needs)) {
    await interaction.reply({ content: t(lang, 'security.antiscam.button.noPermission'), flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  let line;
  try {
    if (kind === 'ban') {
      await guild.members.ban(userId, { reason: t(lang, 'security.antiscam.audit.confirmed', { name: interaction.user.username }), deleteMessageSeconds: 3600 });
      line = t(lang, 'security.antiscam.button.banned', { user: `<@${interaction.user.id}>` });
    } else {
      if (taken === 'timeout') {
        const member = await guild.members.fetch(userId).catch(() => null);
        await member?.timeout(null, t(lang, 'security.antiscam.audit.undone', { name: interaction.user.username }));
      } else if (taken === 'ban') {
        await guild.members.unban(userId, t(lang, 'security.antiscam.audit.undone', { name: interaction.user.username }));
      }
      line = t(lang, kind === 'safe' ? 'security.antiscam.button.safe' : 'security.antiscam.button.undone', { user: `<@${interaction.user.id}>` });
    }
  } catch (err) {
    logger.warn(`Anti scam button ${kind} failed in ${guild.id}: ${err.message}`);
    line = t(lang, 'security.antiscam.button.failed', { error: err.message });
  }
  // The alert stays, without its buttons, and says what was done.
  const cards = interaction.message.components.map((c) => c.toJSON()).filter((c) => c.type === 17);
  await interaction.editReply({ components: [...cards, textCard(line, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 }).catch((err) => logger.warn(`Anti scam: could not update the alert: ${err.message}`));
}

module.exports = { PREFIX, detect, handleMessage, handleButton, isExempt };

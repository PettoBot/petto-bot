const { ChannelType, GuildVerificationLevel, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../db/lockdown');
const { ensureGuild, updateGuild } = require('../db/guilds');
const { textCard } = require('./caseCard');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const logger = require('./logger');
const { t, tn, currentLanguage, guildLanguage } = require('../i18n');

const LOCKED = { SendMessages: false, SendMessagesInThreads: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false };
const KEYS = Object.keys(LOCKED);
const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia];

function userError(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

/** What @everyone had for a permission in a channel: true, false, or null for "not set". */
function stateOf(channel, everyoneId) {
  const overwrite = channel.permissionOverwrites?.cache?.get(everyoneId);
  const state = {};
  for (const key of KEYS) {
    const flag = PermissionFlagsBits[key];
    state[key] = overwrite?.allow?.has(flag) ? true : overwrite?.deny?.has(flag) ? false : null;
  }
  return state;
}

/** The channels a lockdown closes: the ones the server chose, or every text channel. */
function targetChannels(guild, config) {
  const chosen = new Set(config.channel_ids ?? []);
  return [...guild.channels.cache.values()].filter((c) => TEXT_TYPES.includes(c.type) && (chosen.size === 0 || chosen.has(c.id)));
}

/**
 * Starts a lockdown (`pauseInvites` true or false overrides the setting of the server for this one). Answers { locked, failed, invitesDeleted }. Errors are in the language of the command that asked for it;
 * the notice, the log and the audit log are in the server's language.
 */
async function startLockdown(guild, { startedBy, reason = null, minutes = null, pauseInvites = null }) {
  const askedLang = currentLanguage();
  if (await db.getActive(guild.id)) throw userError(t(askedLang, 'moderation.lockdown.error.alreadyOn'));
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels) && !me?.permissions.has(PermissionFlagsBits.Administrator)) throw userError(t(askedLang, 'moderation.lockdown.error.needsManageChannels'));
  const lang = await guildLanguage(guild.id);
  await ensureGuild(guild.id);
  const config = await db.getConfig(guild.id);

  const locked = [];
  let failed = 0;
  for (const channel of targetChannels(guild, config)) {
    const previous = stateOf(channel, guild.id);
    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, LOCKED, { reason: t(lang, 'moderation.lockdown.audit.startedBy', { user: startedBy }) });
      locked.push({ id: channel.id, previous });
    } catch (err) {
      failed += 1;
      logger.warn(`Lockdown: could not close ${channel.id} in ${guild.id}: ${err.message}`);
    }
  }

  let previousLevel = null;
  if (config.raise_verification && me.permissions.has(PermissionFlagsBits.ManageGuild) && guild.verificationLevel < GuildVerificationLevel.High) {
    previousLevel = guild.verificationLevel;
    await guild.setVerificationLevel(GuildVerificationLevel.High, t(lang, 'moderation.lockdown.audit.lockdown')).catch((err) => { previousLevel = null; logger.warn(`Lockdown: verification not raised in ${guild.id}: ${err.message}`); });
  }

  let invitesDeleted = 0;
  let invitesPaused = false;
  // The panic mode of the anti-nuke always pauses the invites; a lockdown started by hand follows the setting.
  if ((pauseInvites ?? config.pause_invites) && me.permissions.has(PermissionFlagsBits.ManageGuild)) {
    const minutesForInvites = minutes || config.auto_end_minutes || 24 * 60;
    await updateGuild(guild.id, { invites_paused_until: new Date(Date.now() + minutesForInvites * 60_000).toISOString() }).catch(() => {});
    invitesPaused = true;
    const invites = await guild.invites.fetch().catch(() => null);
    for (const invite of invites?.values() ?? []) {
      await invite.delete(t(lang, 'moderation.lockdown.audit.lockdown')).then(() => { invitesDeleted += 1; }).catch(() => {});
    }
  }

  const duration = minutes || config.auto_end_minutes || 0;
  await db.saveActive({
    guild_id: guild.id,
    started_by: startedBy,
    reason,
    started_at: new Date().toISOString(),
    ends_at: duration ? new Date(Date.now() + duration * 60_000).toISOString() : null,
    locked,
    previous_level: previousLevel,
    invites_paused: invitesPaused,
  });

  const notice = config.message || t(lang, 'moderation.lockdown.defaultMessage');
  const announce = config.announce_channel_id ? guild.channels.cache.get(config.announce_channel_id) : null;
  const noticeText = [t(lang, 'moderation.lockdown.notice.title', { emoji: EMOJI.ALERT }), notice, ...(reason ? [t(lang, 'moderation.lockdown.notice.reason', { reason })] : [])].join('\n');
  await announce?.send?.({ components: [textCard(noticeText, 0xff6b6b)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  const startedLog = [
    t(lang, reason ? 'moderation.lockdown.log.startedReason' : 'moderation.lockdown.log.started', { emoji: EMOJI.ALERT, user: `<@${startedBy}>`, reason }),
    tn(lang, 'moderation.lockdown.log.closed', locked.length, { count: locked.length }),
    failed ? t(lang, 'moderation.lockdown.log.failedClose', { count: failed }) : '',
    invitesPaused ? t(lang, 'moderation.lockdown.log.invitesPaused', { count: invitesDeleted }) : '',
    duration ? tn(lang, 'moderation.lockdown.log.endsIn', duration, { count: duration }) : t(lang, 'moderation.lockdown.log.staysOn'),
  ].join('');
  await sendLog(guild.client, guild.id, 'automod', {
    author: { name: t(lang, 'moderation.lockdown.log.startedTitle') },
    description: startedLog,
    color: 0xff6b6b,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
  return { locked: locked.length, failed, invitesDeleted, endsInMinutes: duration || null };
}

/** Ends the lockdown and puts every channel, the invites and the verification back as they were. */
async function endLockdown(guild, { endedBy = null } = {}) {
  const active = await db.getActive(guild.id);
  if (!active) throw userError(t(currentLanguage(), 'moderation.lockdown.error.notOn'));
  const lang = await guildLanguage(guild.id);
  let restored = 0;
  let failed = 0;
  for (const item of active.locked ?? []) {
    const channel = guild.channels.cache.get(item.id);
    if (!channel) continue;
    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, item.previous ?? Object.fromEntries(KEYS.map((k) => [k, null])), { reason: endedBy ? t(lang, 'moderation.lockdown.audit.endedBy', { user: endedBy }) : t(lang, 'moderation.lockdown.audit.ended') });
      restored += 1;
    } catch (err) {
      failed += 1;
      logger.warn(`Lockdown: could not reopen ${item.id} in ${guild.id}: ${err.message}`);
    }
  }
  if (active.previous_level !== null && active.previous_level !== undefined) await guild.setVerificationLevel(active.previous_level, t(lang, 'moderation.lockdown.audit.ended')).catch(() => {});
  if (active.invites_paused) await updateGuild(guild.id, { invites_paused_until: null }).catch(() => {});
  await db.clearActive(guild.id);
  await sendLog(guild.client, guild.id, 'automod', {
    author: { name: t(lang, 'moderation.lockdown.log.endedTitle') },
    description: [
      endedBy ? t(lang, 'moderation.lockdown.log.endedBy', { emoji: EMOJI.APPROVE, user: `<@${endedBy}>` }) : t(lang, 'moderation.lockdown.log.endedTime', { emoji: EMOJI.APPROVE }),
      tn(lang, 'moderation.lockdown.log.reopened', restored, { count: restored }),
      failed ? t(lang, 'moderation.lockdown.log.failedReopen', { count: failed }) : '',
      '.',
    ].join(''),
    color: 0xa5ea7a,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
  return { restored, failed };
}

module.exports = { LOCKED, stateOf, targetChannels, startLockdown, endLockdown };

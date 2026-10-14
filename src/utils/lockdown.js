const { ChannelType, GuildVerificationLevel, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../db/lockdown');
const { ensureGuild, updateGuild } = require('../db/guilds');
const { textCard } = require('./caseCard');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const logger = require('./logger');

const LOCKED = { SendMessages: false, SendMessagesInThreads: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false };
const KEYS = Object.keys(LOCKED);
const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia];
const DEFAULT_MESSAGE = 'This server is in lockdown for a moment. The staff is working on it, thank you for waiting.';

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

/** Starts a lockdown. Answers { locked, failed, invitesDeleted }. */
async function startLockdown(guild, { startedBy, reason = null, minutes = null }) {
  if (await db.getActive(guild.id)) throw userError('A lockdown is already on. End it first.');
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels) && !me?.permissions.has(PermissionFlagsBits.Administrator)) throw userError('I need the Manage Channels permission to close the channels.');
  await ensureGuild(guild.id);
  const config = await db.getConfig(guild.id);

  const locked = [];
  let failed = 0;
  for (const channel of targetChannels(guild, config)) {
    const previous = stateOf(channel, guild.id);
    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, LOCKED, { reason: `Lockdown started by ${startedBy}` });
      locked.push({ id: channel.id, previous });
    } catch (err) {
      failed += 1;
      logger.warn(`Lockdown: could not close ${channel.id} in ${guild.id}: ${err.message}`);
    }
  }

  let previousLevel = null;
  if (config.raise_verification && me.permissions.has(PermissionFlagsBits.ManageGuild) && guild.verificationLevel < GuildVerificationLevel.High) {
    previousLevel = guild.verificationLevel;
    await guild.setVerificationLevel(GuildVerificationLevel.High, 'Lockdown').catch((err) => { previousLevel = null; logger.warn(`Lockdown: verification not raised in ${guild.id}: ${err.message}`); });
  }

  let invitesDeleted = 0;
  let invitesPaused = false;
  if (config.pause_invites && me.permissions.has(PermissionFlagsBits.ManageGuild)) {
    const minutesForInvites = minutes || config.auto_end_minutes || 24 * 60;
    await updateGuild(guild.id, { invites_paused_until: new Date(Date.now() + minutesForInvites * 60_000).toISOString() }).catch(() => {});
    invitesPaused = true;
    const invites = await guild.invites.fetch().catch(() => null);
    for (const invite of invites?.values() ?? []) {
      await invite.delete('Lockdown').then(() => { invitesDeleted += 1; }).catch(() => {});
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

  const notice = config.message || DEFAULT_MESSAGE;
  const announce = config.announce_channel_id ? guild.channels.cache.get(config.announce_channel_id) : null;
  await announce?.send?.({ components: [textCard(`### ${EMOJI.ALERT} Lockdown\n${notice}${reason ? `\n**Reason:** ${reason}` : ''}`, 0xff6b6b)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  await sendLog(guild.client, guild.id, 'automod', {
    author: { name: 'Lockdown started' },
    description: `${EMOJI.ALERT} Lockdown started by <@${startedBy}>${reason ? `: ${reason}` : ''}. **${locked.length}** channel(s) closed${failed ? `, ${failed} could not be` : ''}${invitesPaused ? `, invites paused (${invitesDeleted} deleted)` : ''}${duration ? `. Ends in ${duration} minutes.` : '. It stays until someone ends it.'}`,
    color: 0xff6b6b,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
  return { locked: locked.length, failed, invitesDeleted, endsInMinutes: duration || null };
}

/** Ends the lockdown and puts every channel, the invites and the verification back as they were. */
async function endLockdown(guild, { endedBy = null } = {}) {
  const active = await db.getActive(guild.id);
  if (!active) throw userError('There is no lockdown on.');
  let restored = 0;
  let failed = 0;
  for (const item of active.locked ?? []) {
    const channel = guild.channels.cache.get(item.id);
    if (!channel) continue;
    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, item.previous ?? Object.fromEntries(KEYS.map((k) => [k, null])), { reason: `Lockdown ended${endedBy ? ` by ${endedBy}` : ''}` });
      restored += 1;
    } catch (err) {
      failed += 1;
      logger.warn(`Lockdown: could not reopen ${item.id} in ${guild.id}: ${err.message}`);
    }
  }
  if (active.previous_level !== null && active.previous_level !== undefined) await guild.setVerificationLevel(active.previous_level, 'Lockdown ended').catch(() => {});
  if (active.invites_paused) await updateGuild(guild.id, { invites_paused_until: null }).catch(() => {});
  await db.clearActive(guild.id);
  await sendLog(guild.client, guild.id, 'automod', {
    author: { name: 'Lockdown ended' },
    description: `${EMOJI.APPROVE} Lockdown ended${endedBy ? ` by <@${endedBy}>` : ' (the time was up)'}. **${restored}** channel(s) reopened${failed ? `, ${failed} could not be` : ''}.`,
    color: 0xa5ea7a,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
  return { restored, failed };
}

module.exports = { LOCKED, DEFAULT_MESSAGE, stateOf, targetChannels, startLockdown, endLockdown };

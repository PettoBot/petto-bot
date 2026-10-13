// What the dashboard asks the bot to do for the verification, right away and without the wait of the panel job (it checks every two
// minutes): switch it on or off, post the panel now, or set everything up (the roles, the channel and the panel) in one press.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getConfig, upsertConfig } = require('../db/verificationConfig');
const { ensureGuild } = require('../db/guilds');
const { ensureUnverifiedRole } = require('./verifyRole');
const { postPanel } = require('./verifyPanel');

const NEEDS_ROLES = 'I need the Manage Roles permission.';
const NEEDS_CHANNELS = 'I need the Manage Channels permission to make the channel.';

const hasPermission = (guild, flag) => guild.members.me?.permissions.has(flag);

/** Switches the verification on or off. Turning it on makes sure the gate role exists. */
async function setEnabled(guild, enabled) {
  await ensureGuild(guild.id);
  if (enabled && !hasPermission(guild, PermissionFlagsBits.ManageRoles)) return { ok: false, message: NEEDS_ROLES };
  const settings = await upsertConfig(guild.id, { enabled });
  if (enabled) {
    try { await ensureUnverifiedRole(guild, settings ?? {}); } catch (err) { return { ok: false, message: `It is on, but the gate role could not be made: ${err.message}` }; }
  }
  return { ok: true, message: enabled ? 'Verification is on.' : 'Verification is off.' };
}

/** Posts the panel of the chosen channel now. */
async function sendPanelNow(guild) {
  const settings = (await getConfig(guild.id)) ?? {};
  if (!settings.panel_channel_id) return { ok: false, message: 'Pick a verification channel first.' };
  const channel = await guild.channels.fetch(settings.panel_channel_id).catch(() => null);
  try {
    await postPanel(guild, settings, channel);
    return { ok: true, message: `The panel is in #${channel.name}.` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/**
 * Sets the verification up from nothing: the gate role (and the one for who passes), a channel to verify in if none was chosen, the
 * panel in it, and the verification on. What the server already picked is kept.
 */
async function setupEverything(guild) {
  await ensureGuild(guild.id);
  if (!hasPermission(guild, PermissionFlagsBits.ManageRoles)) return { ok: false, message: NEEDS_ROLES };
  let settings = (await getConfig(guild.id)) ?? {};
  const made = [];
  try {
    if (!settings.verified_role_id || !guild.roles.cache.has(settings.verified_role_id)) {
      const role = await guild.roles.create({ name: 'Verified', color: 0x57f287, permissions: [], reason: 'Petto: verification set up from the dashboard' });
      settings = (await upsertConfig(guild.id, { verified_role_id: role.id })) ?? { ...settings, verified_role_id: role.id };
      made.push(`the role @${role.name}`);
    }
    const gate = await ensureUnverifiedRole(guild, settings);
    if (!settings.unverified_role_id) made.push(`the role @${gate.name}`);
    let channel = settings.panel_channel_id ? await guild.channels.fetch(settings.panel_channel_id).catch(() => null) : null;
    if (!channel) {
      if (!hasPermission(guild, PermissionFlagsBits.ManageChannels)) return { ok: false, message: NEEDS_CHANNELS };
      channel = await guild.channels.create({
        name: 'verify',
        type: ChannelType.GuildText,
        topic: 'Press a button to verify and get access to the rest of the server.',
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] }],
        reason: 'Petto: verification set up from the dashboard',
      });
      made.push(`the channel #${channel.name}`);
    }
    settings = (await upsertConfig(guild.id, { enabled: true, panel_channel_id: channel.id })) ?? { ...settings, enabled: true, panel_channel_id: channel.id };
    await postPanel(guild, settings, channel);
    return { ok: true, message: `Verification is ready${made.length ? `: I made ${made.join(', ')} and` : ' and I'} posted the panel in #${channel.name}.` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { setEnabled, sendPanelNow, setupEverything };

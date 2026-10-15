// What the dashboard asks the bot to do for the verification, right away and without the wait of the panel job (it checks every two
// minutes): switch it on or off, post the panel now, or set everything up (the roles, the channel and the panel) in one press.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getConfig, upsertConfig } = require('../db/verificationConfig');
const { ensureGuild } = require('../db/guilds');
const { ensureUnverifiedRole } = require('./verifyRole');
const { postPanel } = require('./verifyPanel');
const { t, guildLanguage } = require('../i18n');

const hasPermission = (guild, flag) => guild.members.me?.permissions.has(flag);

// The dashboard shows these messages as they are, so they are in the language of the server.

/** Switches the verification on or off. Turning it on makes sure the gate role exists. */
async function setEnabled(guild, enabled) {
  await ensureGuild(guild.id);
  const lang = await guildLanguage(guild.id);
  if (enabled && !hasPermission(guild, PermissionFlagsBits.ManageRoles)) return { ok: false, message: t(lang, 'verify.provision.needRoles') };
  const settings = await upsertConfig(guild.id, { enabled });
  if (enabled) {
    try { await ensureUnverifiedRole(guild, settings ?? {}); } catch (err) { return { ok: false, message: t(lang, 'verify.provision.gateFailed', { error: err.message }) }; }
  }
  return { ok: true, message: t(lang, enabled ? 'verify.provision.on' : 'verify.provision.off') };
}

/** Posts the panel of the chosen channel now. */
async function sendPanelNow(guild) {
  const settings = (await getConfig(guild.id)) ?? {};
  const lang = await guildLanguage(guild.id);
  if (!settings.panel_channel_id) return { ok: false, message: t(lang, 'verify.provision.pickChannel') };
  const channel = await guild.channels.fetch(settings.panel_channel_id).catch(() => null);
  try {
    await postPanel(guild, settings, channel);
    return { ok: true, message: t(lang, 'verify.provision.panelIn', { channel: channel.name }) };
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
  const lang = await guildLanguage(guild.id);
  if (!hasPermission(guild, PermissionFlagsBits.ManageRoles)) return { ok: false, message: t(lang, 'verify.provision.needRoles') };
  let settings = (await getConfig(guild.id)) ?? {};
  const made = [];
  try {
    if (!settings.verified_role_id || !guild.roles.cache.has(settings.verified_role_id)) {
      const role = await guild.roles.create({ name: t(lang, 'verify.role.verified'), color: 0x57f287, permissions: [], reason: t(lang, 'verify.reason.dashboard') });
      settings = (await upsertConfig(guild.id, { verified_role_id: role.id })) ?? { ...settings, verified_role_id: role.id };
      made.push(t(lang, 'verify.provision.madeRole', { name: role.name }));
    }
    const gate = await ensureUnverifiedRole(guild, settings);
    if (!settings.unverified_role_id) made.push(t(lang, 'verify.provision.madeRole', { name: gate.name }));
    let channel = settings.panel_channel_id ? await guild.channels.fetch(settings.panel_channel_id).catch(() => null) : null;
    if (!channel) {
      if (!hasPermission(guild, PermissionFlagsBits.ManageChannels)) return { ok: false, message: t(lang, 'verify.provision.needChannels') };
      channel = await guild.channels.create({
        name: t(lang, 'verify.provision.channelName'),
        type: ChannelType.GuildText,
        topic: t(lang, 'verify.provision.channelTopic'),
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] }],
        reason: t(lang, 'verify.reason.dashboard'),
      });
      made.push(t(lang, 'verify.provision.madeChannel', { name: channel.name }));
    }
    settings = (await upsertConfig(guild.id, { enabled: true, panel_channel_id: channel.id })) ?? { ...settings, enabled: true, panel_channel_id: channel.id };
    await postPanel(guild, settings, channel);
    return { ok: true, message: made.length ? t(lang, 'verify.provision.readyMade', { made: made.join(', '), channel: channel.name }) : t(lang, 'verify.provision.ready', { channel: channel.name }) };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { setEnabled, sendPanelNow, setupEverything };

const { ChannelType } = require('discord.js');
const { updateGuild } = require('../db/guilds');
const logger = require('./logger');
const { t, guildLanguage } = require('../i18n');

/**
 * Discord's native timeout caps at 28 days, so an indefinite /mute needs a role
 * instead. Returns the guild's configured mute role, creating one (and denying
 * it Send Messages / Add Reactions / Speak in every channel) the first time
 * it's needed, since there's no /config command yet to set one up by hand.
 */
async function ensureMuteRole(guild, guildConfig) {
  if (guildConfig.mute_role_id) {
    const existing = guild.roles.cache.get(guildConfig.mute_role_id);
    if (existing) return existing;
  }

  // The role and the audit log are named in the server's language: it is created once and stays.
  const lang = await guildLanguage(guild.id);
  const role = await guild.roles.create({
    name: t(lang, 'moderation.muteRole.name'),
    color: 0x2b2d31,
    permissions: [],
    reason: t(lang, 'moderation.muteRole.audit.created'),
  });

  const overwrite = {
    SendMessages: false,
    SendMessagesInThreads: false,
    AddReactions: false,
    Speak: false,
    Stream: false,
    RequestToSpeak: false,
  };

  for (const channel of guild.channels.cache.values()) {
    if (![ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice].includes(channel.type)) continue;
    await channel.permissionOverwrites.edit(role, overwrite, { reason: t(lang, 'moderation.muteRole.audit.setup') }).catch((err) => {
      logger.warn(`Could not set mute overwrite in #${channel.name} (${channel.id}):`, err.message);
    });
  }

  await updateGuild(guild.id, { mute_role_id: role.id });
  return role;
}

module.exports = { ensureMuteRole };

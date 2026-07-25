const { ChannelType } = require('discord.js');
const { upsertConfig } = require('../db/verificationConfig');
const logger = require('./logger');

/**
 * Returns the guild's "Unverified" role, creating one (and denying it View
 * Channel everywhere) the first time /verify is set up. New members get this
 * role on join and lose it once they pass the Turnstile check, so no separate
 * "Verified" role — or any pre-existing channel permission setup — is required.
 */
async function ensureUnverifiedRole(guild, verifyConfig) {
  if (verifyConfig.unverified_role_id) {
    const existing = guild.roles.cache.get(verifyConfig.unverified_role_id);
    if (existing) return existing;
  }

  const role = await guild.roles.create({
    name: 'Unverified',
    color: 0x2b2d31,
    permissions: [],
    reason: 'Petto: auto-created verification gate role',
  });

  for (const channel of guild.channels.cache.values()) {
    if (![ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice, ChannelType.GuildCategory].includes(channel.type)) continue;
    await channel.permissionOverwrites.edit(role, { ViewChannel: false }, { reason: 'Petto: verification gate setup' }).catch((err) => {
      logger.warn(`Could not set verification overwrite in #${channel.name} (${channel.id}):`, err.message);
    });
  }

  await upsertConfig(guild.id, { unverified_role_id: role.id });
  return role;
}

module.exports = { ensureUnverifiedRole };

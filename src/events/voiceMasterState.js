const { Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const voiceDb = require('../db/voiceMaster');
const logger = require('../utils/logger');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    const guild = newState.guild ?? oldState.guild;
    const member = newState.member ?? oldState.member;
    if (!guild || !member || member.user.bot) return;
    try {
      const config = await voiceDb.getConfig(guild.id);
      if (!config) return;
      if (newState.channelId === config.creator_channel_id && newState.channelId !== oldState.channelId) {
        const creator = guild.channels.cache.get(config.creator_channel_id);
        const name = renderName(config.default_name, member);
        const parent = await resolveParentCategory(guild, config.category_id, creator?.parentId);
        const channel = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: parent?.id ?? null, userLimit: config.default_limit || 0, permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.Connect] }, { id: member.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] }] });
        if (config.category_id !== (parent?.id ?? null)) {
          await voiceDb.upsertConfig(guild.id, { category_id: parent?.id ?? null }).catch((err) => {
            logger.warn(`Could not repair VoiceMaster category for guild ${guild.id}:`, err.message);
          });
        }
        await voiceDb.createTemp({ guild_id: guild.id, channel_id: channel.id, owner_id: member.id, trusted_user_ids: [], banned_user_ids: [], is_locked: false, is_ghosted: false, user_limit: config.default_limit || 0 });
        await member.voice.setChannel(channel).catch(() => {});
      }
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const temp = await voiceDb.getTemp(oldState.channelId);
        const oldChannel = guild.channels.cache.get(oldState.channelId);
        if (temp && (!oldChannel || oldChannel.members.filter((m) => !m.user.bot).size === 0)) {
          await oldChannel?.delete().catch(() => {});
          await voiceDb.removeTemp(oldState.channelId);
        }
      }
    } catch (err) {
      logger.error('VoiceMaster state update failed:', err);
    }
  },
};

async function resolveParentCategory(guild, configuredId, creatorParentId) {
  const candidateIds = [...new Set([configuredId, creatorParentId].filter(Boolean))];
  for (const id of candidateIds) {
    const channel = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
    if (channel?.type === ChannelType.GuildCategory) return channel;
  }

  if (configuredId) {
    logger.warn(`VoiceMaster category ${configuredId} no longer exists in guild ${guild.id}; creating the temporary channel without that parent.`);
  }
  return null;
}

function renderName(template, member) {
  return String(template || '{user.name}').replace(/\{user\}/g, member.user.username).replace(/\{user\.name\}/g, member.user.username).replace(/\{user\.display_name\}/g, member.displayName).slice(0, 100);
}

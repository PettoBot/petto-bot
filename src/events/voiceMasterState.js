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
        const channel = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: config.category_id || creator?.parentId || null, userLimit: config.default_limit || 0, permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.Connect] }, { id: member.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] }] });
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

function renderName(template, member) {
  return String(template || '{user.name}').replace(/\{user\}/g, member.user.username).replace(/\{user\.name\}/g, member.user.username).replace(/\{user\.display_name\}/g, member.displayName).slice(0, 100);
}

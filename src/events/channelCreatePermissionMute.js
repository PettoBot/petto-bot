// A new channel gets the overwrites of the image and reaction mute roles (!imute, !rmute), when the server has them.
const { Events } = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { applyToNewChannel } = require('../utils/permissionMute');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelCreate,
  async execute(channel) {
    if (!channel.guild) return;
    try {
      const config = await ensureGuild(channel.guild.id);
      if (!config?.image_mute_role_id && !config?.reaction_mute_role_id) return;
      await applyToNewChannel(channel, config);
    } catch (err) {
      logger.warn(`Could not add the image/reaction mute overwrites to new channel ${channel.id}: ${err.message}`);
    }
  },
};

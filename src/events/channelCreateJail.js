const { Events } = require('discord.js');
const jailDb = require('../db/jail');
const { applyJailOverwrite } = require('../utils/jail');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelCreate,
  async execute(channel) {
    if (!channel.guild) return;
    try {
      const config = await jailDb.getConfig(channel.guild.id);
      if (!config?.jail_role_id || channel.id === config.jail_channel_id) return;
      const role = channel.guild.roles.cache.get(config.jail_role_id);
      // A channel is created with the permissions of its category, so it may already be hidden from the jail role.
      if (role) await applyJailOverwrite(channel, role);
    } catch (err) {
      logger.warn(`Could not hide new channel ${channel.id} from the jail role in guild ${channel.guild.id}: ${err.message}`);
    }
  },
};

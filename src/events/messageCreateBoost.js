const { Events, MessageType } = require('discord.js');
const { getConfig } = require('../db/memberEvents');
const { sendMemberEvent } = require('../utils/memberEventMessage');
const logger = require('../utils/logger');

// Discord posts these as real system messages in the guild — GuildBoost fires once per
// individual boost (a member can apply more than one), GuildBoostTierN fires separately
// when the server's boost level itself goes up. Reading message.type instead of diffing
// member.premiumSince catches every boost, not just "started boosting".
const TIER_LEVEL = {
  [MessageType.GuildBoostTier1]: 1,
  [MessageType.GuildBoostTier2]: 2,
  [MessageType.GuildBoostTier3]: 3,
};

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild) return;

    const isBoost = message.type === MessageType.GuildBoost;
    const tierLevel = TIER_LEVEL[message.type];
    if (!isBoost && !tierLevel) return;

    try {
      const config = await getConfig(message.guild.id);
      if (!config?.boost_channel_id) return;

      const channel = await message.guild.channels.fetch(config.boost_channel_id).catch(() => null);
      if (!channel) return;

      const member = message.member;
      const ctx = { member, guild: message.guild, channel, user: member?.user ?? message.author };

      if (isBoost) {
        await sendMemberEvent({ guild: message.guild, channel, kind: 'boost', messageText: config.boost_message, embedTemplateName: config.boost_embed_template, ctx });
      }

      if (tierLevel) {
        await sendMemberEvent({ guild: message.guild, channel, kind: 'boost_level', messageText: config.boost_level_message, embedTemplateName: config.boost_level_embed_template, ctx });
      }
    } catch (err) {
      logger.error(`Boost message failed in guild ${message.guild.id}:`, err);
    }
  },
};

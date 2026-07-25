const { Events } = require('discord.js');
const { getConfig } = require('../db/memberEvents');
const { sendMemberEvent } = require('../utils/memberEventMessage');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const config = await getConfig(member.guild.id);
      if (!config?.dm_join_message && !config?.dm_join_embed_template) return;

      const dm = await member.createDM().catch(() => null);
      if (!dm) return; // DMs closed — nothing else to do, matches /welcome's own best-effort DM sends elsewhere

      await sendMemberEvent({
        guild: member.guild,
        channel: dm,
        kind: 'welcome',
        messageText: config.dm_join_message,
        embedTemplateName: config.dm_join_embed_template,
        ctx: { member, guild: member.guild, channel: dm },
      });
    } catch (err) {
      logger.error(`Join DM failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};

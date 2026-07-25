const { Events } = require('discord.js');
const { getConfig } = require('../db/levelConfig');
const levelUsersDb = require('../db/levelUsers');
const { totalXpForLevel, levelForXp } = require('../utils/levelCurve');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return;

    try {
      const config = await getConfig(member.guild.id);
      if (!config?.enabled || (!config.join_xp && !config.join_level)) return;

      // Only a genuinely fresh member gets the bonus — someone who left with progress and
      // rejoined keeps whatever they already had, same as bli/urubot's "only if untouched" guard.
      const existing = await levelUsersDb.getUser(member.guild.id, member.id);
      if (existing && (existing.xp > 0 || existing.level > 0)) return;

      let xp;
      let level;
      if (config.join_level > 0) {
        level = config.join_level;
        xp = totalXpForLevel(level, config);
      } else {
        xp = config.join_xp;
        level = levelForXp(xp, config);
      }

      await levelUsersDb.setXpAndLevel(member.guild.id, member.id, xp, level);
    } catch (err) {
      logger.error(`Level join bonus failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};

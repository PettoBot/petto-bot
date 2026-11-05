// Role triggers (`/protect roletrigger`): a member Petto did not have in memory got an update (discord.js caches it and emits this instead of
// `guildMemberUpdate`, with no old copy). Nothing is done to the member: without the old copy a long-time holder of the role would be sanctioned.
// The operator only gets a line in the console, so a missed grant can be seen (see utils/roleTriggerWarm.js for how the members are loaded).
const { Events } = require('discord.js');
const roleTriggersDb = require('../db/roleTriggers');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAvailable,
  async execute(member) {
    if (!member?.guild || member.user?.bot) return;
    try {
      const rules = await roleTriggersDb.listRules(member.guild.id);
      if (!rules.length) return;
      const held = rules.filter((rule) => member.roles.cache.has(rule.role_id));
      if (!held.length) return;
      logger.localWarn(`Role triggers: member ${member.id} of guild ${member.guild.id} was not in memory and holds the role of a rule (${held.map((r) => r.role_id).join(', ')}); the update was not acted on.`); // i18n-ignore: console line for the operator
    } catch (err) {
      logger.localWarn(`Role triggers: could not look at the available member ${member.id} in guild ${member.guild.id}: ${err?.message ?? err}`); // i18n-ignore: console line for the operator
    }
  },
};

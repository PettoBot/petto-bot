const { Events } = require('discord.js');
const giveawaysDb = require('../db/giveaways');
const { refreshGiveawayMessage, loadPreset, entryProblem } = require('../utils/giveawayEngine');
const { peekGuildLanguage } = require('../i18n');
const { sendDm } = require('../utils/dmOrigin');

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot || !reaction.message.guild) return;

    try {
      if (reaction.partial) await reaction.fetch().catch(() => null);
      const giveaway = await giveawaysDb.getGiveawayByMessageId(reaction.message.guild.id, reaction.message.id);
      if (!giveaway || giveaway.ended || giveaway.entry_mode !== 'reaction') return;
      if (reaction.emoji.toString() !== giveaway.reaction) return;

      // A preset can ask for a level to enter: the reaction is taken away and the member is told why, by DM in the server's language.
      if (giveaway.preset_id) {
        const problem = await entryProblem(giveaway.guild_id, await loadPreset(giveaway.preset_id), user.id, peekGuildLanguage(giveaway.guild_id));
        if (problem) {
          await reaction.users.remove(user.id).catch(() => {});
          await sendDm(user, problem, { guild: reaction.message.guild, kind: 'giveaway' }).catch(() => {});
          return;
        }
      }
      await giveawaysDb.addEntry(giveaway.id, user.id, 1);
      await refreshGiveawayMessage(reaction.message.channel, giveaway);
    } catch {
      // Best-effort — a failed lookup shouldn't crash the reaction handler.
    }
  },
};

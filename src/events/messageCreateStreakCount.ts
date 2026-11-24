// i18n-ignore-file: nothing here is shown to anyone.
// A message in a server that filters its streaks: if it passes the rules (length, cooldown, channels, roles) it is counted for the streak of its author. A server that does not filter does nothing here.
// Written in TypeScript: `npm run build:ts` compiles it over events/messageCreateStreakCount.js.
const { Events } = require('discord.js');
const counting = require('../utils/streakCounting') as typeof import('../utils/streakCounting');
const statsRules = require('../db/statsRules') as { allowed: (guildId: string, userId: string) => { members: boolean } | null };

module.exports = {
  name: Events.MessageCreate,
  execute(message: { author: { bot: boolean; id: string }; webhookId?: string | null; guild: { id: string } | null; content?: string; channelId: string; channel: { parentId?: string | null; parent?: { parentId?: string | null } | null }; member?: { roles?: { cache?: Map<string, unknown> } } | null }) {
    if (message.author.bot || message.webhookId || !message.guild) return;
    const filters = counting.rulesOf(message.guild.id);
    if (!filters) return;
    // A person who asked not to be counted (`!stats privacy`) adds nothing, as with the other counters.
    const rules = statsRules.allowed(message.guild.id, message.author.id);
    if (!rules || !rules.members) return;
    counting.consider(filters, {
      guildId: message.guild.id, userId: message.author.id, length: (message.content ?? '').trim().length,
      channelIds: [message.channelId, message.channel.parentId, message.channel.parent?.parentId].filter(Boolean) as string[],
      roleIds: message.member?.roles?.cache ? [...message.member.roles.cache.keys()] : [],
    });
  },
};

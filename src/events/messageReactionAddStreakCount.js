"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// i18n-ignore-file: nothing here is shown to anyone.
// A reaction in a server that asked for reactions to count as messages in its streaks: it counts like a message (the rules of cooldown, channels and roles still apply; the length does not).
// Written in TypeScript: `npm run build:ts` compiles it over events/messageReactionAddStreakCount.js.
const { Events } = require('discord.js');
const counting = require('../utils/streakCounting');
const statsRules = require('../db/statsRules');
module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        const guildId = reaction.message.guildId;
        if (user.bot || !guildId)
            return;
        const filters = counting.rulesOf(guildId);
        if (!filters || !filters.reactions)
            return;
        const rules = statsRules.allowed(guildId, user.id);
        if (!rules || !rules.members)
            return;
        let roleIds = [];
        if (filters.roleMode !== 'all') {
            // The roles are only asked for when the server filters by role. The member may not be in the cache.
            const guild = reaction.client.guilds.cache.get(guildId);
            const member = guild ? (guild.members.cache.get(user.id) ?? await guild.members.fetch(user.id).catch(() => null)) : null;
            if (!member)
                return;
            roleIds = [...member.roles.cache.keys()];
        }
        const channel = reaction.message.channel;
        counting.consider(filters, { guildId, userId: user.id, length: null, channelIds: [reaction.message.channelId, channel?.parentId, channel?.parent?.parentId].filter(Boolean), roleIds });
    },
};

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATS_EVERY_MS = exports.CATEGORY_NAME = void 0;
exports.channelName = channelName;
exports.keyOfName = keyOfName;
exports.readNumbers = readNumbers;
exports.updateStatsCategory = updateStatsCategory;
// i18n-ignore-file: the names of the channels are written for the support server of Petto, they are not an answer of a command.
// The category "@ stats" of the support server: two voice channels that everybody sees and nobody can join, one with the members of all the servers
// of Petto and one with the number of servers. The numbers are whole (12,480, never 12K). The names are changed at most every 10 minutes, because
// Discord only lets a channel be renamed twice in 10 minutes. The category and the channels are made again when they are deleted.
// Written in TypeScript: `npm run build:ts` compiles it over utils/statsCategory.js.
const discord_js_1 = require("discord.js");
exports.CATEGORY_NAME = '@ stats';
exports.STATS_EVERY_MS = 10 * 60_000;
/** The name of a channel: the label, a dot and the whole number (`Members • 12,480`). */
function channelName(key, value) {
    const label = key === 'members' ? 'Members' : 'Servers';
    return `${label} • ${Math.max(0, Math.floor(value)).toLocaleString('en-US')}`;
}
/** Which of the two channels a name belongs to, from its label (so the channels are found again even when the number changed). */
function keyOfName(name) {
    if (/^members\b/i.test(name))
        return 'members';
    if (/^servers\b/i.test(name))
        return 'servers';
    return null;
}
/** The numbers of every server of the bot: how many there are and how many members they have together (from the cache, it costs nothing). */
function readNumbers(client) {
    const guilds = [...client.guilds.cache.values()];
    return { servers: guilds.length, members: guilds.reduce((total, guild) => total + (Number(guild.memberCount) || 0), 0) };
}
/** Everybody sees the channel, nobody joins it (the permissions of the category go to its channels). */
function lockedPermissions(guild) {
    return [{ id: guild.roles.everyone.id, allow: [discord_js_1.PermissionFlagsBits.ViewChannel], deny: [discord_js_1.PermissionFlagsBits.Connect] }];
}
/**
 * Makes sure the category and its two channels exist and shows the numbers. Only a channel whose name changed is renamed.
 * `skipped` says why nothing was done (no server set, the server is not in the cache, Petto cannot manage channels there).
 */
async function updateStatsCategory(client, guildId, numbers = readNumbers(client)) {
    const report = { created: [], renamed: [], skipped: null };
    if (!guildId) {
        report.skipped = 'no support server set (PETTO_SUPPORT_GUILD_ID)';
        return report;
    }
    const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
        report.skipped = 'the support server is not reachable';
        return report;
    }
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(discord_js_1.PermissionFlagsBits.ManageChannels)) {
        report.skipped = 'Petto cannot manage channels in the support server';
        return report;
    }
    await guild.channels.fetch();
    let category = guild.channels.cache.find((channel) => channel.type === discord_js_1.ChannelType.GuildCategory && channel.name.toLowerCase() === exports.CATEGORY_NAME) ?? null;
    if (!category) {
        category = await guild.channels.create({ name: exports.CATEGORY_NAME, type: discord_js_1.ChannelType.GuildCategory, permissionOverwrites: lockedPermissions(guild), reason: 'Petto stats' });
        report.created.push(exports.CATEGORY_NAME);
    }
    const inside = guild.channels.cache.filter((channel) => channel.type === discord_js_1.ChannelType.GuildVoice && channel.parentId === category.id);
    for (const key of ['members', 'servers']) {
        const wanted = channelName(key, numbers[key]);
        const found = inside.find((channel) => keyOfName(channel.name) === key);
        if (!found) {
            await guild.channels.create({ name: wanted, type: discord_js_1.ChannelType.GuildVoice, parent: category.id, permissionOverwrites: lockedPermissions(guild), reason: 'Petto stats' });
            report.created.push(wanted);
        }
        else if (found.name !== wanted) {
            await found.setName(wanted, 'Petto stats');
            report.renamed.push(wanted);
        }
    }
    return report;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANDIDATES = exports.PLACES = exports.PERIODS = void 0;
exports.periodWindow = periodWindow;
exports.boardText = boardText;
exports.topMembers = topMembers;
exports.writableChannel = writableChannel;
exports.statsReason = statsReason;
exports.refreshBoard = refreshBoard;
exports.deleteBoardMessages = deleteBoardMessages;
exports.runDueBoards = runDueBoards;
// The activity leaderboards: a card for the day, the week and the month of the chat or of the voice channels, in a channel of the server, edited by Petto every hour.
// What is shown is read from `activity_members` (a count for each member and day, never what was said), so it follows what a server turned off in `!statsconfig` and
// who asked not to be counted (`!stats privacy`). Days, weeks (ISO, from Monday) and months are the ones of Petto, GMT-5 (Colombia).
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/activityLeaderboard.js, which is what the bot loads.
const discord_js_1 = require("discord.js");
const db = require("../db/activityLeaderboards");
/** The order they are posted in, and so the order they read in: the longest first. */
exports.PERIODS = ['monthly', 'weekly', 'daily'];
/** Places shown in a card: the first one on its own line (the most active) and the rest numbered. */
exports.PLACES = 10;
/** How many members are asked for, so that the ones who left the server can be skipped and the card is still full. */
exports.CANDIDATES = 30;
// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const statsRules = require('../db/statsRules');
const { botDay, OFFSET_MS } = require('./botTime');
const { t, tn, guildLanguage } = require('../i18n');
const { textCard } = require('./caseCard');
const { EMOJI } = require('./emojis');
const icons = require('../music/icons');
const logger = require('./logger');
const DAY_MS = 86_400_000;
/** The period of `at` for a kind of card: today, this ISO week (Monday to Sunday) or this month, and when it ends. All in GMT-5. */
function periodWindow(period, at = new Date()) {
    const clock = new Date(at.getTime() + OFFSET_MS); // its UTC fields are the clock of Colombia
    const today = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate());
    let start = today;
    let end = today + DAY_MS;
    if (period === 'weekly') {
        const weekday = new Date(today).getUTCDay() || 7; // Monday is 1 and Sunday is 7
        start = today - (weekday - 1) * DAY_MS;
        end = start + 7 * DAY_MS;
    }
    else if (period === 'monthly') {
        start = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), 1);
        end = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth() + 1, 1);
    }
    return { startDay: new Date(start).toISOString().slice(0, 10), resetAt: new Date(end - OFFSET_MS) };
}
const rankEmoji = (place) => EMOJI[`BOARD_RANK_${String(place).padStart(2, '0')}`] ?? `${place}.`;
const amountText = (lang, kind, amount) => (kind === 'voice'
    ? tn(lang, 'leaderboards.unit.minutes', Math.floor(amount / 60))
    : tn(lang, 'leaderboards.unit.messages', amount));
/** The words of one card: the title, the most active member, the next places, when it starts again and how often it is updated. */
function boardText(lang, kind, period, entries, resetAt) {
    const title = `**${t(lang, `leaderboards.title.${kind}`, { period: t(lang, `leaderboards.period.${period}`) })}**`;
    const lines = [title, ''];
    if (!entries.length) {
        lines.push(t(lang, 'leaderboards.empty'));
    }
    else {
        const [first, ...rest] = entries.slice(0, exports.PLACES);
        lines.push(`${EMOJI.BOARD_TOP} **${t(lang, `leaderboards.top.${kind}`)}** \`${first.username}\` ${EMOJI.BOARD_ARROW} **${amountText(lang, kind, first.amount)}**`);
        if (rest.length)
            lines.push('');
        rest.forEach((entry, index) => lines.push(`${rankEmoji(index + 2)} \`${entry.username}\` ${EMOJI.BOARD_ARROW} **${amountText(lang, kind, entry.amount)}**`));
    }
    lines.push('', `${icons.CLOCK} **${t(lang, 'leaderboards.resets', { when: `<t:${Math.floor(resetAt.getTime() / 1000)}:R>` })}**`, `-# ${t(lang, 'leaderboards.footer')}`);
    return lines.join('\n');
}
/**
 * The top of the period with the usernames: members who are no longer in the server, bots and people who asked not to be counted are left out.
 * The role of the most active member of the week is given from the same list, so the card and the role always name the same person.
 */
async function topMembers(guild, rows, limit = exports.PLACES) {
    const wanted = rows.filter((row) => !statsRules.isOptedOut(row.user_id));
    const missing = wanted.map((row) => row.user_id).filter((id) => !guild.members.cache.has(id));
    if (missing.length)
        await guild.members.fetch({ user: missing.slice(0, 100) }).catch(() => null);
    const members = [];
    for (const row of wanted) {
        const member = guild.members.cache.get(row.user_id);
        if (!member || member.user.bot)
            continue;
        members.push({ userId: row.user_id, username: member.user.username, amount: row.amount });
        if (members.length >= limit)
            break;
    }
    return members;
}
const entriesOf = async (guild, rows) => (await topMembers(guild, rows)).map(({ username, amount }) => ({ username, amount }));
// ---- Writing the three messages -------------------------------------------------------------------------------------------------
const ERROR_CODES = { unknownChannel: 10003, unknownMessage: 10008, missingAccess: 50001, missingPermissions: 50013 };
const codeOf = (error) => {
    const code = error?.code;
    return typeof code === 'number' ? code : null;
};
const NEEDED = [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory];
/** Can Petto write in this channel? The channel, or a reason. */
function writableChannel(guild, channel) {
    if (!channel || (channel.type !== discord_js_1.ChannelType.GuildText && channel.type !== discord_js_1.ChannelType.GuildAnnouncement))
        return { reason: 'channel' };
    const me = guild.members.me;
    if (!me || !NEEDED.every((flag) => channel.permissionsFor(me).has(flag)))
        return { reason: 'permissions' };
    return { channel: channel };
}
/** The reason a server cannot have boards at all: statistics turned off, or kept without members. */
function statsReason(guildId) {
    const rules = statsRules.rulesOf(guildId);
    if (!rules.enabled)
        return 'statsOff';
    if (!rules.members)
        return 'membersOff';
    return null;
}
/**
 * Writes the three cards of a board: edits the messages it has, or posts all three again in order when one is missing (deleted by someone), and remembers them.
 * A board that cannot be written keeps the reason in the database. Never throws for something that is the server's doing.
 */
async function refreshBoard(client, row, { now = new Date() } = {}) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild)
        return { ok: false, reason: 'error' }; // not reachable now: nothing is said, it is looked at again
    const fail = async (reason) => { await db.markError(row.guild_id, row.kind, reason); return { ok: false, reason }; };
    const blocked = statsReason(guild.id);
    if (blocked)
        return fail(blocked);
    const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
    const writable = writableChannel(guild, channel);
    if ('reason' in writable)
        return fail(writable.reason);
    const lang = await guildLanguage(guild.id);
    const payloads = new Map();
    for (const period of exports.PERIODS) {
        const window = periodWindow(period, now);
        const entries = await entriesOf(guild, await db.readTop(guild.id, row.kind, window.startDay, exports.CANDIDATES));
        payloads.set(period, { components: [textCard(boardText(lang, row.kind, period, entries, window.resetAt))], flags: discord_js_1.MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    }
    const known = { daily: row.daily_message_id, weekly: row.weekly_message_id, monthly: row.monthly_message_id };
    const saved = { ...known };
    try {
        let repost = exports.PERIODS.some((period) => !known[period]);
        if (!repost) {
            for (const period of exports.PERIODS) {
                try {
                    await writable.channel.messages.edit(known[period], payloads.get(period));
                }
                catch (error) {
                    if (codeOf(error) !== ERROR_CODES.unknownMessage)
                        throw error;
                    repost = true; // someone deleted one: all three are written again so they stay in order
                    break;
                }
            }
        }
        if (repost) {
            for (const period of exports.PERIODS) {
                if (known[period])
                    await writable.channel.messages.delete(known[period]).catch(() => null);
            }
            for (const period of exports.PERIODS)
                saved[period] = (await writable.channel.send(payloads.get(period))).id;
        }
    }
    catch (error) {
        const code = codeOf(error);
        if (code === ERROR_CODES.unknownChannel)
            return fail('channel');
        if (code === ERROR_CODES.missingAccess || code === ERROR_CODES.missingPermissions)
            return fail('permissions');
        logger.warn(`Activity leaderboard (${row.kind}) in guild ${row.guild_id} could not be written: ${error?.message}`);
        return fail('error');
    }
    await db.saveMessages(row.guild_id, row.kind, { daily: saved.daily, weekly: saved.weekly, monthly: saved.monthly });
    await db.markRefreshed(row.guild_id, row.kind);
    return { ok: true };
}
/** Deletes the messages of a board that was taken away (best effort: they may be gone already or Petto may not see the channel). */
async function deleteBoardMessages(client, row) {
    const guild = client.guilds.cache.get(row.guild_id);
    const channel = guild ? await guild.channels.fetch(row.channel_id).catch(() => null) : null;
    if (!channel || !('messages' in channel))
        return;
    for (const id of [row.daily_message_id, row.weekly_message_id, row.monthly_message_id]) {
        if (id)
            await channel.messages.delete(id).catch(() => null);
    }
}
/** Writes the boards that are due, one server after another with a pause between them. */
async function runDueBoards(client, { pauseMs = 1500, sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }) } = {}) {
    const due = await db.listDue(20);
    for (const row of due) {
        try {
            await refreshBoard(client, row);
        }
        catch (error) {
            logger.warn(`Activity leaderboard (${row.kind}) in guild ${row.guild_id} failed: ${error?.message}`);
        }
        await sleep(pauseMs);
    }
    return due.length;
}

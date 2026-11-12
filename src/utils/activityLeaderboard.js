"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANDIDATES = exports.PLACES = exports.PERIODS = void 0;
exports.createEditBudget = createEditBudget;
exports.periodWindow = periodWindow;
exports.boardText = boardText;
exports.topMembers = topMembers;
exports.writableChannel = writableChannel;
exports.statsReason = statsReason;
exports.refreshBoard = refreshBoard;
exports.deleteBoardMessages = deleteBoardMessages;
exports.runDueBoards = runDueBoards;
// The activity leaderboards: a card for the day, the week and the month (the ones the server chose) of the chat or of the voice channels, in a channel of the server, edited by Petto
// about every 5 minutes, and only when what they say changed.
// What is shown is read from `activity_members` (a count for each member and day, never what was said), so it follows what a server turned off in `!statsconfig` and
// who asked not to be counted (`!stats privacy`). Days, weeks (ISO, from Monday) and months are the ones of Petto, GMT-5 (Colombia).
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/activityLeaderboard.js, which is what the bot loads.
const node_crypto_1 = require("node:crypto");
const discord_js_1 = require("discord.js");
const db = require("../db/activityLeaderboards");
/** The order they are posted in, and so the order they read in: the longest first. */
exports.PERIODS = db.PERIODS;
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
const config = require('../config');
const { forEachWithConcurrency } = require('./concurrency');
const DAY_MS = 86_400_000;
/**
 * A card that says the same as the last time is not edited again, except once in a long while: that is how a message that someone deleted is found when nobody has said anything
 * (when something changes, the edit finds it at once). The memory of what a card said is in the database (`card_state`), so a restart of the bot edits nothing.
 */
const FORCE_EDIT_MS = 6 * 60 * 60_000;
/** The short hash of a card's text that is kept in `card_state`. */
const hashOf = (text) => (0, node_crypto_1.createHash)('sha1').update(text).digest('hex').slice(0, 16);
function createEditBudget({ perSecond, capacity = Math.max(12, perSecond * 20), now = () => Date.now() }) {
    let tokens = capacity;
    let last = now();
    const refill = () => {
        const current = now();
        tokens = Math.min(capacity, tokens + ((current - last) * perSecond) / 1000);
        last = current;
    };
    return {
        perSecond,
        available: () => { refill(); return Math.floor(tokens); },
        take(count) {
            refill();
            if (tokens < count)
                return false;
            tokens -= count;
            return true;
        },
    };
}
const defaultBudget = createEditBudget({ perSecond: Math.max(1, Number(config.activityBoardEditsPerSecond) || Math.floor(Number(config.restRequestsPerSecond) / 2) || 4) });
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
 * Writes the cards of a board (the periods the server chose): edits the messages it has, or posts them all again in order when one is missing (deleted by someone) or a
 * period was added, and remembers them. A card that says the same as when it was last written is not edited again (the memory is in the database, and one that has not been
 * written for hours is, to find a deleted one), so a quiet server costs nothing at Discord. A board that cannot be written keeps the reason in the database. Never throws for
 * something that is the server's doing.
 *
 * `budget` (what a round of the job passes) limits the writes to Discord: a board that needs more of them than the bucket has is not touched (`deferred`). `pending` (also from the
 * job) collects what a look found, to save it with the other boards of the round in one statement; without it the board is saved at once, as a command or the dashboard want.
 */
async function refreshBoard(client, row, { now = new Date(), force = false, budget, pending } = {}) {
    const known = { daily: row.daily_message_id, weekly: row.weekly_message_id, monthly: row.monthly_message_id };
    const done = async (entry) => { if (pending)
        pending.push(entry);
    else
        await db.flushRefreshed([entry]); };
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) {
        // Not reachable now: nothing is said, but it counts as looked at, so a board that cannot be reached never stays first in line and holds back the others.
        await done({ guildId: row.guild_id, kind: row.kind, ids: known, state: null });
        return { ok: false, reason: 'error' };
    }
    const fail = async (reason) => { await db.markError(row.guild_id, row.kind, reason); return { ok: false, reason }; };
    const blocked = statsReason(guild.id);
    if (blocked)
        return fail(blocked);
    const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
    const writable = writableChannel(guild, channel);
    if ('reason' in writable)
        return fail(writable.reason);
    const lang = await guildLanguage(guild.id);
    // Only the periods the server chose are read and written; the others have no message. The three tops are read in one round trip.
    const chosen = exports.PERIODS.filter((period) => db.cleanPeriods(row.periods).includes(period));
    const windows = new Map(chosen.map((period) => [period, periodWindow(period, now)]));
    const tops = await db.readTops(guild.id, row.kind, chosen.map((period) => ({ period, startDay: windows.get(period).startDay })), exports.CANDIDATES);
    const texts = new Map();
    const hashes = new Map();
    const payloads = new Map();
    for (const period of chosen) {
        const entries = await entriesOf(guild, tops[period] ?? []);
        const text = boardText(lang, row.kind, period, entries, windows.get(period).resetAt);
        texts.set(period, text);
        hashes.set(period, hashOf(text));
        payloads.set(period, { components: [textCard(text)], flags: discord_js_1.MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    }
    // What has to be written, decided before anything is sent: a card with no memory (the board is older than the memory) is not written, it only starts remembering, at a time
    // spread over the hours so that they do not all come due together; a card whose text or age says so is edited.
    const stamp = now.getTime();
    const state = { ...(row.card_state ?? {}) };
    let stateChanged = false;
    const removed = exports.PERIODS.filter((period) => !chosen.includes(period) && known[period]);
    let repost = chosen.some((period) => !known[period]);
    const toEdit = [];
    if (!repost) {
        for (const period of chosen) {
            const before = state[period];
            if (!before && !force) {
                state[period] = { h: hashes.get(period), at: stamp - Math.floor(Math.random() * FORCE_EDIT_MS) };
                stateChanged = true;
                continue;
            }
            if (force || !before || before.h !== hashes.get(period) || stamp - before.at >= FORCE_EDIT_MS)
                toEdit.push(period);
        }
    }
    const cost = removed.length + (repost ? chosen.filter((period) => known[period]).length + chosen.length : toEdit.length);
    if (cost > 0 && budget && !budget.take(cost))
        return { ok: false, deferred: true };
    const saved = { ...known };
    let edits = 0;
    try {
        // A period that was taken away loses its message; the others stay where they are.
        for (const period of removed) {
            await writable.channel.messages.delete(known[period]).catch(() => null);
            edits += 1;
            saved[period] = null;
            delete state[period];
            stateChanged = true;
        }
        // A period that was added has no message yet: they are all written again so they stay in order.
        for (const period of toEdit) {
            try {
                await writable.channel.messages.edit(known[period], payloads.get(period));
                edits += 1;
                state[period] = { h: hashes.get(period), at: stamp };
                stateChanged = true;
            }
            catch (error) {
                if (codeOf(error) !== ERROR_CODES.unknownMessage)
                    throw error;
                repost = true; // someone deleted one: all of them are written again so they stay in order
                break;
            }
        }
        if (repost) {
            for (const period of chosen) {
                if (known[period]) {
                    await writable.channel.messages.delete(known[period]).catch(() => null);
                    edits += 1;
                }
            }
            for (const period of chosen) {
                saved[period] = (await writable.channel.send(payloads.get(period))).id;
                edits += 1;
                state[period] = { h: hashes.get(period), at: stamp };
                stateChanged = true;
            }
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
    await done({ guildId: row.guild_id, kind: row.kind, ids: saved, state: stateChanged ? state : null });
    return { ok: true, wrote: edits > 0, edits };
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
/** A board that waited longer than this for its look (two rounds) means the promise of every 5 minutes is not being kept: the team is told, at most every 10 minutes. */
const LATE_MS = 2 * db.REFRESH_SECONDS * 1000;
const LATE_WARNING_EVERY_MS = 10 * 60_000;
let lastLateWarning = 0;
/**
 * Looks at the boards that are due, oldest first, `concurrency` at a time, for up to `budgetMs`, and asks again while there are more due (so thousands of boards that read and write
 * nothing new are looked at in a round). What costs something is the writing to Discord: it goes through `budget` and, when that has no more, the round ends and the boards that
 * are left, the oldest first, are the first at the next look (every 15 seconds, when the bucket has filled a little). What each look found is saved with the others, in one statement
 * for each batch of boards. A board that cannot be looked at is counted as looked at, so it never holds back the ones behind it. Answers how many boards were looked at.
 */
async function runDueBoards(client, { budgetMs = 50_000, concurrency = 4, limit = 250, budget = defaultBudget, now = () => Date.now() } = {}) {
    const started = now();
    const seen = new Set();
    let looked = 0;
    let edits = 0;
    let deferred = false;
    let oldestMs = 0;
    let first = true;
    while (!deferred && now() - started < budgetMs) {
        const batch = await db.listDue(limit);
        const due = batch.filter((row) => !seen.has(`${row.guild_id}:${row.kind}`));
        if (!due.length)
            break;
        if (first) {
            first = false;
            const at = due[0].last_refreshed_at;
            oldestMs = at ? now() - new Date(at).getTime() : 0;
        }
        const pending = [];
        await forEachWithConcurrency(due, async (row) => {
            if (deferred || now() - started >= budgetMs)
                return;
            const key = `${row.guild_id}:${row.kind}`;
            seen.add(key);
            try {
                const result = await refreshBoard(client, row, { budget, pending });
                if (result.deferred) {
                    deferred = true;
                    seen.delete(key);
                    return;
                }
                edits += result.edits ?? 0;
            }
            catch (error) {
                logger.warn(`Activity leaderboard (${row.kind}) in guild ${row.guild_id} failed: ${error?.message}`);
                await db.markError(row.guild_id, row.kind, 'error').catch(() => null);
            }
            looked += 1;
        }, concurrency);
        if (pending.length)
            await db.flushRefreshed(pending).catch((error) => logger.warn(`Activity leaderboards: the round could not be saved: ${error?.message}`));
        if (batch.length < limit)
            break;
    }
    if (oldestMs > LATE_MS && now() - lastLateWarning >= LATE_WARNING_EVERY_MS) {
        lastLateWarning = now();
        logger.warn(`Activity leaderboards are running late: the oldest board waited ${Math.round(oldestMs / 60_000)} minutes for its look (it should be 5), ${looked} were looked at in this round and ${edits} cards were written; the budget is ${budget.perSecond} writes a second (PETTO_ACTIVITY_BOARD_EDITS_PER_SECOND, a share of PETTO_REST_RPS).`);
    }
    return looked;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_PLACES = exports.TEXT_LIMIT = exports.CANDIDATES = exports.PLACES = exports.PERIODS = void 0;
exports.createEditBudget = createEditBudget;
exports.periodWindow = periodWindow;
exports.voiceTime = voiceTime;
exports.boardText = boardText;
exports.topMembers = topMembers;
exports.writableChannel = writableChannel;
exports.statsReason = statsReason;
exports.refreshBoard = refreshBoard;
exports.deleteBoardMessages = deleteBoardMessages;
exports.runDueBoards = runDueBoards;
// The activity leaderboards: a card for the day, the week and the month (the ones the server chose) of the chat or of the voice channels, all in ONE message in a channel of the
// server (a card for each period, one under the other), edited by Petto about every 5 minutes, and only when what it says changed.
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
 * A message that says the same as the last time is not edited again, except once in a long while: that is how a message that someone deleted is found when nobody has said anything
 * (when something changes, the edit finds it at once). The memory of what the message said is in the database (`card_state`), so a restart of the bot edits nothing.
 */
const FORCE_EDIT_MS = 6 * 60 * 60_000;
/**
 * A message made of components (Components V2) can hold 4000 characters of text in all, and a board puts the cards of up to three periods in one: with usernames of 32 letters and
 * big numbers three full cards are 4200 and something. When they do not fit, every card shows one place less (never fewer than `MIN_PLACES`) until they do. The margin is for what
 * the count of Discord may include that this one does not.
 */
exports.TEXT_LIMIT = 3900;
exports.MIN_PLACES = 3;
/** The short hash of the text of a message that is kept in `card_state`. */
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
/**
 * A time in a voice channel, short: hours and minutes ("5H 30min", just "5H" when the minutes are none), only minutes under an hour ("45min"), only seconds under a minute ("30s").
 * Never days: a long time stays in hours ("1,350H"). The letters are the same in every language.
 */
function voiceTime(lang, seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    if (total < 60)
        return tn(lang, 'leaderboards.unit.seconds', total);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (!hours)
        return tn(lang, 'leaderboards.unit.minutes', minutes);
    return minutes ? `${tn(lang, 'leaderboards.unit.hours', hours)} ${tn(lang, 'leaderboards.unit.minutes', minutes)}` : tn(lang, 'leaderboards.unit.hours', hours);
}
const amountText = (lang, kind, amount) => (kind === 'voice' ? voiceTime(lang, amount) : tn(lang, 'leaderboards.unit.messages', amount));
/** The words of one card: the title, the most active member, the next places (`places` of them in all), when it starts again and how often it is updated. */
function boardText(lang, kind, period, entries, resetAt, places = exports.PLACES) {
    const title = `**${t(lang, `leaderboards.title.${kind}`, { period: t(lang, `leaderboards.period.${period}`) })}**`;
    const lines = [title, ''];
    if (!entries.length) {
        lines.push(t(lang, 'leaderboards.empty'));
    }
    else {
        const [first, ...rest] = entries.slice(0, Math.max(1, places));
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
 * Writes a board: ONE message with the card of each period the server chose, one under the other. It edits the message it has, or posts it when it has none (a new board, one that
 * someone deleted) and remembers it. A board whose cards say the same as when it was last written is not edited again (the memory is in the database, and one that has not been
 * written for hours is, to find a deleted message), so a quiet server costs nothing at Discord. A board written the older way (one message for each period) gets its new message
 * posted first and the old ones deleted after, so there is never a moment with nothing. A board that cannot be written keeps the reason in the database. Never throws for something
 * that is the server's doing.
 *
 * `budget` (what a round of the job passes) limits the writes to Discord: a board that needs more of them than the bucket has is not touched (`deferred`). `pending` (also from the
 * job) collects what a look found, to save it with the other boards of the round in one statement; without it the board is saved at once, as a command or the dashboard want.
 */
async function refreshBoard(client, row, { now = new Date(), force = false, budget, pending } = {}) {
    const known = row.message_id;
    const old = [row.monthly_message_id, row.weekly_message_id, row.daily_message_id].filter((id) => Boolean(id));
    const done = async (entry) => { if (pending)
        pending.push(entry);
    else
        await db.flushRefreshed([entry]); };
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) {
        // Not reachable now: nothing is said, but it counts as looked at, so a board that cannot be reached never stays first in line and holds back the others.
        await done({ guildId: row.guild_id, kind: row.kind, messageId: known, clearOld: false, state: null });
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
    const members = new Map();
    for (const period of chosen)
        members.set(period, await entriesOf(guild, tops[period] ?? []));
    // The cards of the periods are one message: with a very long list they might not fit, and then every card shows one place less.
    let texts = new Map();
    for (let places = exports.PLACES; places >= exports.MIN_PLACES; places -= 1) {
        texts = new Map(chosen.map((period) => [period, boardText(lang, row.kind, period, members.get(period), windows.get(period).resetAt, places)]));
        if ([...texts.values()].reduce((sum, text) => sum + text.length, 0) <= exports.TEXT_LIMIT)
            break;
    }
    const payload = { components: chosen.map((period) => textCard(texts.get(period))), flags: discord_js_1.MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
    const hash = hashOf(chosen.map((period) => texts.get(period)).join('\n\u0000\n'));
    // What has to be written, decided before anything is sent. No message yet (a new board, one that someone deleted, one written the older way): it is posted. A message with no
    // memory (the board is older than the memory) is not written, it only starts remembering, at a time spread over the hours so that they do not all come due together. A message whose
    // text or age says so is edited. The messages of the older way are deleted after the new one is there.
    const stamp = now.getTime();
    let state = { ...(row.card_state ?? {}) };
    let stateChanged = false;
    const before = typeof state.h === 'string' && typeof state.at === 'number' ? { h: state.h, at: state.at } : null;
    let mode = 'none';
    if (!known)
        mode = 'post';
    else if (force)
        mode = 'edit';
    else if (!before) {
        state = { h: hash, at: stamp - Math.floor(Math.random() * FORCE_EDIT_MS) };
        stateChanged = true;
    }
    else if (before.h !== hash || stamp - before.at >= FORCE_EDIT_MS)
        mode = 'edit';
    const cost = (mode === 'none' ? 0 : 1) + old.length;
    if (cost > 0 && budget && !budget.take(cost))
        return { ok: false, deferred: true };
    let messageId = known;
    let edits = 0;
    try {
        if (mode === 'edit') {
            try {
                await writable.channel.messages.edit(known, payload);
                edits += 1;
            }
            catch (error) {
                if (codeOf(error) !== ERROR_CODES.unknownMessage)
                    throw error;
                mode = 'post'; // someone deleted it: it is written again
            }
        }
        if (mode === 'post') {
            messageId = (await writable.channel.send(payload)).id;
            edits += 1;
        }
        if (mode !== 'none') {
            state = { h: hash, at: stamp };
            stateChanged = true;
        }
        for (const id of old) {
            await writable.channel.messages.delete(id).catch(() => null);
            edits += 1;
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
    await done({ guildId: row.guild_id, kind: row.kind, messageId, clearOld: old.length > 0, state: stateChanged ? state : null });
    return { ok: true, wrote: edits > 0, edits };
}
/** Deletes the messages of a board that was taken away (best effort: they may be gone already or Petto may not see the channel). */
async function deleteBoardMessages(client, row) {
    const guild = client.guilds.cache.get(row.guild_id);
    const channel = guild ? await guild.channels.fetch(row.channel_id).catch(() => null) : null;
    if (!channel || !('messages' in channel))
        return;
    for (const id of [row.message_id, row.monthly_message_id, row.weekly_message_id, row.daily_message_id]) {
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

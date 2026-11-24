"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lostDue = exports.reminderDue = exports.hoursLeft = exports.NICK_MIN = exports.REMINDER_HOURS = exports.MIN_STREAK = void 0;
exports.nicknameFor = nicknameFor;
exports.runNotices = runNotices;
const db = require('../db/streaks');
const streaks = require('./streaks');
const actions = require('./streakActions');
const premiumDb = require('../db/premium');
const { t, guildLanguage } = require('../i18n');
const { sendDm } = require('./dmOrigin');
const logger = require('./logger');
exports.MIN_STREAK = 3; // a streak shorter than this is not worth a reminder
exports.REMINDER_HOURS = 3; // the reminder goes in the last hours of the day
exports.NICK_MIN = 2; // the streak shows in the nickname from this many days
const PER_GUILD_PER_RUN = 40;
const GAP_MS = Number(process.env.PETTO_STREAK_GAP_MS ?? 600);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// " | 7 🔥" at the end of a name (the emoji is any short run of non-space characters).
const SUFFIX = /\s\|\s\d+\s\S{1,8}$/u;
/** Hours left of the UTC day. */
const hoursLeft = (now) => (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 3_600_000;
exports.hoursLeft = hoursLeft;
/** A reminder is due when the streak is worth it, the day is not done and little of it is left. */
const reminderDue = (current, activeToday, left) => current >= exports.MIN_STREAK && !activeToday && left <= exports.REMINDER_HOURS;
exports.reminderDue = reminderDue;
/** A streak was lost when it was alive a day ago (and worth a message) and it is gone now. */
const lostDue = (before, now) => before >= exports.MIN_STREAK && now === 0;
exports.lostDue = lostDue;
/** The name with its streak: the old suffix is taken away, the name is cut so that the whole is 32 characters at most, and below `NICK_MIN` days there is no suffix. */
function nicknameFor(name, current, emoji) {
    const base = name.replace(SUFFIX, '').trim();
    if (current < exports.NICK_MIN)
        return base;
    const suffix = ` | ${current} ${emoji}`;
    // Discord counts the length of a nickname in UTF-16 units, so that is how it is cut (a letter at a time, never in the middle of an emoji).
    let kept = '';
    for (const letter of base) {
        if ((kept + letter).length > Math.max(1, 32 - suffix.length))
            break;
        kept += letter;
    }
    return `${kept.trimEnd()}${suffix}`;
}
/** One server: the reminders, the lost streaks and the nicknames of the members with activity in the last three days. Returns how many actions it did. */
async function runNotices(guild, now = new Date()) {
    const config = await db.getConfig(guild.id);
    if (!config.enabled || !(config.dmReminder || config.dmLost || config.nicknameEnabled))
        return 0;
    const ids = await db.recentMembers(guild.id, 3000, 3);
    if (!ids.length)
        return 0;
    const [days, plans, out] = await Promise.all([db.daysOfMany(guild.id, ids, config.resetAt), db.plansOf(ids), db.optedOut(ids)]);
    const premium = config.nicknameEnabled ? Boolean((await premiumDb.getGuildPremium(guild.id).catch(() => ({ active: false }))).active) : false;
    const emoji = premium ? config.nicknameEmoji : '🔥';
    const rules = { minMessages: config.minMessages, minVoiceMinutes: config.minVoiceMinutes, mode: config.mode };
    const today = streaks.dayOf(streaks.graceNow(now, config.graceMinutes));
    const yesterday = streaks.dayOf(new Date(streaks.graceNow(now, config.graceMinutes).getTime() - 86_400_000));
    const lang = await guildLanguage(guild.id).catch(() => 'en');
    const me = guild.members.me;
    let did = 0;
    for (const userId of ids) {
        if (did >= PER_GUILD_PER_RUN)
            break;
        if (out.has(userId))
            continue;
        const freezes = actions.freezesFor(actions.planFreezesOf(plans.get(userId)), config.guildFreezes);
        const active = streaks.activeDays(days.get(userId) ?? [], rules);
        const current = streaks.compute(active, today, freezes);
        const before = streaks.compute(active, yesterday, freezes);
        const wantsReminder = config.dmReminder && (0, exports.reminderDue)(current.current, current.activeToday, (0, exports.hoursLeft)(now));
        const wantsLost = config.dmLost && (0, exports.lostDue)(before.current, current.current);
        const member = (wantsReminder || wantsLost || config.nicknameEnabled) ? (guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null)) : null;
        if (!member || member.user.bot)
            continue;
        const send = async (kind, key, vars) => {
            if (!(await db.claimNotice(guild.id, userId, kind, today)))
                return;
            try {
                await sendDm(member, { content: t(lang, key, { ...vars, server: guild.name }) }, { guild, kind: 'notice' });
                did += 1;
                await sleep(GAP_MS);
            }
            catch { /* DMs closed: nothing to do */ }
        };
        if (wantsReminder)
            await send('reminder', 'streaks.dm.reminder', { days: current.current, hours: Math.max(1, Math.ceil((0, exports.hoursLeft)(now))) });
        else if (wantsLost)
            await send('lost', 'streaks.dm.lost', { days: before.current });
        if (config.nicknameEnabled && member.manageable && me) {
            const shown = member.nickname ?? member.user.globalName ?? member.user.username;
            const wanted = nicknameFor(shown, current.current, emoji);
            if (wanted !== shown) {
                try {
                    // A name that is the account's own name goes back to no nickname.
                    const own = wanted === (member.user.globalName ?? member.user.username);
                    await member.setNickname(own ? null : wanted, 'Streak in the nickname');
                    did += 1;
                    await sleep(GAP_MS);
                }
                catch (error) {
                    logger.warn(`Streak nickname failed in guild ${guild.id}: ${error.message}`);
                }
            }
        }
    }
    return did;
}

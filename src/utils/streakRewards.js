"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dueFor = dueFor;
exports.runGuild = runGuild;
exports.runStreakRewards = runStreakRewards;
const streakNotices_1 = require("./streakNotices");
const db = require('../db/streaks');
const streaks = require('./streaks');
const actions = require('./streakActions');
const { t, guildLanguage } = require('../i18n');
const logger = require('./logger');
const PER_GUILD_PER_RUN = 60;
const GAP_MS = Number(process.env.PETTO_STREAK_GAP_MS ?? 400);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** What a member earns now (pure): the days to record, the reward roles to give, and the milestone to announce (only the highest one, and only while it is fresh: at most a day over). */
function dueFor(current, milestones, roles, done) {
    const reachedMilestones = milestones.filter((days) => days <= current && !done.has(days));
    const reachedRoles = roles.filter((role) => role.days <= current && !done.has(role.days));
    const record = [...new Set([...reachedMilestones, ...reachedRoles.map((role) => role.days)])].sort((a, b) => a - b);
    const top = reachedMilestones.length ? Math.max(...reachedMilestones) : null;
    return { announce: top !== null && current - top <= 1 ? top : null, roles: [...reachedRoles], record };
}
/** One server: looks at who did something today or yesterday and gives what their streak earned. Returns how many actions it did. */
async function runGuild(guild, now = new Date()) {
    const config = await db.getConfig(guild.id);
    if (!config.enabled)
        return 0;
    const roles = await db.rolesOf(guild.id);
    const channel = config.announceChannelId ? guild.channels.cache.get(config.announceChannelId) : null;
    const canSay = Boolean(channel && channel.isTextBased() && 'send' in channel);
    if (!canSay && !roles.length)
        return 0;
    const ids = await db.recentMembers(guild.id);
    if (!ids.length)
        return 0;
    const [days, plans, awards] = await Promise.all([db.daysOfMany(guild.id, ids, config.resetAt), db.plansOf(ids), db.awardsOf(guild.id, ids)]);
    const rules = { minMessages: config.minMessages, minVoiceMinutes: config.minVoiceMinutes, mode: config.mode };
    const today = streaks.dayOf(streaks.graceNow(now, config.graceMinutes));
    const lang = await guildLanguage(guild.id).catch(() => 'en');
    let did = 0;
    for (const userId of ids) {
        if (did >= PER_GUILD_PER_RUN)
            break;
        const result = streaks.compute(streaks.activeDays(days.get(userId) ?? [], rules), today, actions.freezesFor(actions.planFreezesOf(plans.get(userId)), config.guildFreezes));
        if (result.current < 1)
            continue;
        const due = dueFor(result.current, config.milestones, roles, awards.get(userId) ?? new Set());
        if (!due.record.length)
            continue;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member || member.user.bot) {
            for (const d of due.record)
                await db.recordAward(guild.id, userId, d);
            continue;
        }
        for (const role of due.roles) {
            const found = guild.roles.cache.get(role.roleId);
            const me = guild.members.me;
            if (!found || found.managed || (me && found.position >= me.roles.highest.position)) {
                logger.warn(`Streak roles: Petto cannot give the role ${role.roleId} in guild ${guild.id}.`);
                continue;
            }
            try {
                await member.roles.add(role.roleId, `Streak of ${role.days} days`);
                did += 1;
                await sleep(GAP_MS);
            }
            catch (error) {
                logger.warn(`Streak roles: could not give ${role.roleId} in guild ${guild.id}: ${error.message}`);
            }
        }
        let said = false;
        for (const d of due.record) {
            if (!(await db.recordAward(guild.id, userId, d)))
                continue; // another look did it first
            if (!said && canSay && due.announce === d) {
                said = true;
                try {
                    await channel.send({ content: t(lang, 'streaks.milestone', { user: `<@${userId}>`, days: d }), allowedMentions: { users: [userId] } });
                    did += 1;
                    await sleep(GAP_MS);
                }
                catch (error) {
                    logger.warn(`Streak announcement failed in guild ${guild.id}: ${error.message}`);
                }
            }
        }
    }
    return did;
}
/** Every server that has an announcement channel or reward roles, one after the other. */
async function runStreakRewards(client) {
    for (const guildId of await db.guildsWithRewards()) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild)
            continue;
        try {
            await runGuild(guild);
        }
        catch (error) {
            logger.error(`Streak rewards error in guild ${guildId}:`, error);
        }
        try {
            await (0, streakNotices_1.runNotices)(guild);
        }
        catch (error) {
            logger.error(`Streak notices error in guild ${guildId}:`, error);
        }
    }
    await db.pruneNotices().catch(() => null);
}

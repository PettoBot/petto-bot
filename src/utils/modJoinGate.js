"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actOnMember = actOnMember;
exports.runJoinGate = runJoinGate;
const modRules_1 = require("./modRules");
const modRules_2 = require("../db/modRules");
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');
const { createCase } = require('../db/modActions');
const { logSanction } = require('./caseLog');
const joins = new modRules_1.Recent();
const raids = new Map(); // server -> until when the raid is on (ms)
setInterval(() => { joins.sweep(Date.now(), 15 * 60_000); const now = Date.now(); for (const [id, until] of raids)
    if (until < now)
        raids.delete(id); }, 5 * 60_000).unref?.();
async function say(guild, channelId, body) {
    if (!channelId)
        return;
    const channel = guild.channels.cache.get(channelId);
    await channel?.send?.({ content: body, allowedMentions: { parse: [] } }).catch(() => undefined);
}
/** Does `action` to the member. Returns what was done (for the log), or null when it could not. */
async function actOnMember(member, action, compiled, why) {
    const guild = member.guild;
    const lang = currentLanguage();
    const reason = t(lang, 'modrules.gate.reason', { why });
    const sanction = async (type, expiresMs) => {
        const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: member.client.user.id, type, reason, expiresAt: expiresMs ? new Date(Date.now() + expiresMs).toISOString() : null, source: 'automod' });
        await logSanction(member.client, guild, { modCase, target: member.user, moderator: member.client.user, reason, source: 'automod' }).catch(() => undefined);
    };
    switch (action) {
        case 'alert':
            await say(guild, compiled.settings.log_channel_id, t(lang, 'modrules.gate.alert', { user: `<@${member.id}>`, why }));
            return 'alert';
        case 'timeout': {
            if (!member.moderatable)
                return null;
            const minutes = compiled.gate.timeout_minutes;
            if (!(await member.timeout(minutes * 60_000, reason).then(() => true, () => false)))
                return null;
            await sanction('tempmute', minutes * 60_000);
            return `timeout ${minutes}m`;
        }
        case 'kick': {
            if (!member.kickable)
                return null;
            if (!(await member.kick(reason).then(() => true, () => false)))
                return null;
            await sanction('kick');
            return 'kick';
        }
        case 'ban': {
            if (!member.bannable)
                return null;
            if (!(await member.ban({ reason }).then(() => true, () => false)))
                return null;
            await sanction('ban');
            return 'ban';
        }
        case 'quarantine': {
            const role = compiled.settings.quarantine_role_id ? guild.roles.cache.get(compiled.settings.quarantine_role_id) : null;
            if (!role || !role.editable)
                return null;
            return (await member.roles.add(role, reason).then(() => true, () => false)) ? 'quarantine' : null;
        }
    }
    return null;
}
/** What is done when a member joins: the raid detector first (it counts every join), then the checks of the gate. Never throws. */
async function runJoinGate(member, now = Date.now()) {
    try {
        const guild = member.guild;
        const compiled = await (0, modRules_2.load)(guild.id);
        const gate = compiled.gate;
        if (!gate.enabled || !compiled.settings.enabled)
            return;
        const lang = currentLanguage();
        // A raid: many joins in a short time.
        let raidAction = 'none';
        let raidWhy = '';
        if (gate.raid_joins > 0 && !member.user.bot) {
            const count = joins.add(`join:${guild.id}`, now, gate.raid_seconds * 1000);
            const on = (raids.get(guild.id) ?? 0) > now;
            if (count >= gate.raid_joins && !on) {
                raids.set(guild.id, now + gate.raid_lockdown_minutes * 60_000);
                raidWhy = t(lang, 'modrules.gate.raid', { joins: count, seconds: gate.raid_seconds });
                await say(guild, gate.raid_alert_channel_id || compiled.settings.log_channel_id, t(lang, 'modrules.gate.raidAlert', { joins: count, seconds: gate.raid_seconds }));
                (0, modRules_2.addLog)(guild.id, { ruleId: null, ruleName: 'join-gate', userId: member.id, channelId: null, trigger: 'raid', effects: [gate.raid_action] }).catch(() => undefined);
                if (gate.raid_action === 'lockdown') {
                    const { startLockdown } = require('./lockdown');
                    await startLockdown(guild, { startedBy: member.client.user.id, reason: raidWhy, minutes: gate.raid_lockdown_minutes }).catch((error) => logger.warn(`Join gate: lockdown failed in ${guild.id}: ${error.message}`));
                }
            }
            if ((raids.get(guild.id) ?? 0) > now)
                raidAction = gate.raid_action === 'kick_new' ? 'kick' : gate.raid_action === 'ban_new' ? 'ban' : 'none';
            if (raidAction !== 'none')
                raidWhy = raidWhy || t(lang, 'modrules.gate.raidOn');
        }
        const found = (0, modRules_1.gateFindings)(gate, {
            hasAvatar: member.user.avatar !== null, accountAgeDays: (now - member.user.createdTimestamp) / 86_400_000,
            username: member.user.username, displayName: member.displayName, isBot: member.user.bot,
        }, compiled.gateWords);
        const action = (0, modRules_1.strongestAction)([...found, { action: raidAction }]);
        if (action === 'none')
            return;
        const why = [...found.map((f) => f.reason), ...(raidAction !== 'none' ? ['raid'] : [])].join(', ');
        const done = await actOnMember(member, action, compiled, why || raidWhy);
        (0, modRules_2.addLog)(guild.id, { ruleId: null, ruleName: 'join-gate', userId: member.id, channelId: null, trigger: why, effects: done ? [done] : [] }).catch(() => undefined);
    }
    catch (error) {
        logger.error(`Join gate failed for ${member.id} in ${member.guild.id}:`, error);
    }
}

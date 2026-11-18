"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runModRules = runModRules;
// Runs the moderation rules of a server on a message (see utils/modRules.ts for what a rule is and db/modRules.ts for where they are kept).
// The rules are made in the dashboard; this only reads them. The effects that are quick and harmless (delete, reply) happen on every match; the
// sanctions wait for the threshold of the rule (N matches by the same member in M minutes, 1 by default). Sanctions go through the same cases,
// DMs and logs as the other automod (`applyAutomodAction`), so they show up in the history of the member like anything a moderator did.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/modRulesEngine.js, which is what the bot loads.
const discord_js_1 = require("discord.js");
const modRules_1 = require("./modRules");
const modRules_2 = require("../db/modRules");
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');
const { applyAutomodAction } = require('./automodAction');
const { createCase } = require('../db/modActions');
const { logSanction } = require('./caseLog');
const { sendDm } = require('./dmOrigin');
const recent = new modRules_1.Recent();
const SWEEP_MS = 5 * 60_000;
const MAX_MEMORY_MS = 24 * 60 * 60_000;
setInterval(() => recent.sweep(Date.now(), MAX_MEMORY_MS), SWEEP_MS).unref?.();
function factsOf(message) {
    const member = message.member;
    const channel = message.channel;
    const isThread = typeof message.channel.isThread === 'function' && message.channel.isThread();
    const day = 86_400_000;
    return {
        content: message.content ?? '',
        channelId: message.channelId,
        parentId: channel.parentId ?? null,
        categoryId: isThread ? channel.parent?.parentId ?? null : channel.parentId ?? null,
        roleIds: new Set(member.roles.cache.keys()),
        accountAgeDays: (Date.now() - message.author.createdTimestamp) / day,
        memberAgeDays: member.joinedTimestamp ? (Date.now() - member.joinedTimestamp) / day : 9999,
        users: message.mentions.users.size,
        roles: message.mentions.roles.size,
        everyone: message.mentions.everyone,
        attachments: [...message.attachments.values()].map((a) => ({ contentType: a.contentType ?? null, name: a.name ?? '' })),
    };
}
async function applyEffect(message, rule, effect, trigger) {
    const member = message.member;
    const guild = message.guild;
    const values = { user: `<@${message.author.id}>`, username: message.author.username, server: guild.name, channel: `<#${message.channelId}>`, rule: rule.name };
    const lang = currentLanguage();
    const reason = (custom) => (0, modRules_1.fillText)(String(custom || t(lang, 'modrules.reason', { rule: rule.name })), values);
    const type = `rule:${rule.name}`;
    switch (effect.type) {
        case 'delete': return (await message.delete().then(() => true, () => false)) ? 'delete' : null;
        case 'reply': {
            const body = (0, modRules_1.fillText)(String(effect.text ?? ''), values).trim();
            if (!body)
                return null;
            const sent = await message.channel.send({ content: body, allowedMentions: { users: [message.author.id] } }).catch(() => null);
            const after = Number(effect.delete_after ?? 0);
            if (sent && after > 0)
                setTimeout(() => sent.delete().catch(() => undefined), after * 1000).unref?.();
            return sent ? 'reply' : null;
        }
        case 'dm': {
            const body = (0, modRules_1.fillText)(String(effect.text ?? ''), values).trim();
            if (!body)
                return null;
            return (await sendDm(message.author, { content: body }).then(() => true, () => false)) ? 'dm' : null;
        }
        case 'warn':
            await applyAutomodAction(message, { violationType: type, reason: reason(effect.reason), action: 'warn', keepMessage: true });
            return 'warn';
        case 'timeout': {
            if (!member.moderatable)
                return null;
            await applyAutomodAction(message, { violationType: type, reason: reason(null), action: 'tempmute', durationMs: Number(effect.minutes ?? 10) * 60_000, keepMessage: true });
            return 'timeout';
        }
        case 'kick': {
            if (!member.kickable)
                return null;
            await applyAutomodAction(message, { violationType: type, reason: reason(null), action: 'kick', keepMessage: true });
            return 'kick';
        }
        case 'ban': {
            if (!member.bannable)
                return null;
            const why = reason(effect.reason);
            await sendDm(message.author, { content: t(lang, 'modrules.banDm', { server: guild.name, reason: why }) }).catch(() => undefined);
            const banned = await guild.members.ban(message.author.id, { reason: why, deleteMessageSeconds: Number(effect.delete_days ?? 0) * 86_400 }).then(() => true, () => false);
            if (!banned)
                return null;
            const modCase = await createCase({ guildId: guild.id, userId: message.author.id, moderatorId: message.client.user.id, type: 'ban', reason: why, source: 'automod' });
            await logSanction(message.client, guild, { modCase, target: message.author, moderator: message.client.user, reason: why, source: 'automod' }).catch(() => undefined);
            return 'ban';
        }
        case 'add_role':
        case 'remove_role': {
            const roleId = String(effect.role_id ?? '');
            const role = guild.roles.cache.get(roleId);
            if (!role || !role.editable)
                return null;
            const done = await (effect.type === 'add_role' ? member.roles.add(role, reason(null)) : member.roles.remove(role, reason(null))).then(() => true, () => false);
            return done ? effect.type : null;
        }
    }
    return null;
}
async function logToChannel(message, settings, rule, trigger, applied) {
    if (!settings.log_channel_id)
        return;
    const channel = message.guild.channels.cache.get(settings.log_channel_id);
    if (!channel?.send)
        return;
    const lang = currentLanguage();
    await channel.send({
        content: t(lang, 'modrules.log', { rule: rule.name, user: `<@${message.author.id}>`, channel: `<#${message.channelId}>`, trigger: trigger.split(':')[0], effects: applied.join(', ') || t(lang, 'modrules.logNone') }),
        allowedMentions: { parse: [] },
    }).catch(() => undefined);
}
/** Looks at one message with the rules of its server. Never throws: a broken rule must not stop the rest of the bot. */
async function runModRules(message) {
    try {
        if (!message.guild || message.author.bot || !message.member)
            return;
        const { settings, rulesets, lists } = await (0, modRules_2.load)(message.guild.id);
        if (!settings.enabled || !rulesets.length)
            return;
        if (settings.ignore_staff && message.member.permissions.has(discord_js_1.PermissionFlagsBits.ManageMessages))
            return;
        const facts = factsOf(message);
        const now = Date.now();
        const userKey = `${message.guild.id}:${message.author.id}`;
        for (const set of rulesets) {
            if (!(0, modRules_1.checkConditions)(set.conditions, facts))
                continue;
            for (const rule of set.rules) {
                const found = (0, modRules_1.evaluateRule)(rule, facts, lists, recent, `${userKey}:${rule.id}`, now);
                if (!found)
                    continue;
                const reached = rule.threshold_count <= 1 || (0, modRules_1.thresholdReached)(recent, `${userKey}:${rule.id}`, now, rule.threshold_count, rule.threshold_minutes);
                const applied = [];
                for (const effect of rule.effects) {
                    if (!reached && !modRules_1.IMMEDIATE_EFFECTS.includes(effect.type))
                        continue;
                    const done = await applyEffect(message, rule, effect, found[0]).catch((error) => { logger.warn(`Rules: ${effect.type} of "${rule.name}" failed in ${message.guild.id}: ${error.message}`); return null; });
                    if (done)
                        applied.push(done);
                }
                (0, modRules_2.countHit)(message.guild.id, rule.id);
                (0, modRules_2.addLog)(message.guild.id, { ruleId: rule.id, ruleName: rule.name, userId: message.author.id, channelId: message.channelId, trigger: found.join(' + '), effects: applied }).catch(() => undefined);
                await logToChannel(message, settings, rule, found[0], applied);
                if (rule.stop)
                    return;
            }
        }
    }
    catch (error) {
        logger.error(`Rules failed for message ${message.id}:`, error);
    }
}

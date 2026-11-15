"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isActionEffect = exports.ACTION_TYPES = void 0;
exports.resetModerationCounts = resetModerationCounts;
exports.applyAction = applyAction;
exports.extraLookups = extraLookups;
// i18n-ignore-file: the names of the functions and of the keys of the data stay as they are; every sentence is a phrase of the catalogs.
// What the new functions of Petto Code really do (src/scripting/actions.ts only notes what the code asked): edit, delete and pin messages, make and
// change channels, threads and roles, set nicknames, moderate and schedule commands. The rule is the one of the rest of Petto Code: the command acts as
// the member who used it, so it can never do more than that member could, and never more than Petto itself is allowed to do. The moderation goes
// through the same checks, direct messages, cases and logs as the moderation commands.
const discord_js_1 = require("discord.js");
const { t } = require('../i18n');
const logger = require('./logger');
// What moderation needs is loaded when an action uses it (not when the bot starts), as they reach the database.
const canModerate = (interaction, target, permission, options) => require('./permissions').canModerate(interaction, target, permission, options);
const sendDm = (target, payload, options) => require('./dmOrigin').sendDm(target, payload, options);
const sanctionDM = (options) => require('./sanctionTemplates').sanctionDM(options);
const updateSanctionDm = (dm, options) => require('./sanctionTemplates').updateSanctionDm(dm, options);
const logSanction = (client, guild, options) => require('./caseLog').logSanction(client, guild, options);
const formatDuration = (ms, lang) => require('./duration').formatDuration(ms, lang);
/** The kinds of effect that this file does (the others are done in codeCommands.js). */
exports.ACTION_TYPES = new Set([
    'editMessage', 'deleteMessage', 'pinMessage', 'unpinMessage', 'purgeMessages', 'reactToMessage',
    'createChannel', 'editChannel', 'deleteChannel', 'lockChannel', 'unlockChannel', 'createThread', 'lockThread', 'archiveThread',
    'ban', 'tempban', 'unban', 'kick', 'mute', 'unmute', 'warn',
    'createRole', 'editRole', 'deleteRole', 'addRoleTo', 'removeRoleFrom', 'setNickname',
    'schedule', 'cancelSchedule',
]);
const isActionEffect = (type) => exports.ACTION_TYPES.has(type);
exports.isActionEffect = isActionEffect;
const CHANNEL_TYPE = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 };
const MAX_PENDING_SCHEDULES = 25;
const MODERATION_PER_MINUTE = 15;
const FORUM_TYPES = new Set([15, 16]);
const moderationTimes = new Map(); // guildId -> the times of the latest moderation actions of the code
const skip = (lang, type, key, vars) => `${type}: ${t(lang, `customcommands.run.act.${key}`, vars)}`;
const label = (flag, lang) => require('./permissions').permissionLabels(flag, lang);
const messageOfDiscord = (error) => String(error?.message ?? error ?? '').slice(0, 120);
/** The member who used the command, as `canModerate` and the checks read an interaction. */
const asInteraction = (source, lang) => ({ member: source.member, guild: source.guild, user: source.author, pettoLang: lang });
/** A check of what the member can do and what Petto can do. Returns the reason to skip, or null when both can. */
function needPermission(source, type, lang, flag, channel) {
    const me = source.guild.members.me;
    const member = source.member;
    const ofMember = channel ? channel.permissionsFor?.(member) : member?.permissions;
    const ofMe = channel ? channel.permissionsFor?.(me) : me?.permissions;
    if (!ofMember?.has(flag))
        return skip(lang, type, 'needYou', { permission: label(flag, lang) });
    if (!ofMe?.has(flag))
        return skip(lang, type, 'needMe', { permission: label(flag, lang) });
    return null;
}
function textChannel(guild, id) {
    const channel = guild.channels.cache.get(id);
    return channel?.isTextBased?.() && !channel.isDMBased?.() ? channel : null;
}
/** Whether the member (and Petto) may use the role: not @everyone, not a role of a bot or an integration, and below their own highest role. */
function roleProblem(source, type, lang, role) {
    if (!role)
        return skip(lang, type, 'noRole');
    const { guild, member } = source;
    if (role.id === guild.id || role.managed)
        return skip(lang, type, 'roleCannot');
    if (role.position >= guild.members.me.roles.highest.position)
        return skip(lang, type, 'roleCannot');
    if (guild.ownerId !== member.id && role.position >= member.roles.highest.position)
        return skip(lang, type, 'roleAboveYou');
    return null;
}
function moderationAllowed(guildId, now) {
    const recent = (moderationTimes.get(guildId) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= MODERATION_PER_MINUTE) {
        moderationTimes.set(guildId, recent);
        return false;
    }
    recent.push(now);
    moderationTimes.set(guildId, recent);
    return true;
}
/** Forgets the count of moderation actions (for the checks). */
function resetModerationCounts() { moderationTimes.clear(); }
async function fetchMember(guild, id) {
    return guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
}
async function fetchUser(guild, id) {
    return guild.client.users.cache.get(id) ?? await guild.client.users.fetch(id).catch(() => null);
}
/** The part that every sanction has: who it is for, whether the member may do it to them (the same check as the commands), and the moderator. */
async function sanctionTarget(source, effect, ctx, spec) {
    const { lang } = ctx;
    const type = effect.type;
    if (!moderationAllowed(source.guild.id, (ctx.now ?? Date.now)()))
        return skip(lang, type, 'tooManyModeration', { max: MODERATION_PER_MINUTE });
    const user = await fetchUser(source.guild, effect.userId);
    if (!user)
        return skip(lang, type, 'noUser');
    const member = await fetchMember(source.guild, effect.userId);
    if (spec.needMember && !member)
        return skip(lang, type, 'noMember');
    const check = canModerate(asInteraction(source, lang), member, spec.permission, spec.type === 'warn' ? { hierarchy: 'none', lang } : { lang });
    if (!check.ok)
        return `${type}: ${check.message}`;
    return { user, member };
}
async function finishSanction(source, ctx, options) {
    const { guild, author } = source;
    const dmOptions = { type: options.type, guild, client: guild.client, reason: options.reason, member: options.member, moderator: author, ...(options.duration ? { duration: options.duration } : {}) };
    if (options.dm)
        await updateSanctionDm(options.dm, { ...dmOptions, caseNumber: options.modCase.case_number }).catch(() => { });
    await logSanction(guild.client, guild, { modCase: options.modCase, target: options.user, moderator: author, reason: options.reason, ...(options.duration ? { duration: options.duration } : {}) }).catch((error) => logger.warn(`The log of a sanction of a command in guild ${guild.id} failed: ${error.message}`));
}
async function dmBefore(source, ctx, type, member, reason, duration) {
    if (!member)
        return null;
    const { guild, author } = source;
    return sendDm(member, await sanctionDM({ type, guild, client: guild.client, reason, member, moderator: author, ...(duration ? { duration } : {}) }))
        .catch(() => { logger.warn(`Could not DM a ${type} notice to ${member.id} in guild ${guild.id}.`); return null; });
}
async function ban(source, effect, ctx, temporary) {
    const { lang } = ctx;
    const { guild, author } = source;
    const { createCase } = require('../db/modActions');
    const { ensureGuild } = require('../db/guilds');
    const target = await sanctionTarget(source, effect, ctx, { type: effect.type, permission: discord_js_1.PermissionFlagsBits.BanMembers, needMember: false });
    if (typeof target === 'string')
        return target;
    const reason = effect.reason ?? null;
    const type = temporary ? 'tempban' : 'ban';
    const duration = temporary ? formatDuration(effect.seconds * 1000, lang) : undefined;
    const dm = await dmBefore(source, ctx, type, target.member, reason, duration);
    try {
        await guild.members.ban(effect.userId, { reason: reason ?? undefined, ...(effect.days ? { deleteMessageSeconds: effect.days * 86_400 } : {}) });
    }
    catch (error) {
        logger.warn(`A command could not ban ${effect.userId} in guild ${guild.id}: ${messageOfDiscord(error)}`);
        return skip(lang, effect.type, 'failed', { detail: messageOfDiscord(error) });
    }
    await ensureGuild(guild.id);
    const modCase = await createCase({ guildId: guild.id, userId: effect.userId, moderatorId: author.id, type, reason, ...(temporary ? { expiresAt: new Date(((ctx.now ?? Date.now)()) + effect.seconds * 1000).toISOString() } : {}) });
    await finishSanction(source, ctx, { type, modCase, user: target.user, reason, dm, member: target.member, duration });
    return null;
}
async function unban(source, effect, ctx) {
    const { lang } = ctx;
    const { guild, author } = source;
    const { createCase, getActiveSanction, deactivateCase } = require('../db/modActions');
    const { getHardBan, removeHardBan, canLiftHardBan } = require('../db/hardBans');
    const { ensureGuild } = require('../db/guilds');
    const target = await sanctionTarget(source, effect, ctx, { type: 'unban', permission: discord_js_1.PermissionFlagsBits.BanMembers, needMember: false });
    if (typeof target === 'string')
        return target;
    const hardBan = await getHardBan(guild.id, effect.userId).catch(() => null);
    if (hardBan && !(await canLiftHardBan(guild, author.id)))
        return skip(lang, effect.type, 'hardBan');
    try {
        await guild.members.unban(effect.userId, effect.reason ?? undefined);
    }
    catch (error) {
        if (error?.code === 10026)
            return skip(lang, effect.type, 'notBanned');
        return skip(lang, effect.type, 'failed', { detail: messageOfDiscord(error) });
    }
    if (hardBan)
        await removeHardBan(guild.id, effect.userId).catch(() => { });
    const active = await getActiveSanction(guild.id, effect.userId, ['ban', 'tempban', 'hardban']).catch(() => null);
    if (active)
        await deactivateCase(guild.id, active.case_number).catch(() => { });
    await ensureGuild(guild.id);
    const modCase = await createCase({ guildId: guild.id, userId: effect.userId, moderatorId: author.id, type: 'unban', reason: effect.reason ?? null });
    await finishSanction(source, ctx, { type: 'unban', modCase, user: target.user, reason: effect.reason ?? null });
    return null;
}
async function kick(source, effect, ctx) {
    const { lang } = ctx;
    const { guild, author } = source;
    const { createCase } = require('../db/modActions');
    const { ensureGuild } = require('../db/guilds');
    const target = await sanctionTarget(source, effect, ctx, { type: 'kick', permission: discord_js_1.PermissionFlagsBits.KickMembers, needMember: true });
    if (typeof target === 'string')
        return target;
    const reason = effect.reason ?? null;
    const dm = await dmBefore(source, ctx, 'kick', target.member, reason);
    try {
        await target.member.kick(reason ?? undefined);
    }
    catch (error) {
        return skip(lang, effect.type, 'failed', { detail: messageOfDiscord(error) });
    }
    await ensureGuild(guild.id);
    const modCase = await createCase({ guildId: guild.id, userId: effect.userId, moderatorId: author.id, type: 'kick', reason });
    await finishSanction(source, ctx, { type: 'kick', modCase, user: target.user, reason, dm, member: target.member });
    return null;
}
async function mute(source, effect, ctx) {
    const { lang } = ctx;
    const { guild, author } = source;
    const { createCase } = require('../db/modActions');
    const { ensureGuild } = require('../db/guilds');
    const target = await sanctionTarget(source, effect, ctx, { type: 'mute', permission: discord_js_1.PermissionFlagsBits.ModerateMembers, needMember: true });
    if (typeof target === 'string')
        return target;
    const reason = effect.reason ?? null;
    const ms = effect.seconds * 1000;
    try {
        await target.member.timeout(ms, reason ?? undefined);
    }
    catch (error) {
        return skip(lang, effect.type, 'failed', { detail: messageOfDiscord(error) });
    }
    await ensureGuild(guild.id);
    const modCase = await createCase({ guildId: guild.id, userId: effect.userId, moderatorId: author.id, type: 'tempmute', reason, expiresAt: new Date(((ctx.now ?? Date.now)()) + ms).toISOString() });
    const duration = formatDuration(ms, lang);
    await finishSanction(source, ctx, { type: 'tempmute', modCase, user: target.user, reason, member: target.member, duration });
    await dmBefore(source, ctx, 'tempmute', target.member, reason, duration).then(async (dm) => { if (dm)
        await updateSanctionDm(dm, { type: 'tempmute', guild, client: guild.client, reason, duration, member: target.member, moderator: author, caseNumber: modCase.case_number }).catch(() => { }); });
    return null;
}
async function unmute(source, effect, ctx) {
    const { lang } = ctx;
    const { guild, author } = source;
    const { createCase, getActiveSanction, deactivateCase } = require('../db/modActions');
    const { ensureGuild } = require('../db/guilds');
    const target = await sanctionTarget(source, effect, ctx, { type: 'unmute', permission: discord_js_1.PermissionFlagsBits.ModerateMembers, needMember: true });
    if (typeof target === 'string')
        return target;
    const reason = effect.reason ?? null;
    const settings = await ensureGuild(guild.id);
    let didSomething = false;
    if (target.member.isCommunicationDisabled?.()) {
        await target.member.timeout(null, reason ?? undefined).catch((error) => logger.warn(`Failed to clear a timeout: ${error.message}`));
        didSomething = true;
    }
    if (settings?.mute_role_id && target.member.roles.cache.has(settings.mute_role_id)) {
        await target.member.roles.remove(settings.mute_role_id, reason ?? undefined).catch((error) => logger.warn(`Failed to remove the mute role: ${error.message}`));
        didSomething = true;
    }
    const active = await getActiveSanction(guild.id, effect.userId, ['mute', 'tempmute']).catch(() => null);
    if (active) {
        await deactivateCase(guild.id, active.case_number).catch(() => { });
        didSomething = true;
    }
    if (!didSomething)
        return skip(lang, effect.type, 'notMuted');
    const modCase = await createCase({ guildId: guild.id, userId: effect.userId, moderatorId: author.id, type: 'unmute', reason });
    await finishSanction(source, ctx, { type: 'unmute', modCase, user: target.user, reason, member: target.member });
    await dmBefore(source, ctx, 'unmute', target.member, reason).then(async (dm) => { if (dm)
        await updateSanctionDm(dm, { type: 'unmute', guild, client: guild.client, reason, member: target.member, moderator: author, caseNumber: modCase.case_number }).catch(() => { }); });
    return null;
}
async function warn(source, effect, ctx) {
    const { guild, author } = source;
    const { addWarn } = require('../db/warns');
    const { checkAndApplyEscalation } = require('./escalation');
    const { ensureGuild } = require('../db/guilds');
    const target = await sanctionTarget(source, effect, ctx, { type: 'warn', permission: discord_js_1.PermissionFlagsBits.ModerateMembers, needMember: true });
    if (typeof target === 'string')
        return target;
    await ensureGuild(guild.id);
    const { modCase, warnCount } = await addWarn({ guildId: guild.id, userId: effect.userId, moderatorId: author.id, reason: effect.reason });
    await finishSanction(source, ctx, { type: 'warn', modCase, user: target.user, reason: effect.reason, member: target.member });
    await dmBefore(source, ctx, 'warn', target.member, effect.reason).then(async (dm) => { if (dm)
        await updateSanctionDm(dm, { type: 'warn', guild, client: guild.client, reason: effect.reason, member: target.member, moderator: author, caseNumber: modCase.case_number }).catch(() => { }); });
    await checkAndApplyEscalation(guild.client, guild, target.member, warnCount).catch((error) => logger.error('Escalation check failed:', error));
    return null;
}
// ── The other actions ─────────────────────────────────────────────────────
async function messageOf(channel, id) {
    return channel.messages.fetch(id).catch(() => null);
}
async function applyAction(source, effect, ctx) {
    const { lang } = ctx;
    const type = effect.type;
    const { guild, member, author } = source;
    const me = guild.members.me;
    try {
        switch (type) {
            // Messages
            case 'editMessage': {
                const channel = textChannel(guild, effect.channelId);
                if (!channel)
                    return skip(lang, type, 'noChannel');
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageMessages, channel);
                if (problem)
                    return problem;
                const message = await messageOf(channel, effect.messageId);
                if (!message)
                    return skip(lang, type, 'noMessage');
                if (message.author?.id !== guild.client.user?.id)
                    return skip(lang, type, 'notMine');
                await message.edit(ctx.toPayload(effect, guild, author.id, ctx.commandName, { clearComponents: true }));
                return null;
            }
            case 'deleteMessage': {
                const channel = textChannel(guild, effect.channelId);
                if (!channel)
                    return skip(lang, type, 'noChannel');
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageMessages, channel);
                if (problem)
                    return problem;
                const message = await messageOf(channel, effect.messageId);
                if (!message)
                    return skip(lang, type, 'noMessage');
                if (effect.delay)
                    setTimeout(() => message.delete().catch(() => { }), effect.delay * 1000).unref?.();
                else
                    await message.delete();
                return null;
            }
            case 'pinMessage':
            case 'unpinMessage': {
                const channel = textChannel(guild, effect.channelId);
                if (!channel)
                    return skip(lang, type, 'noChannel');
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageMessages, channel);
                if (problem)
                    return problem;
                const message = await messageOf(channel, effect.messageId);
                if (!message)
                    return skip(lang, type, 'noMessage');
                if (type === 'pinMessage')
                    await message.pin();
                else
                    await message.unpin();
                return null;
            }
            case 'purgeMessages': {
                const channel = textChannel(guild, effect.channelId);
                if (!channel || typeof channel.bulkDelete !== 'function')
                    return skip(lang, type, 'noChannel');
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageMessages, channel);
                if (problem)
                    return problem;
                await channel.bulkDelete(effect.count, true);
                return null;
            }
            case 'reactToMessage': {
                const channel = textChannel(guild, effect.channelId);
                if (!channel)
                    return skip(lang, type, 'noChannel');
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.AddReactions, channel);
                if (problem)
                    return problem;
                const message = await messageOf(channel, effect.messageId);
                if (!message)
                    return skip(lang, type, 'noMessage');
                await message.react(effect.emoji);
                return null;
            }
            // Channels and threads
            case 'createChannel': {
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageChannels);
                if (problem)
                    return problem;
                let parent = null;
                if (effect.parentId) {
                    parent = guild.channels.cache.get(effect.parentId);
                    if (!parent || parent.type !== 4)
                        return skip(lang, type, 'noCategory');
                    const parentProblem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageChannels, parent);
                    if (parentProblem)
                        return parentProblem;
                }
                await guild.channels.create({ name: effect.name, type: CHANNEL_TYPE[effect.kind], ...(parent ? { parent: parent.id } : {}), reason: t(lang, 'customcommands.run.auditReason') });
                return null;
            }
            case 'editChannel': {
                const channel = guild.channels.cache.get(effect.channelId) ?? await guild.channels.fetch(effect.channelId).catch(() => null);
                if (!channel)
                    return skip(lang, type, 'noChannel');
                const problem = needPermission(source, type, lang, channel.isThread?.() ? discord_js_1.PermissionFlagsBits.ManageThreads : discord_js_1.PermissionFlagsBits.ManageChannels, channel);
                if (problem)
                    return problem;
                const { changes } = effect;
                const edit = {};
                if (changes.name !== undefined)
                    edit.name = changes.name;
                if (changes.topic !== undefined && !channel.isThread?.())
                    edit.topic = changes.topic;
                if (changes.slowmode !== undefined)
                    edit.rateLimitPerUser = changes.slowmode;
                if (changes.nsfw !== undefined && !channel.isThread?.())
                    edit.nsfw = changes.nsfw;
                if (changes.parentId !== undefined && !channel.isThread?.()) {
                    if (changes.parentId) {
                        const parent = guild.channels.cache.get(changes.parentId);
                        if (!parent || parent.type !== 4)
                            return skip(lang, type, 'noCategory');
                        const parentProblem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageChannels, parent);
                        if (parentProblem)
                            return parentProblem;
                    }
                    edit.parent = changes.parentId;
                }
                if (!Object.keys(edit).length)
                    return skip(lang, type, 'nothingToChange');
                await channel.edit({ ...edit, reason: t(lang, 'customcommands.run.auditReason') });
                return null;
            }
            case 'deleteChannel': {
                const channel = guild.channels.cache.get(effect.channelId) ?? await guild.channels.fetch(effect.channelId).catch(() => null);
                if (!channel)
                    return skip(lang, type, 'noChannel');
                const problem = needPermission(source, type, lang, channel.isThread?.() ? discord_js_1.PermissionFlagsBits.ManageThreads : discord_js_1.PermissionFlagsBits.ManageChannels, channel);
                if (problem)
                    return problem;
                if (channel.id === guild.rulesChannelId || channel.id === guild.publicUpdatesChannelId)
                    return skip(lang, type, 'protectedChannel');
                await channel.delete(t(lang, 'customcommands.run.auditReason'));
                return null;
            }
            case 'lockChannel':
            case 'unlockChannel': {
                const channel = guild.channels.cache.get(effect.channelId);
                if (!channel || channel.isThread?.() || !channel.permissionOverwrites)
                    return skip(lang, type, 'noChannel');
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageChannels, channel);
                if (problem)
                    return problem;
                if (!channel.permissionsFor(me)?.has(discord_js_1.PermissionFlagsBits.ManageRoles))
                    return skip(lang, type, 'needMe', { permission: label(discord_js_1.PermissionFlagsBits.ManageRoles, lang) });
                await channel.permissionOverwrites.edit(guild.id, { SendMessages: type === 'lockChannel' ? false : null }, { reason: effect.reason ?? t(lang, 'customcommands.run.auditReason') });
                return null;
            }
            case 'createThread': {
                const channel = textChannel(guild, effect.channelId);
                if (!channel || channel.isThread?.() || !channel.threads)
                    return skip(lang, type, 'noChannel');
                if (FORUM_TYPES.has(channel.type))
                    return skip(lang, type, 'forumThread');
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.CreatePublicThreads, channel);
                if (problem)
                    return problem;
                let startMessage;
                if (effect.messageId) {
                    startMessage = await messageOf(channel, effect.messageId);
                    if (!startMessage)
                        return skip(lang, type, 'noMessage');
                }
                await channel.threads.create({ name: effect.name, ...(startMessage ? { startMessage } : {}), reason: t(lang, 'customcommands.run.auditReason') });
                return null;
            }
            case 'lockThread':
            case 'archiveThread': {
                const thread = guild.channels.cache.get(effect.channelId) ?? await guild.channels.fetch(effect.channelId).catch(() => null);
                if (!thread?.isThread?.())
                    return skip(lang, type, 'noThread');
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageThreads, thread);
                if (problem)
                    return problem;
                if (type === 'lockThread')
                    await thread.setLocked(true, t(lang, 'customcommands.run.auditReason'));
                else
                    await thread.setArchived(true, t(lang, 'customcommands.run.auditReason'));
                return null;
            }
            // Moderation
            case 'ban': return await ban(source, effect, ctx, false);
            case 'tempban': return await ban(source, effect, ctx, true);
            case 'unban': return await unban(source, effect, ctx);
            case 'kick': return await kick(source, effect, ctx);
            case 'mute': return await mute(source, effect, ctx);
            case 'unmute': return await unmute(source, effect, ctx);
            case 'warn': return await warn(source, effect, ctx);
            // Roles and nicknames
            case 'createRole': {
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageRoles);
                if (problem)
                    return problem;
                await guild.roles.create({ name: effect.name, ...(effect.color !== null ? { color: effect.color } : {}), permissions: [], reason: t(lang, 'customcommands.run.auditReason') });
                return null;
            }
            case 'editRole':
            case 'deleteRole': {
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageRoles);
                if (problem)
                    return problem;
                const role = guild.roles.cache.get(effect.roleId);
                const roleBlock = roleProblem(source, type, lang, role);
                if (roleBlock)
                    return roleBlock;
                const reason = t(lang, 'customcommands.run.auditReason');
                if (type === 'deleteRole') {
                    await role.delete(reason);
                    return null;
                }
                const { changes } = effect;
                await role.edit({
                    ...(changes.name !== undefined ? { name: changes.name } : {}), ...(changes.color !== undefined ? { color: changes.color } : {}),
                    ...(changes.hoist !== undefined ? { hoist: changes.hoist } : {}), ...(changes.mentionable !== undefined ? { mentionable: changes.mentionable } : {}), reason,
                });
                return null;
            }
            case 'addRoleTo':
            case 'removeRoleFrom': {
                const problem = needPermission(source, type, lang, discord_js_1.PermissionFlagsBits.ManageRoles);
                if (problem)
                    return problem;
                const role = guild.roles.cache.get(effect.roleId);
                const roleBlock = roleProblem(source, type, lang, role);
                if (roleBlock)
                    return roleBlock;
                const target = await fetchMember(guild, effect.userId);
                if (!target)
                    return skip(lang, type, 'noMember');
                const reason = t(lang, 'customcommands.run.auditReason');
                if (type === 'addRoleTo')
                    await target.roles.add(role, reason);
                else
                    await target.roles.remove(role, reason);
                return null;
            }
            case 'setNickname': {
                const own = effect.userId === author.id;
                const flag = own ? discord_js_1.PermissionFlagsBits.ChangeNickname : discord_js_1.PermissionFlagsBits.ManageNicknames;
                const problem = needPermission(source, type, lang, flag);
                if (problem)
                    return problem;
                const target = await fetchMember(guild, effect.userId);
                if (!target)
                    return skip(lang, type, 'noMember');
                if (target.id === guild.ownerId)
                    return skip(lang, type, 'ownerNick');
                if (!own && guild.ownerId !== member.id && target.roles.highest.position >= member.roles.highest.position)
                    return skip(lang, type, 'higherMember');
                if (target.manageable === false)
                    return skip(lang, type, 'higherMember');
                await target.setNickname(effect.nick, t(lang, 'customcommands.run.auditReason'));
                return null;
            }
            // Later
            case 'schedule': {
                if (!ctx.schedule || !ctx.commands)
                    return skip(lang, type, 'failed', { detail: 'no store' });
                const row = await ctx.commands.getCommand(guild.id, effect.name).catch(() => null);
                if (!row?.code)
                    return skip(lang, type, 'noCommand', { name: effect.name });
                const now = (ctx.now ?? Date.now)();
                // Replacing one that has the same id does not count as one more.
                const pending = await ctx.schedule.count(guild.id);
                const replaced = await ctx.schedule.cancel(guild.id, effect.name, effect.id);
                if (!replaced && pending >= MAX_PENDING_SCHEDULES)
                    return skip(lang, type, 'tooManyScheduled', { max: MAX_PENDING_SCHEDULES });
                await ctx.schedule.set({ guildId: guild.id, name: effect.name, id: effect.id, runAt: now + effect.seconds * 1000, userId: author.id, channelId: source.channel?.id ?? '', data: effect.data ?? null });
                return null;
            }
            case 'cancelSchedule': {
                if (!ctx.schedule)
                    return skip(lang, type, 'failed', { detail: 'no store' });
                await ctx.schedule.cancel(guild.id, effect.name, effect.id);
                return null;
            }
            default: return null;
        }
    }
    catch (error) {
        logger.warn(`A command action failed (${type}) in guild ${guild.id}: ${messageOfDiscord(error)}`);
        return skip(lang, type, 'failed', { detail: messageOfDiscord(error) });
    }
}
const seconds = (ms) => (ms ? Math.floor(ms / 1000) : null);
const CHANNEL_KIND = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 10: 'thread', 11: 'thread', 12: 'thread', 13: 'stage', 15: 'forum', 16: 'media' };
/** The reads that the new functions use: messages, users, permissions, bans, lists. The member who ran the command decides what can be read. */
function extraLookups(guild, executor, map, httpRequest) {
    const canSee = (channel, ...flags) => {
        const own = channel?.permissionsFor?.(executor);
        const mine = channel?.permissionsFor?.(guild.members.me);
        return Boolean(own && mine && flags.every((flag) => own.has(flag) && mine.has(flag)));
    };
    const messageData = (message) => ({
        ID: message.id, ChannelID: message.channelId ?? message.channel?.id ?? null, Content: String(message.content ?? '').slice(0, 2000), Link: message.url ?? null,
        AuthorID: message.author?.id ?? null, Author: message.author ? map.userData(message.author) : null,
        CreatedAt: seconds(message.createdTimestamp), EditedAt: seconds(message.editedTimestamp), Pinned: Boolean(message.pinned), ReplyToID: message.reference?.messageId ?? null,
        Embeds: [...(message.embeds ?? [])].slice(0, 5).map((embed) => ({ Title: embed.title ?? null, Description: embed.description ?? null, Footer: embed.footer?.text ?? null, Author: embed.author?.name ?? null })),
        Attachments: [...(message.attachments?.values?.() ?? [])].slice(0, 10).map((file) => ({ URL: file.url, Name: file.name ?? null, Size: file.size ?? null, ContentType: file.contentType ?? null })),
        Reactions: [...(message.reactions?.cache?.values?.() ?? [])].slice(0, 20).map((reaction) => ({ Emoji: reaction.emoji?.toString?.() ?? null, Count: reaction.count ?? 0 })),
    });
    const view = [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.ReadMessageHistory];
    return {
        async message(channelId, id) {
            const channel = guild.channels.cache.get(channelId);
            if (!channel?.isTextBased?.() || !canSee(channel, ...view))
                return null;
            const message = await channel.messages.fetch(id).catch(() => null);
            return message ? messageData(message) : null;
        },
        async messages(channelId, count) {
            const channel = guild.channels.cache.get(channelId);
            if (!channel?.isTextBased?.() || !canSee(channel, ...view))
                return [];
            const found = await channel.messages.fetch({ limit: Math.max(1, Math.min(10, count)) }).catch(() => null);
            return found ? [...found.values()].map(messageData) : [];
        },
        async user(id) {
            const member = guild.members.cache.get(id) ?? await guild.members.fetch({ user: id, force: false }).catch(() => null);
            if (member)
                return { ...map.memberData(member), InServer: true };
            const user = guild.client.users.cache.get(id) ?? await guild.client.users.fetch(id).catch(() => null);
            return user ? { ...map.userData(user), InServer: false } : null;
        },
        async guild() { return map.guildData(guild); },
        async permission(id, name, channelId) {
            const member = guild.members.cache.get(id) ?? await guild.members.fetch({ user: id, force: false }).catch(() => null);
            if (!member)
                return null;
            const flag = discord_js_1.PermissionFlagsBits[name];
            if (flag === undefined)
                return null;
            if (!channelId)
                return member.permissions.has(flag);
            const channel = guild.channels.cache.get(channelId);
            return channel ? Boolean(channel.permissionsFor(member)?.has(flag)) : null;
        },
        async banned(id) {
            if (!guild.members.me?.permissions.has(discord_js_1.PermissionFlagsBits.BanMembers))
                return null;
            return guild.bans.fetch({ user: id, force: true }).then(() => true, (error) => (error?.code === 10026 ? false : null));
        },
        async roles() {
            return [...guild.roles.cache.values()].filter((role) => role.id !== guild.id).sort((a, b) => b.position - a.position).slice(0, 100).map((role) => map.roleData(role));
        },
        async channels(kind) {
            return [...guild.channels.cache.values()]
                .filter((channel) => (!kind || CHANNEL_KIND[channel.type] === kind) && channel.permissionsFor?.(executor)?.has(discord_js_1.PermissionFlagsBits.ViewChannel))
                .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0)).slice(0, 100).map((channel) => map.channelData(channel));
        },
        async http(spec) { return httpRequest(spec, { guildId: guild.id }); },
    };
}
